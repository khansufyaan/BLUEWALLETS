import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { KmsService } from './kms-service';
import { PolicyEngine } from './policy-engine';
import { AddressService } from './address-service';
import { deriveChild, buildBip44Path, zeroBuffer } from './hd-derivation';
import {
  Wallet, Transaction, CreateWalletRequest, TransferRequest,
} from '../types/wallet';
import { CHAIN_CONFIGS } from '../types/chain';
import { IWalletStore, ITransactionStore } from '../types/store';
import { walletConfig } from '../config';
import { logger } from '../utils/logger';

export class WalletService {
  private addressService = new AddressService();

  constructor(
    private kms: KmsService,
    private policyEngine: PolicyEngine,
    private walletStore: IWalletStore,
    private transactionStore: ITransactionStore
  ) {}

  async createWallet(req: CreateWalletRequest): Promise<Wallet> {
    const chainConfig = CHAIN_CONFIGS[req.chain];
    if (!chainConfig) throw new Error(`Unsupported chain: ${req.chain}`);

    const algorithm = chainConfig.algorithm;
    const currency  = req.currency || chainConfig.ticker;
    const useHd     = this.isHdMode();

    let wrappedPrivateKey: string;
    let publicKeyHex: string;
    let keyId: string;
    let derivationPath: string | undefined;
    let hdVersion: string | undefined;

    if (useHd) {
      // ── HD Mode: BIP-32 derive → HSM import → wrap ──────────────────
      const index = await this.getNextDerivationIndex(req.chain);
      derivationPath = buildBip44Path(req.chain, index);
      hdVersion = 'v1';

      // Read master seed from HSM (zeroed immediately after derivation)
      const masterSeed = await this.kms.readMasterSeed();

      try {
        // Derive child key (BIP-32 HMAC-SHA512 chain in app memory)
        const derived = deriveChild(masterSeed, derivationPath);

        try {
          // Import child key to HSM session → wrap with blue:wrap:v1
          const wrapped = await this.kms.importAndWrapEcKey(derived.privateKey, algorithm);
          wrappedPrivateKey = wrapped.wrappedPrivateKey;
          keyId = wrapped.keyId;
          publicKeyHex = derived.publicKeyHex;
        } finally {
          zeroBuffer(derived.privateKey);
          zeroBuffer(derived.publicKeyCompressed);
        }
      } finally {
        zeroBuffer(masterSeed);
      }

      logger.info('HD wallet key derived and wrapped', { derivationPath, keyId: keyId! });
    } else {
      // ── Legacy Mode: generate permanent HSM token key ─────────────────
      const result = await this.kms.generateAndWrapWalletKey(algorithm);
      wrappedPrivateKey = result.wrappedPrivateKey;
      publicKeyHex = result.publicKeyHex;
      keyId = result.keyId;
    }

    // Derive blockchain address from public key
    const address = this.addressService.deriveAddress(publicKeyHex, req.chain);

    const wallet: Wallet = {
      id: uuidv4(),
      vaultId: req.vaultId || '',
      name: req.name,
      keyId,
      chain: req.chain,
      algorithm,
      address,
      publicKey: publicKeyHex,
      wrappedPrivateKey,
      derivationPath,
      hdVersion,
      balance: BigInt(req.initialBalance || '0'),
      currency,
      status: 'active',
      metadata: req.metadata || {},
      policyIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.walletStore.create(wallet);
    logger.info('Wallet created', {
      walletId: wallet.id, chain: req.chain, address, algorithm,
      mode: useHd ? 'hd-derived' : 'hsm-token',
      derivationPath: derivationPath || 'n/a',
    });
    return wallet;
  }

  /** Determine if HD mode should be used for new wallets. */
  private isHdMode(): boolean {
    // Explicit config takes precedence
    if (walletConfig.keyMode === 'hd-derived') return true;
    if (walletConfig.keyMode === 'hsm-token') {
      // Even in hsm-token mode, auto-upgrade if HD master exists
      return this.kms.hdMasterExists();
    }
    return false;
  }

  /** Get the next available derivation index for a chain. */
  private async getNextDerivationIndex(chain: string): Promise<number> {
    const wallets = await this.walletStore.findAll();
    const hdWallets = wallets.filter(w => w.chain === chain && w.derivationPath);
    if (hdWallets.length === 0) return 0;

    // Parse the last component of each path and find the max
    const indices = hdWallets.map(w => {
      const parts = w.derivationPath!.split('/');
      return parseInt(parts[parts.length - 1].replace("'", ''), 10);
    }).filter(n => !isNaN(n));

    return indices.length > 0 ? Math.max(...indices) + 1 : 0;
  }

  async getWallet(id: string): Promise<Wallet> {
    const wallet = await this.walletStore.findById(id);
    if (!wallet) throw new Error(`Wallet not found: ${id}`);
    return wallet;
  }

  async listWallets(): Promise<Wallet[]> {
    return this.walletStore.findAll();
  }

  async transfer(fromWalletId: string, req: TransferRequest): Promise<Transaction> {
    const source = await this.getWallet(fromWalletId);
    if (source.status !== 'active') throw new Error(`Source wallet is ${source.status}`);
    const dest = await this.getWallet(req.toWalletId);
    const amount = BigInt(req.amount);

    if (amount <= 0n) throw new Error('Amount must be positive');
    if (source.balance < amount) throw new Error('Insufficient balance');

    // Policy evaluation
    const history = await this.transactionStore.findByWalletId(fromWalletId, 1000);
    const evaluations = await this.policyEngine.evaluateTransfer(source, req, history);

    const blocked = evaluations.filter((e) => !e.passed);
    if (blocked.length > 0) {
      const tx: Transaction = {
        id: uuidv4(),
        fromWalletId,
        toWalletId: req.toWalletId,
        amount,
        currency: req.currency,
        status: 'rejected',
        signature: '',
        signedPayload: '',
        policyEvaluations: evaluations,
        failureReason: blocked.map((b) => `${b.policyName}: ${b.reason}`).join('; '),
        memo: req.memo,
        createdAt: new Date(),
      };
      await this.transactionStore.create(tx);
      logger.warn('Transfer rejected by policy', { txId: tx.id, fromWalletId });
      return tx;
    }

    // Build canonical payload and sign with HSM
    const payload = JSON.stringify({
      from: fromWalletId,
      fromAddress: source.address,
      to: req.toWalletId,
      toAddress: dest.address,
      amount: req.amount,
      currency: req.currency,
      chain: source.chain,
      timestamp: new Date().toISOString(),
      nonce: uuidv4(),
    });
    const hash = crypto.createHash('sha256').update(payload).digest();

    let signature: Buffer;
    try {
      if (source.wrappedPrivateKey) {
        // New FIPS 140-3 Level 3 path: unwrap into HSM session, sign, destroy session key
        signature = await this.kms.signWithWrappedKey(source.wrappedPrivateKey, source.algorithm, hash);
      } else {
        // Legacy path: key stored as permanent token object on HSM (pre-ceremony wallets)
        const signResult = await this.kms.sign(source.keyId, hash);
        signature = signResult.signature;
      }
    } catch (error) {
      logger.error('HSM signing failed', { error, fromWalletId });
      throw new Error('Transaction signing failed');
    }

    // Update balances
    await this.walletStore.update(fromWalletId, { balance: source.balance - amount });
    await this.walletStore.update(req.toWalletId, { balance: dest.balance + amount });

    const tx: Transaction = {
      id: uuidv4(),
      fromWalletId,
      toWalletId: req.toWalletId,
      amount,
      currency: req.currency,
      status: 'completed',
      signature: signature.toString('hex'),
      signedPayload: Buffer.from(payload).toString('hex'),
      policyEvaluations: evaluations,
      memo: req.memo,
      createdAt: new Date(),
      completedAt: new Date(),
    };
    await this.transactionStore.create(tx);

    logger.info('Transfer completed', {
      txId: tx.id,
      from: source.address,
      to: dest.address,
      amount: req.amount,
      chain: source.chain,
    });
    return tx;
  }

  async getTransactions(walletId: string, limit?: number, offset?: number): Promise<Transaction[]> {
    await this.getWallet(walletId);
    return this.transactionStore.findByWalletId(walletId, limit, offset);
  }

  async attachPolicy(walletId: string, policyId: string): Promise<Wallet> {
    const wallet = await this.getWallet(walletId);
    await this.policyEngine.getPolicy(policyId);
    if (wallet.policyIds.includes(policyId)) return wallet;
    return this.walletStore.update(walletId, {
      policyIds: [...wallet.policyIds, policyId],
    });
  }

  async detachPolicy(walletId: string, policyId: string): Promise<Wallet> {
    const wallet = await this.getWallet(walletId);
    return this.walletStore.update(walletId, {
      policyIds: wallet.policyIds.filter((id) => id !== policyId),
    });
  }
}
