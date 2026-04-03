/**
 * HSM Key Ceremony Service — FIPS 140-3 Level 3 Compliant
 *
 * Architecture:
 *   The ceremony generates one permanent AES-256 key inside the Luna HSM:
 *
 *   blue:wrap:v1  — Master Wrap Key (CKA_WRAP=true, CKA_EXTRACTABLE=false)
 *     Used to wrap wallet EC private keys via C_WrapKey(CKM_AES_CBC_PAD).
 *     Wrapped blobs are stored in the database. The private key material
 *     NEVER exists in application memory — it exists inside the HSM only
 *     for the brief duration of C_Sign, then is destroyed.
 *
 * Dual control:
 *   Handled at the HSM level via Luna PED (M-of-N physical keys).
 *   This application does not implement software-level dual officer
 *   approval — that was removed as it provided no cryptographic
 *   guarantee and was bypassed by any admin with API access.
 *
 * Disaster recovery:
 *   Handled entirely by the bank's Luna HA cluster and Backup HSM.
 *   Blue Wallets does not implement a software recovery path.
 */

import crypto from 'crypto';
import pkcs11js from 'pkcs11js';
import { HsmSession } from './hsm-session';
import { KmsService } from './kms-service';
import { entropyToMnemonic, mnemonicToSeed, zeroBuffer } from './hd-derivation';
import { logger } from '../utils/logger';

export const WRAP_KEY_LABEL = 'blue:wrap:v1';
export const ENCRYPT_KEY_LABEL = 'blue:encrypt:v1';
export const HD_MASTER_LABEL = 'blue:hd:master:v1';

export interface CeremonyState {
  completed:      boolean;
  completedAt:    Date | null;
  wrapKeyLabel:   string | null;
  keysGenerated:  boolean;
  hdEnabled:      boolean;         // true if blue:hd:master:v1 exists
  hdMasterLabel:  string | null;
}

export interface HdCeremonyResult {
  mnemonic: string;        // 24 words — display ONCE, then zero
  mnemonicHash: string;    // SHA-256 of mnemonic for verification
  masterSeedLabel: string;
  wrappedBackup: string;   // iv:ciphertext — disaster recovery blob
}

export class CeremonyService {
  private state = {
    completed:    false,
    completedAt:  null as Date | null,
    wrapKeyLabel: null as string | null,
    keysGenerated: false,
    hdEnabled:    false,
    hdMasterLabel: null as string | null,
  };

  constructor(
    private hsmSession: HsmSession,
    private kms?: KmsService,
  ) {}

  /**
   * Called on server startup (or after HSM reconnect).
   * Checks whether master keys already exist on the HSM partition.
   * If they do, marks the ceremony as previously completed so the dashboard
   * shows the correct state without requiring re-ceremony.
   */
  async initialize(): Promise<void> {
    try {
      if (this.hsmSession.isConnected()) {
        if (this.wrapKeyExistsOnHsm()) {
          this.state.keysGenerated = true;
          this.state.wrapKeyLabel  = WRAP_KEY_LABEL;
          this.state.completed     = true;
          logger.info('Key ceremony: master wrap key found on HSM — ceremony previously completed');
        }
        // Check for HD master seed
        if (this.kms?.hdMasterExists()) {
          this.state.hdEnabled     = true;
          this.state.hdMasterLabel = HD_MASTER_LABEL;
          logger.info('HD master seed found on HSM', { label: HD_MASTER_LABEL });
        }
      }
    } catch {
      // HSM not connected yet — that is fine, ceremony will run later
    }
  }

  /**
   * Generate the master wrap key inside the HSM.
   *
   * Any authenticated admin can trigger this — real dual control is
   * enforced at the HSM level via Luna PED (M-of-N physical keys).
   *
   * The key is generated entirely inside the HSM boundary via C_GenerateKey.
   * CKA_SENSITIVE=true  — cannot be read in plaintext
   * CKA_EXTRACTABLE=false — cannot leave the HSM under any circumstance
   *
   * Idempotent: if blue:wrap:v1 already exists, marks it as active and returns.
   */
  async generateMasterKeys(): Promise<{ wrapKeyLabel: string }> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    // Idempotent check — key may already exist from a prior run
    if (this.wrapKeyExistsOnHsm()) {
      logger.info('Master wrap key already exists on HSM, reusing', { label: WRAP_KEY_LABEL });
      this.state.wrapKeyLabel  = WRAP_KEY_LABEL;
      this.state.keysGenerated = true;
      this.state.completed     = true;
      this.state.completedAt   = new Date();
      return { wrapKeyLabel: WRAP_KEY_LABEL };
    }

