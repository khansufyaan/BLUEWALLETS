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

import pkcs11js from 'pkcs11js';
import { HsmSession } from './hsm-session';
import { logger } from '../utils/logger';

export const WRAP_KEY_LABEL = 'blue:wrap:v1';

export interface CeremonyState {
  completed:      boolean;
  completedAt:    Date | null;
  wrapKeyLabel:   string | null;   // label of the wrap key on HSM
  keysGenerated:  boolean;         // true if blue:wrap:v1 exists on HSM
}

export class CeremonyService {
  private state = {
    completed:    false,
    completedAt:  null as Date | null,
    wrapKeyLabel: null as string | null,
    keysGenerated: false,
  };

  constructor(
    private hsmSession: HsmSession,
  ) {}

  /**
   * Called on server startup (or after HSM reconnect).
   * Checks whether master keys already exist on the HSM partition.
   * If they do, marks the ceremony as previously completed so the dashboard
   * shows the correct state without requiring re-ceremony.
   */
  async initialize(): Promise<void> {
    try {
      if (this.hsmSession.isConnected() && this.wrapKeyExistsOnHsm()) {
        this.state.keysGenerated = true;
        this.state.wrapKeyLabel  = WRAP_KEY_LABEL;
        this.state.completed     = true;
        logger.info('Key ceremony: master wrap key found on HSM — ceremony previously completed');
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
    if (keyOnHsm && !this.state.keysGenerated) {
      this.state.keysGenerated = true;
      this.state.wrapKeyLabel  = WRAP_KEY_LABEL;
      this.state.completed     = true;
    }
    return {
      completed:     this.state.completed || keyOnHsm,
      completedAt:   this.state.completedAt,
      wrapKeyLabel:  keyOnHsm ? WRAP_KEY_LABEL : null,
      keysGenerated: keyOnHsm || this.state.keysGenerated,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

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
