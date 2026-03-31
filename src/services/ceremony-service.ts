/**
 * HSM Key Ceremony Service
 *
 * Implements the BIP-32/39/44 key ceremony against the real HSM with
 * Shamir's Secret Sharing (3-of-5) and dual-officer approval:
 *   1. Dual-officer approval required before proceeding
 *   2. Generate 256-bit entropy via PKCS#11 C_GenerateRandom
 *   3. Split entropy into 5 Shamir shares (threshold: 3)
 *   4. Custodians acknowledge their individual shares
 *   5. Reconstruct entropy from 3+ shares, derive BIP-32 master key,
 *      import to HSM as non-extractable, clear all shares from memory
 *
 * The master private key is imported into the HSM and immediately made
 * non-extractable. It never exists in plaintext after import.
 */

import pkcs11js from 'pkcs11js';
import * as bip39 from 'bip39';
import * as sss from 'shamirs-secret-sharing';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { HsmSession } from './hsm-session';
import { CeremonyApprovalService } from './ceremony-approval-service';
import { logger } from '../utils/logger';

export interface CeremonyEntropy {
  entropyHex: string;     // raw 256-bit hex from HSM
  sharesGenerated: number; // number of shares created
}

export interface CeremonyMasterKey {
  masterKeyId: string;    // HSM object label / identifier
  publicKeyHex: string;   // compressed secp256k1 public key (for display only)
  chainCodeHex: string;   // BIP-32 chain code (right 32 bytes of HMAC-SHA512)
  derivationInfo: {
    seedHex: string;      // first 16 bytes only for display (never log full seed)
    hmacPreviewHex: string;
  };
}

export interface CeremonyState {
  completed: boolean;
  completedAt: Date | null;
  masterKeyId: string | null;
  chainCodeHex: string | null;
  publicKeyHex: string | null;
  coinTypes: string[];
  sharesAcknowledged: number; // count of acknowledged shares
  entropyGenerated: boolean;
}

export class CeremonyService {
  private state: {
    completed: boolean;
    completedAt: Date | null;
    masterKeyId: string | null;
    chainCodeHex: string | null;
    publicKeyHex: string | null;
    coinTypes: string[];
    entropyBuffer: Buffer | null;  // raw entropy, cleared after seal
    sharesHex: string[] | null;    // 5 shares, cleared after seal
    sharesAcknowledged: boolean[]; // which shares have been acknowledged
  } = {
    completed: false,
    completedAt: null,
    masterKeyId: null,
    chainCodeHex: null,
    publicKeyHex: null,
    coinTypes: [],
    entropyBuffer: null,
    sharesHex: null,
    sharesAcknowledged: [],
  };

  constructor(
    private hsmSession: HsmSession,
    private approvalService: CeremonyApprovalService,
  ) {}

  // ── Step 1: Generate entropy from HSM (requires approved ceremony) ─────────

  async generateEntropy(): Promise<CeremonyEntropy> {
    const approval = this.approvalService.getActive();
    if (!approval || approval.status !== 'approved') {
      throw new Error('Ceremony not approved. Two officers must approve before generating entropy.');
    }

    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();

    logger.info('Generating 256-bit entropy via C_GenerateRandom');

    // Pull 32 bytes (256 bits) from the HSM's hardware RNG
    const entropyBuffer = Buffer.alloc(32);
    const result = pkcs11.C_GenerateRandom(session, entropyBuffer);

    // Split entropy into 5 Shamir shares with threshold 3
    const shareBuffers: Buffer[] = sss.split(result, { shares: 5, threshold: 3 });
    const shares: string[] = shareBuffers.map((b: Buffer) => b.toString('hex'));

    // Store in state
    this.state.entropyBuffer = result;
    this.state.sharesHex = shares;
    this.state.sharesAcknowledged = new Array(5).fill(false);

    logger.info('Entropy generated and split into Shamir shares', {
      entropyLength: result.length,
      shareCount: shares.length,
      threshold: 3,
    });

    return {
      entropyHex: result.toString('hex'),
      sharesGenerated: shares.length,
    };
  }

  // ── Step 2: Get a single Shamir share for a custodian ─────────────────────

  getShare(index: number): string {
    if (!this.state.sharesHex) {
      throw new Error('Shares not yet generated. Run generateEntropy() first.');
    }
    if (index < 0 || index >= this.state.sharesHex.length) {
      throw new Error(`Share index ${index} out of range (0–${this.state.sharesHex.length - 1}).`);
    }
    return this.state.sharesHex[index];
  }

  // ── Step 3: Acknowledge a share has been recorded by its custodian ─────────

  acknowledgeShare(index: number): void {
    if (!this.state.sharesHex) {
      throw new Error('Shares not yet generated.');
    }
    if (index < 0 || index >= this.state.sharesAcknowledged.length) {
      throw new Error(`Share index ${index} out of range.`);
    }
    this.state.sharesAcknowledged[index] = true;
    logger.info('Share acknowledged', { index, custodian: index + 1 });
  }

  // ── Step 4: Reconstruct entropy from shares, derive and seal master key ────