    logger.info('Generating master wrap key on HSM', { label: WRAP_KEY_LABEL });

    /*
     * AES-256 Master Wrap Key
     * ─────────────────────────────────────────────────────────────────────
     * CKA_TOKEN=true         Permanent token object (survives session close)
     * CKA_PRIVATE=true       Requires authenticated session to access
     * CKA_SENSITIVE=true     Cannot be read in plaintext via GetAttributeValue
     * CKA_EXTRACTABLE=false  Cannot leave HSM — not even via C_WrapKey
     * CKA_WRAP=true          Can wrap (encrypt) other key objects
     * CKA_UNWRAP=true        Can unwrap (decrypt) wrapped key objects
     * CKA_MODIFIABLE=false   Attributes are immutable after creation
     */
    const wrapKeyTemplate: pkcs11js.Template = [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_AES },
      { type: pkcs11js.CKA_VALUE_LEN,   value: 32 },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_PRIVATE,     value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_WRAP,        value: true },
      { type: pkcs11js.CKA_UNWRAP,      value: true },
      { type: pkcs11js.CKA_MODIFIABLE,  value: false },
      { type: pkcs11js.CKA_LABEL,       value: WRAP_KEY_LABEL },
      { type: pkcs11js.CKA_ID,          value: Buffer.from(WRAP_KEY_LABEL) },
    ];

    pkcs11.C_GenerateKey(
      session,
      { mechanism: pkcs11js.CKM_AES_KEY_GEN },
      wrapKeyTemplate,
    );

    this.state.wrapKeyLabel  = WRAP_KEY_LABEL;
    this.state.keysGenerated = true;
    this.state.completed     = true;
    this.state.completedAt   = new Date();

    logger.info('Master wrap key generated and sealed into HSM', {
      label: WRAP_KEY_LABEL,
      algorithm: 'AES-256',
      extractable: false,
    });

    return { wrapKeyLabel: WRAP_KEY_LABEL };
  }

  getStatus(): CeremonyState {
    // Always do a live HSM check so status survives server restarts
    const keyOnHsm = this.hsmSession.isConnected() ? this.wrapKeyExistsOnHsm() : false;
    const hdOnHsm  = this.hsmSession.isConnected() && this.kms ? this.kms.hdMasterExists() : false;

    if (keyOnHsm && !this.state.keysGenerated) {
      this.state.keysGenerated = true;
      this.state.wrapKeyLabel  = WRAP_KEY_LABEL;
      this.state.completed     = true;
    }
    if (hdOnHsm) {
      this.state.hdEnabled     = true;
      this.state.hdMasterLabel = HD_MASTER_LABEL;
    }

    return {
      completed:     this.state.completed || keyOnHsm,
      completedAt:   this.state.completedAt,
      wrapKeyLabel:  keyOnHsm ? WRAP_KEY_LABEL : null,
      keysGenerated: keyOnHsm || this.state.keysGenerated,
      hdEnabled:     hdOnHsm || this.state.hdEnabled,
      hdMasterLabel: hdOnHsm ? HD_MASTER_LABEL : this.state.hdMasterLabel,
    };
  }

  /**
   * Generate a BIP-39 mnemonic → BIP-32 master seed → import to HSM → wrap backup.
   *
   * The mnemonic is returned ONCE and must be displayed to the officer for backup.
   * It is never stored by the application.
   *
   * Requires: blue:wrap:v1 must exist (run generateMasterKeys first).
   * Requires: KmsService must be injected.
   */
  async generateHdMasterSeed(): Promise<HdCeremonyResult> {
    if (!this.kms) throw new Error('KmsService not available — cannot generate HD seed');

    // Ensure master wrap key exists
    if (!this.wrapKeyExistsOnHsm()) {
      await this.generateMasterKeys();
    }

    // Check if HD seed already exists
    if (this.kms.hdMasterExists()) {
      throw new Error('HD master seed already exists on HSM. To regenerate, destroy the existing key first.');
    }

    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    // Ensure the encrypt key exists (for Strategy B: C_Encrypt/C_Decrypt of child keys)
    await this.ensureEncryptKey(session, pkcs11);

    // Generate 32 bytes of entropy from HSM (FIPS-quality randomness)
    const entropy = Buffer.from(pkcs11.C_GenerateRandom(session, Buffer.alloc(32)));
    const entropyHex = entropy.toString('hex');

    // BIP-39: entropy → mnemonic (24 words)
    const mnemonic = entropyToMnemonic(entropyHex);
    const mnemonicHash = crypto.createHash('sha256').update(mnemonic).digest('hex');

    // BIP-32: mnemonic → 64-byte master seed
    const seedBuffer = mnemonicToSeed(mnemonic);

    try {
      // Import seed to HSM as permanent generic secret
      const { label } = await this.kms.importMasterSeed(seedBuffer);

      // Wrap seed for disaster recovery backup
      const wrappedBackup = await this.kms.wrapMasterSeedForBackup();

      // Update state
      this.state.hdEnabled     = true;
      this.state.hdMasterLabel = label;

      logger.info('HD master seed generated and imported to HSM', {
        label,
        mnemonicHash: mnemonicHash.slice(0, 16) + '...',
      });

      return { mnemonic, mnemonicHash, masterSeedLabel: label, wrappedBackup };
    } finally {
      // Zero sensitive material from app memory
      zeroBuffer(entropy);
      zeroBuffer(seedBuffer);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Ensure the AES-256 encrypt key (blue:encrypt:v1) exists on the HSM.
   * This key has CKA_ENCRYPT=true, CKA_DECRYPT=true for encrypting child key bytes
   * as raw data (Strategy B for partitions that don't allow EC key wrapping).
   */
  private async ensureEncryptKey(session: any, pkcs11: any): Promise<void> {
    // Check if it already exists
    try {
      pkcs11.C_FindObjectsInit(session, [
        { type: pkcs11js.CKA_LABEL, value: ENCRYPT_KEY_LABEL },
        { type: pkcs11js.CKA_TOKEN, value: true },
      ]);
      const handle = pkcs11.C_FindObjects(session);
      pkcs11.C_FindObjectsFinal(session);
      if (handle) {
        logger.info('Encrypt key already exists on HSM', { label: ENCRYPT_KEY_LABEL });
        return;
      }
    } catch { /* not found — generate below */ }

    logger.info('Generating encrypt key on HSM', { label: ENCRYPT_KEY_LABEL });

    pkcs11.C_GenerateKey(session, { mechanism: pkcs11js.CKM_AES_KEY_GEN }, [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_AES },
      { type: pkcs11js.CKA_VALUE_LEN,   value: 32 },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_PRIVATE,     value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_ENCRYPT,     value: true },
      { type: pkcs11js.CKA_DECRYPT,     value: true },
      { type: pkcs11js.CKA_MODIFIABLE,  value: false },
      { type: pkcs11js.CKA_LABEL,       value: ENCRYPT_KEY_LABEL },
      { type: pkcs11js.CKA_ID,          value: Buffer.from(ENCRYPT_KEY_LABEL) },
    ]);

    logger.info('Encrypt key generated and sealed into HSM', {
      label: ENCRYPT_KEY_LABEL,
      algorithm: 'AES-256',
      encrypt: true, decrypt: true, extractable: false,
    });
  }

  private wrapKeyExistsOnHsm(): boolean {
    try {
      const session = this.hsmSession.getSession();
      const pkcs11  = this.hsmSession.getPkcs11();
      pkcs11.C_FindObjectsInit(session, [
        { type: pkcs11js.CKA_LABEL, value: WRAP_KEY_LABEL },
        { type: pkcs11js.CKA_TOKEN, value: true },
      ]);
      const handle = pkcs11.C_FindObjects(session);
      pkcs11.C_FindObjectsFinal(session);
      return !!handle;
    } catch {
      return false;
    }
  }
}
