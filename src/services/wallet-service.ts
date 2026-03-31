import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { KmsService } from './kms-service';
import { PolicyEngine } from './policy-engine';
import { AddressService } from './address-service';
import {
  Wallet, Transaction, CreateWalletRequest, TransferRequest,
} from '../types/wallet';
import { CHAIN_CONFIGS } from '../types/chain';
import { IWalletStore, ITransactionStore } from '../types/store';
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

    // Auto-select algorithm and currency from chain
    const algorithm = chainConfig.algorithm;
    const currency = req.currency || chainConfig.ticker;

    // Generate HSM key pair
    const keyPair = await this.kms.generateKeyPair(algorithm, `wallet-${req.chain}-${req.name}`);
    const publicKeyHex = keyPair.publicKey.toString('hex');

    // Derive blockchain address from HSM public key
    const address = this.addressService.deriveAddress(publicKeyHex, req.chain);

    const wallet: Wallet = {
      id: uuidv4(),
      vaultId: req.vaultId || '',
      name: req.name,
      keyId: keyPair.keyId,
      chain: req.chain,
      algorithm,
      address,
      publicKey: publicKeyHex,
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
      walletId: wallet.id,
      chain: req.chain,
      address,
      algorithm,
    });
    return wallet;
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
      const signResult = await this.kms.sign(source.keyId, hash);
      signature = signResult.signature;
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