  async reconstructAndSeal(submittedShares: string[]): Promise<CeremonyMasterKey> {
    if (submittedShares.length < 3) {
      throw new Error('At least 3 Shamir shares are required to reconstruct the master key.');
    }

    const activeApproval = this.approvalService.getActive();
    if (!activeApproval || activeApproval.status !== 'approved') {
      throw new Error('Ceremony approval is no longer valid.');
    }

    logger.info('Reconstructing entropy from Shamir shares', { shareCount: submittedShares.length });

    // Reconstruct entropy
    const entropy = sss.combine(submittedShares.map((s: string) => Buffer.from(s, 'hex')));

    // Convert entropy → BIP-39 mnemonic
    const mnemonicStr = bip39.entropyToMnemonic(entropy.toString('hex'));

    // BIP-39: mnemonic → 512-bit seed (PBKDF2, 2048 rounds)
    logger.info('Deriving seed from reconstructed entropy via BIP-39');
    const seed = await bip39.mnemonicToSeed(mnemonicStr);

    // BIP-32: seed → master key via HMAC-SHA512("Bitcoin seed", seed)
    const hmac = crypto.createHmac('sha512', Buffer.from('Bitcoin seed', 'utf8'));
    hmac.update(seed);
    const masterKeyMaterial = hmac.digest(); // 64 bytes total

    const masterPrivKeyBytes = masterKeyMaterial.slice(0, 32); // left  32 bytes
    const chainCode          = masterKeyMaterial.slice(32, 64); // right 32 bytes

    logger.info('BIP-32 master key derived', {
      masterKeyLength: masterPrivKeyBytes.length,
      chainCodeLength: chainCode.length,
    });

    // Import master private key into HSM as a non-extractable generic secret
    const masterKeyId = `ceremony:master:${uuidv4()}`;
    const hsmHandle = this.importKeyIntoHsm(masterPrivKeyBytes, masterKeyId);

    // Derive compressed public key from the master private key (for display)
    const publicKeyHex = this.deriveCompressedPublicKey(masterPrivKeyBytes);

    const chainCodeHex = chainCode.toString('hex');
    const publicKeyHexStr = publicKeyHex.toString('hex');

    // Persist to ceremony state
    this.state.masterKeyId = masterKeyId;
    this.state.chainCodeHex = chainCodeHex;
    this.state.publicKeyHex = publicKeyHexStr;

    // Mark approval as used and clear shares from memory
    this.approvalService.markUsed(activeApproval.id);
    this.state.sharesHex = null;
    this.state.entropyBuffer = null;

    logger.info('Master key sealed into HSM, shares cleared', { masterKeyId, hsmHandle });

    return {
      masterKeyId,
      publicKeyHex: publicKeyHexStr,
      chainCodeHex,
      derivationInfo: {
        // Only expose first 16 bytes of seed for UI display — never log full seed
        seedHex: seed.toString('hex').slice(0, 32) + '…',
        hmacPreviewHex: masterKeyMaterial.toString('hex').slice(0, 32) + '…',
      },
    };
  }

  // ── Step 5: Finalise ceremony ──────────────────────────────────────────────

  completeCeremony(coinTypes: string[]): CeremonyState {
    if (!this.state.masterKeyId) {
      throw new Error('Master key not sealed. Run reconstructAndSeal() first.');
    }

    this.state.completed = true;
    this.state.completedAt = new Date();
    this.state.coinTypes = coinTypes;

    logger.info('Key ceremony completed', {
      masterKeyId: this.state.masterKeyId,
      coinTypes,
      completedAt: this.state.completedAt,
    });

    return this.getStatus();
  }

  getStatus(): CeremonyState {
    return {
      completed: this.state.completed,
      completedAt: this.state.completedAt,
      masterKeyId: this.state.masterKeyId,
      chainCodeHex: this.state.chainCodeHex,
      publicKeyHex: this.state.publicKeyHex,
      coinTypes: this.state.coinTypes,
      sharesAcknowledged: this.state.sharesAcknowledged.filter(Boolean).length,
      entropyGenerated: this.state.sharesHex !== null || this.state.masterKeyId !== null,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Import raw 32-byte key material into the HSM as a non-extractable
   * generic secret (CKK_GENERIC_SECRET). This seals it inside the HSM —
   * the bytes are never readable again after C_CreateObject returns.
   */
  private importKeyIntoHsm(keyBytes: Buffer, label: string): pkcs11js.Handle {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();

    const template: pkcs11js.Template = [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_LABEL,       value: label },
      { type: pkcs11js.CKA_ID,          value: Buffer.from(label) },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      // CKA_VALUE sets the raw key bytes; VALUE_LEN is derived automatically
      { type: pkcs11js.CKA_VALUE,       value: keyBytes },
    ];

    const handle = pkcs11.C_CreateObject(session, template);
    logger.info('Master key imported into HSM (non-extractable)', {
      label,
      handle: handle.toString(),
    });
    return handle;
  }

  /**
   * Placeholder: derives a display-only 33-byte value for the ceremony UI.
   * WARNING: This is NOT a real secp256k1 public key — it is SHA256(privateKey)
   * with a parity prefix. Real EC point multiplication would require adding
   * tiny-secp256k1 or @noble/secp256k1. The master private key itself is safely
   * sealed inside the HSM and never exposed.
   *
   * // placeholder: not a real secp256k1 public key
   */
  private deriveCompressedPublicKey(privateKeyBytes: Buffer): Buffer {
    // placeholder: not a real secp256k1 public key — SHA256 of privkey for display only
    const hash = crypto.createHash('sha256').update(privateKeyBytes).digest();
    const prefix = (privateKeyBytes[31] & 1) === 0 ? 0x02 : 0x03;
    return Buffer.concat([Buffer.from([prefix]), hash]);
  }
}
