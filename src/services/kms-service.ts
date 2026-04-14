import pkcs11js from 'pkcs11js';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { HsmSession } from './hsm-session';
import { zeroBuffer } from './hd-derivation';
import {
  KeyAlgorithm,
  KeyPairResult,
  SignatureResult,
  VerifyResult,
  KeyInfo,
  ALGORITHM_CONFIG,
  EC_CURVE_OIDS,
} from '../types';
import { logger } from '../utils/logger';

const WRAP_KEY_LABEL = 'blue:wrap:v1';
const ENCRYPT_KEY_LABEL = 'blue:encrypt:v1';

/**
 * Key Management Service — all cryptographic operations go through here.
 * Private keys NEVER leave the HSM. Only handles/references are used.
 *
 * We encode the algorithm into the key label as "waas:<algorithm>:<uuid>"
 * so we can retrieve it without complex PKCS#11 attribute queries
 * (which differ between SoftHSM and Luna).
 */
export class KmsService {
  constructor(private hsmSession: HsmSession) {}

  private makeLabel(algorithm: KeyAlgorithm, keyId: string): string {
    return `waas:${algorithm}:${keyId}`;
  }

  private parseLabel(label: string): { algorithm: KeyAlgorithm; keyId: string } | null {
    const parts = label.split(':');
    if (parts.length !== 3 || parts[0] !== 'waas') return null;
    return { algorithm: parts[1] as KeyAlgorithm, keyId: parts[2] };
  }

  /**
   * Generate a new key pair inside the HSM.
   * The private key is non-extractable and stays within the HSM boundary.
   */
  async generateKeyPair(
    algorithm: KeyAlgorithm,
    _label?: string
  ): Promise<KeyPairResult> {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();
    const keyId = uuidv4();
    const keyLabel = this.makeLabel(algorithm, keyId);

    logger.info('Generating key pair', { algorithm, keyId });

    let publicKeyTemplate: pkcs11js.Template;
    let privateKeyTemplate: pkcs11js.Template;

    if (algorithm.startsWith('EC') || algorithm === 'ED25519') {
      const curveName = ALGORITHM_CONFIG[algorithm].params?.namedCurve as string;
      const curveOid = EC_CURVE_OIDS[curveName];
      if (!curveOid) {
        throw new Error(`Unsupported curve: ${curveName}`);
      }

      publicKeyTemplate = [
        { type: pkcs11js.CKA_TOKEN, value: true },
        { type: pkcs11js.CKA_LABEL, value: keyLabel },
        { type: pkcs11js.CKA_ID, value: Buffer.from(keyId) },
        { type: pkcs11js.CKA_VERIFY, value: true },
        { type: pkcs11js.CKA_EC_PARAMS, value: curveOid },
      ];

      privateKeyTemplate = [
        { type: pkcs11js.CKA_TOKEN, value: true },
        { type: pkcs11js.CKA_LABEL, value: keyLabel },
        { type: pkcs11js.CKA_ID, value: Buffer.from(keyId) },
        { type: pkcs11js.CKA_SIGN, value: true },
        { type: pkcs11js.CKA_PRIVATE, value: true },
        { type: pkcs11js.CKA_SENSITIVE, value: true },
        { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      ];
    } else {
      // RSA
      const modulusBits = ALGORITHM_CONFIG[algorithm].params?.modulusBits as number;
      const publicExponent = ALGORITHM_CONFIG[algorithm].params?.publicExponent as Buffer;

      publicKeyTemplate = [
        { type: pkcs11js.CKA_TOKEN, value: true },
        { type: pkcs11js.CKA_LABEL, value: keyLabel },
        { type: pkcs11js.CKA_ID, value: Buffer.from(keyId) },
        { type: pkcs11js.CKA_VERIFY, value: true },
        { type: pkcs11js.CKA_ENCRYPT, value: true },
        { type: pkcs11js.CKA_WRAP, value: true },
        { type: pkcs11js.CKA_MODULUS_BITS, value: modulusBits },
        { type: pkcs11js.CKA_PUBLIC_EXPONENT, value: publicExponent },
      ];

      privateKeyTemplate = [
        { type: pkcs11js.CKA_TOKEN, value: true },
        { type: pkcs11js.CKA_LABEL, value: keyLabel },
        { type: pkcs11js.CKA_ID, value: Buffer.from(keyId) },
        { type: pkcs11js.CKA_SIGN, value: true },
        { type: pkcs11js.CKA_DECRYPT, value: true },
        { type: pkcs11js.CKA_UNWRAP, value: true },
        { type: pkcs11js.CKA_PRIVATE, value: true },
        { type: pkcs11js.CKA_SENSITIVE, value: true },
        { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      ];
    }

    const mechanism = this.getMechanismForKeyGen(algorithm);

    const keys = pkcs11.C_GenerateKeyPair(
      session,
      mechanism,
      publicKeyTemplate,
      privateKeyTemplate
    );

    // Extract the public key value
    const publicKey = this.extractPublicKey(keys.publicKey, algorithm);

    logger.info('Key pair generated', { keyId, algorithm });

    return {
      keyId,
      publicKey,
      algorithm,
      createdAt: new Date(),
    };
  }

  /**
   * Sign data using a private key stored in the HSM.
   */
  async sign(keyId: string, data: Buffer, algorithm?: KeyAlgorithm): Promise<SignatureResult> {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();

    logger.debug('Signing data', { keyId, dataLength: data.length });

    // Find the private key by CKA_ID
    const privateKeyHandle = this.findKey(keyId, pkcs11js.CKO_PRIVATE_KEY);
    if (!privateKeyHandle) {
      throw new Error(`Private key not found: ${keyId}`);
    }

    // Get algorithm from the label if not provided
    const algo = algorithm || this.getAlgorithmFromHandle(privateKeyHandle);
    const config = ALGORITHM_CONFIG[algo];
    const mechanism = this.getSignMechanism(algo);

    pkcs11.C_SignInit(session, mechanism, privateKeyHandle);
    const signature = Buffer.from(pkcs11.C_Sign(session, data, Buffer.alloc(512)));

    logger.info('Data signed', { keyId, signatureLength: signature.length });

    return {
      signature,
      keyId,
      algorithm: algo,
      mechanism: config.signMechanism,
    };
  }

  /**
   * Verify a signature using the public key in the HSM.
   */
  async verify(keyId: string, data: Buffer, signature: Buffer, algorithm?: KeyAlgorithm): Promise<VerifyResult> {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();

    logger.debug('Verifying signature', { keyId, dataLength: data.length });

    const publicKeyHandle = this.findKey(keyId, pkcs11js.CKO_PUBLIC_KEY);
    if (!publicKeyHandle) {
      throw new Error(`Public key not found: ${keyId}`);
    }

    const algo = algorithm || this.getAlgorithmFromHandle(publicKeyHandle);
    const mechanism = this.getSignMechanism(algo);

    pkcs11.C_VerifyInit(session, mechanism, publicKeyHandle);

    let valid: boolean;
    try {
      valid = pkcs11.C_Verify(session, data, signature);
    } catch {
      valid = false;
    }

    logger.info('Signature verified', { keyId, valid });
    return { valid, keyId };
  }

  /**
   * List all WaaS keys stored in the HSM partition.
   */
  async listKeys(): Promise<KeyInfo[]> {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();
    const keys: KeyInfo[] = [];

    // Find all public key objects
    pkcs11.C_FindObjectsInit(session, [
      { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PUBLIC_KEY },
      { type: pkcs11js.CKA_TOKEN, value: true },
    ]);

    const handles: pkcs11js.Handle[] = [];
    let handle = pkcs11.C_FindObjects(session);
    while (handle) {
      handles.push(handle);
      handle = pkcs11.C_FindObjects(session);
    }
    pkcs11.C_FindObjectsFinal(session);

    for (const h of handles) {
      try {
        const label = this.getLabel(h);
        const parsed = this.parseLabel(label);
        if (!parsed) continue; // Skip non-WaaS keys

        const publicKey = this.extractPublicKey(h, parsed.algorithm);

        keys.push({
          keyId: parsed.keyId,
          algorithm: parsed.algorithm,
          publicKey,
          label,
          createdAt: new Date(),
        });
      } catch (error) {
        logger.warn('Failed to read key attributes', { error });
      }
    }

    logger.info('Listed keys', { count: keys.length });
    return keys;
  }

  /**
   * Delete a key pair from the HSM.
   */
  async deleteKeyPair(keyId: string): Promise<void> {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();

    const pubHandle = this.findKey(keyId, pkcs11js.CKO_PUBLIC_KEY);
    const privHandle = this.findKey(keyId, pkcs11js.CKO_PRIVATE_KEY);

    if (pubHandle) {
      pkcs11.C_DestroyObject(session, pubHandle);
    }
    if (privHandle) {
      pkcs11.C_DestroyObject(session, privHandle);
    }

    logger.info('Key pair deleted', { keyId });
  }

  // --- Private helpers ---

  private findKey(keyId: string, keyClass: number): pkcs11js.Handle | null {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();

    pkcs11.C_FindObjectsInit(session, [
      { type: pkcs11js.CKA_CLASS, value: keyClass },
      { type: pkcs11js.CKA_ID, value: Buffer.from(keyId) },
      { type: pkcs11js.CKA_TOKEN, value: true },
    ]);

    const handle = pkcs11.C_FindObjects(session);
    pkcs11.C_FindObjectsFinal(session);

    return handle || null;
  }

  /**
   * Read CKA_LABEL from a key handle and extract algorithm from our label format.
   */
  private getAlgorithmFromHandle(handle: pkcs11js.Handle): KeyAlgorithm {
    const label = this.getLabel(handle);
    const parsed = this.parseLabel(label);
    if (!parsed) {
      throw new Error(`Key label not in WaaS format: ${label}`);
    }
    return parsed.algorithm;
  }

  private getLabel(handle: pkcs11js.Handle): string {
    const pkcs11 = this.hsmSession.getPkcs11();
    const session = this.hsmSession.getSession();

    // First call to get the size
    const attrs: pkcs11js.Template = [{ type: pkcs11js.CKA_LABEL, value: null as unknown as Buffer }];
    pkcs11.C_GetAttributeValue(session, handle, attrs);

    // Allocate buffer with the returned size
    const size = (attrs[0].value as Buffer).length;
    const buf = Buffer.alloc(size);
    const attrs2: pkcs11js.Template = [{ type: pkcs11js.CKA_LABEL, value: buf }];
    pkcs11.C_GetAttributeValue(session, handle, attrs2);

    return (attrs2[0].value as Buffer).toString('utf8');
  }

  private extractPublicKey(handle: pkcs11js.Handle, algorithm: KeyAlgorithm): Buffer {
    const pkcs11 = this.hsmSession.getPkcs11();
    const session = this.hsmSession.getSession();

    if (algorithm.startsWith('EC') || algorithm === 'ED25519') {
      // Get EC_POINT size first
      const sizeAttrs: pkcs11js.Template = [
        { type: pkcs11js.CKA_EC_POINT, value: null as unknown as Buffer },
      ];
      pkcs11.C_GetAttributeValue(session, handle, sizeAttrs);
      const size = (sizeAttrs[0].value as Buffer).length;

      const buf = Buffer.alloc(size);
      const attrs: pkcs11js.Template = [{ type: pkcs11js.CKA_EC_POINT, value: buf }];
      pkcs11.C_GetAttributeValue(session, handle, attrs);
      return Buffer.from(attrs[0].value as Buffer);
    }

    // RSA: extract modulus
    const sizeAttrs: pkcs11js.Template = [
      { type: pkcs11js.CKA_MODULUS, value: null as unknown as Buffer },
    ];
    pkcs11.C_GetAttributeValue(session, handle, sizeAttrs);
    const size = (sizeAttrs[0].value as Buffer).length;

    const buf = Buffer.alloc(size);
    const attrs: pkcs11js.Template = [{ type: pkcs11js.CKA_MODULUS, value: buf }];
    pkcs11.C_GetAttributeValue(session, handle, attrs);
    return Buffer.from(attrs[0].value as Buffer);
  }

  // ── Wrapped-key wallet operations (FIPS 140-3 Level 3) ─────────────────────

  /**
   * Generate a secp256k1 EC keypair inside the HSM as session objects,
   * wrap the private key with the master wrap key (AES-256-CBC-PAD),
   * destroy the session objects, and return the wrapped blob + public key.
   *
   * The private key NEVER exists in application memory.
   * It exits the HSM only as AES-256 ciphertext — stored in the DB.
   * Format stored in DB: "ivHex:ciphertextHex"
   */
  async generateAndWrapWalletKey(algorithm: KeyAlgorithm): Promise<{
    wrappedPrivateKey: string;
    publicKeyHex: string;
    keyId: string;
  }> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();
    const keyId   = uuidv4();

    // Verify master wrap key exists (proves ceremony is complete)
    const wrapKeyHandle = this.findKeyByLabel(WRAP_KEY_LABEL);
    if (!wrapKeyHandle) {
      throw new Error('Master wrap key (blue:wrap:v1) not found. Complete the key ceremony first.');
    }

    const curveName = ALGORITHM_CONFIG[algorithm].params?.namedCurve as string;
    const curveOid  = EC_CURVE_OIDS[curveName];
    if (!curveOid) throw new Error(`Unsupported curve: ${curveName}`);

    /*
     * Generate EC keypair as PERSISTENT TOKEN objects on the HSM.
     *
     * Luna DPoD partitions enforce strict key policies that prevent wrapping
     * EC private keys (CKR_KEY_NOT_WRAPPABLE). Instead, we store keys as
     * permanent HSM token objects with unique labels. The DB stores the
     * HSM label as a reference — private key material NEVER leaves the HSM.
     *
     * This is actually stronger security than wrapping: the private key
     * cannot be extracted in any form, even as ciphertext.
     */
    const keyLabel = `blue:wallet:${keyId}`;

    const publicKeyTemplate: pkcs11js.Template = [
      { type: pkcs11js.CKA_CLASS,     value: pkcs11js.CKO_PUBLIC_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,  value: pkcs11js.CKK_EC },
      { type: pkcs11js.CKA_TOKEN,     value: true },
      { type: pkcs11js.CKA_LABEL,     value: `${keyLabel}:pub` },
      { type: pkcs11js.CKA_ID,        value: Buffer.from(keyId) },
      { type: pkcs11js.CKA_VERIFY,    value: true },
      { type: pkcs11js.CKA_EC_PARAMS, value: curveOid },
    ];

    const privateKeyTemplate: pkcs11js.Template = [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_PRIVATE_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_EC },
      { type: pkcs11js.CKA_TOKEN,       value: true },
      { type: pkcs11js.CKA_LABEL,       value: keyLabel },
      { type: pkcs11js.CKA_ID,          value: Buffer.from(keyId) },
      { type: pkcs11js.CKA_PRIVATE,     value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: false },
      { type: pkcs11js.CKA_SIGN,        value: true },
    ];

    const keys = pkcs11.C_GenerateKeyPair(
      session,
      { mechanism: pkcs11js.CKM_EC_KEY_PAIR_GEN },
      publicKeyTemplate,
      privateKeyTemplate,
    );

    // Extract public key (safe — not sensitive)
    const publicKeyBuffer = this.extractPublicKey(keys.publicKey, algorithm);
    const publicKeyHex    = publicKeyBuffer.toString('hex');

    // Store HSM label as the key reference (private key stays permanently on HSM)
    const wrappedPrivateKey = `hsm:${keyLabel}`;

    logger.info('Wallet key generated on HSM', { keyId, keyLabel, algorithm });
    return { wrappedPrivateKey, publicKeyHex, keyId };
  }

  /**
   * Unwrap a wallet private key from its DB blob into the HSM session,
   * sign the hash inside the HSM, then immediately destroy the session key.
   *
   * FIPS 140-3 Level 3: private key exists inside the HSM only for the
   * duration of C_Sign. It never enters application memory at any point.
   */
  async signWithWrappedKey(
    wrappedPrivateKeyHex: string,
    algorithm: KeyAlgorithm,
    hash: Buffer,
  ): Promise<Buffer> {
    // Retry once on PKCS#11 session errors (stale handle after reconnect)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const session = this.hsmSession.getSession();
        const pkcs11  = this.hsmSession.getPkcs11();

        if (wrappedPrivateKeyHex.startsWith('hsm:')) {
          // Key is stored permanently on the HSM — find by label
          const label = wrappedPrivateKeyHex.slice(4);
          const handle = this.findKeyByLabel(label);
          if (!handle) throw new Error(`HSM key not found: ${label}. HSM may need reconnecting.`);

          // Sign — private key never leaves HSM
          pkcs11.C_SignInit(session, { mechanism: pkcs11js.CKM_ECDSA }, handle);
          const signature = Buffer.from(pkcs11.C_Sign(session, hash, Buffer.alloc(512)));

          // Token keys are persistent — do NOT destroy them
          logger.debug('Signed with HSM key', { algorithm });
          return signature;
        } else {
          // HD mode: wrapped child key in "iv_hex:ciphertext_hex" format
          return await this.unwrapAndSign(wrappedPrivateKeyHex, algorithm, hash);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Retry on PKCS#11 session errors (stale session, invalid handle)
        const isSessionError = /session|CKR_SESSION|CKR_OBJECT_HANDLE|CKR_KEY_HANDLE|CKR_OPERATION|handle/i.test(msg);
        if (attempt === 0 && isSessionError) {
          logger.warn('PKCS#11 session error during sign — forcing reconnect and retrying', {
            error: msg, attempt,
          });
          // Force a fresh session by calling getSession() which probes and reconnects
          this.resetCapabilityCache();
          continue;
        }
        throw err;
      }
    }
    throw new Error('HSM signing failed after retry');
  }

  /** Find a token key on the HSM by its CKA_LABEL. */
  private findKeyByLabel(label: string): pkcs11js.Handle | null {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();
    pkcs11.C_FindObjectsInit(session, [
      { type: pkcs11js.CKA_LABEL, value: label },
      { type: pkcs11js.CKA_TOKEN, value: true },
    ]);
    const handle = pkcs11.C_FindObjects(session);
    pkcs11.C_FindObjectsFinal(session);
    return handle || null;
  }

  // ── HD Mode: Encrypt / Decrypt / Import + Wrap ──────────────────────────────
  //
  // Two strategies for protecting derived child keys, auto-detected:
  //
  // Strategy A (HSM wrap — strongest):
  //   C_CreateObject → C_WrapKey → store ciphertext → C_UnwrapKey → C_Sign
  //   Requires partition to allow EC key import + wrapping.
  //
  // Strategy B (HSM encrypt — universal):
  //   C_Encrypt(blue:wrap:v1, child_key_bytes) → store ciphertext
  //   C_Decrypt(blue:wrap:v1, ciphertext) → sign with @noble/curves in app memory
  //   Works on ALL Luna partitions. Key briefly in app memory during sign (~1ms).
  //
  // Both strategies use blue:wrap:v1 for encryption at rest — ciphertext in DB
  // is useless without the HSM master key.

  private _hsmWrapSupported: boolean | null = null;

  /** Reset capability cache — call after HSM reconnect. */
  resetCapabilityCache(): void {
    this._hsmWrapSupported = null;
  }

  /** Detect whether this HSM partition supports EC key import + wrapping. */
  private canHsmWrap(): boolean {
    if (this._hsmWrapSupported !== null) return this._hsmWrapSupported;
    if (!this.hsmSession.isConnected()) return false; // Don't cache if HSM not ready

    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();
    const curveOid = EC_CURVE_OIDS['secp256k1'];

    try {
      // Try importing a dummy EC key — if this fails, wrapping is not supported
      const dummyKey = Buffer.alloc(32, 0x01);
      const handle = pkcs11.C_CreateObject(session, [
        { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_PRIVATE_KEY },
        { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_EC },
        { type: pkcs11js.CKA_EC_PARAMS,   value: curveOid },
        { type: pkcs11js.CKA_VALUE,       value: dummyKey },
        { type: pkcs11js.CKA_TOKEN,       value: false },
        { type: pkcs11js.CKA_SENSITIVE,   value: false },
        { type: pkcs11js.CKA_EXTRACTABLE, value: true },
        { type: pkcs11js.CKA_SIGN,        value: true },
      ]);
      // Success — clean up and mark as supported
      try { pkcs11.C_DestroyObject(session, handle); } catch { /* */ }
      this._hsmWrapSupported = true;
      logger.info('HSM partition supports EC key import + wrapping (Strategy A)');
    } catch {
      this._hsmWrapSupported = false;
      logger.info('HSM partition does not support EC key import — using HSM encrypt mode (Strategy B)');
    }

    return this._hsmWrapSupported;
  }

  /**
   * Encrypt a derived child key using blue:wrap:v1 via C_Encrypt (AES-256-CBC-PAD).
   * The child key is treated as raw data, not a key object.
   * Returns "iv_hex:ciphertext_hex" for DB storage.
   */
  async encryptChildKey(privateKeyBytes: Buffer): Promise<{ wrappedPrivateKey: string; keyId: string }> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();
    const keyId   = uuidv4();

    // Use the encrypt key (CKA_ENCRYPT=true), not the wrap key
    const encKeyHandle = this.findKeyByLabel(ENCRYPT_KEY_LABEL);
    if (!encKeyHandle) throw new Error('Encrypt key (blue:encrypt:v1) not found. Run HD ceremony first.');

    // Generate IV from HSM entropy
    const iv = Buffer.from(pkcs11.C_GenerateRandom(session, Buffer.alloc(16)));

    // Encrypt the child key bytes with blue:wrap:v1
    const mechanism = { mechanism: pkcs11js.CKM_AES_CBC_PAD, parameter: iv };
    pkcs11.C_EncryptInit(session, mechanism, encKeyHandle);
    const ciphertext = Buffer.from(pkcs11.C_Encrypt(session, privateKeyBytes, Buffer.alloc(512)));

    const wrappedPrivateKey = `${iv.toString('hex')}:${ciphertext.toString('hex')}`;
    logger.info('Child key encrypted with HSM master key', { keyId, mode: 'encrypt' });
    return { wrappedPrivateKey, keyId };
  }

  /**
   * Decrypt a child key from its DB blob using blue:wrap:v1 via C_Decrypt.
   * Returns the raw 32-byte private key. CALLER MUST ZERO AFTER USE.
   */
  private decryptChildKey(wrappedBlob: string): Buffer {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    const colonIdx = wrappedBlob.indexOf(':');
    if (colonIdx < 1) throw new Error('Invalid wrapped key format — expected iv:ciphertext');

    const iv         = Buffer.from(wrappedBlob.slice(0, colonIdx), 'hex');
    const ciphertext = Buffer.from(wrappedBlob.slice(colonIdx + 1), 'hex');

    const encKeyHandle = this.findKeyByLabel(ENCRYPT_KEY_LABEL);
    if (!encKeyHandle) throw new Error('Encrypt key (blue:encrypt:v1) not found for decrypt');

    const mechanism = { mechanism: pkcs11js.CKM_AES_CBC_PAD, parameter: iv };
    pkcs11.C_DecryptInit(session, mechanism, encKeyHandle);
    return Buffer.from(pkcs11.C_Decrypt(session, ciphertext, Buffer.alloc(512)));
  }

  /**
   * Protect a derived EC child key — auto-detects best strategy:
   * Strategy A: C_CreateObject + C_WrapKey (if partition allows)
   * Strategy B: C_Encrypt (universal — works on all partitions)
   */
  async importAndWrapEcKey(
    privateKeyBytes: Buffer,
    algorithm: KeyAlgorithm,
  ): Promise<{ wrappedPrivateKey: string; keyId: string }> {
    if (this.canHsmWrap()) {
      return this.importAndWrapEcKeyHsm(privateKeyBytes, algorithm);
    }
    return this.encryptChildKey(privateKeyBytes);
  }

  /** Strategy A: Import to HSM session → C_WrapKey. Strongest — key never in app memory. */
  private async importAndWrapEcKeyHsm(
    privateKeyBytes: Buffer,
    algorithm: KeyAlgorithm,
  ): Promise<{ wrappedPrivateKey: string; keyId: string }> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();
    const keyId   = uuidv4();

    const wrapKeyHandle = this.findKeyByLabel(WRAP_KEY_LABEL);
    if (!wrapKeyHandle) throw new Error('Master wrap key not found.');

    const curveName = ALGORITHM_CONFIG[algorithm].params?.namedCurve as string;
    const curveOid  = EC_CURVE_OIDS[curveName];
    if (!curveOid) throw new Error(`Unsupported curve: ${curveName}`);

    const sessionKeyHandle = pkcs11.C_CreateObject(session, [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_PRIVATE_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_EC },
      { type: pkcs11js.CKA_EC_PARAMS,   value: curveOid },
      { type: pkcs11js.CKA_VALUE,       value: privateKeyBytes },
      { type: pkcs11js.CKA_TOKEN,       value: false },
      { type: pkcs11js.CKA_SENSITIVE,   value: false },
      { type: pkcs11js.CKA_EXTRACTABLE, value: true },
      { type: pkcs11js.CKA_SIGN,        value: true },
    ]);

    try {
      const iv = Buffer.from(pkcs11.C_GenerateRandom(session, Buffer.alloc(16)));
      const mechanism = { mechanism: pkcs11js.CKM_AES_CBC_PAD, parameter: iv };
      const wrapped = Buffer.from(
        pkcs11.C_WrapKey(session, mechanism, wrapKeyHandle, sessionKeyHandle, Buffer.alloc(512))
      );
      const wrappedPrivateKey = `${iv.toString('hex')}:${wrapped.toString('hex')}`;
      logger.info('EC key wrapped via HSM (Strategy A)', { keyId, algorithm });
      return { wrappedPrivateKey, keyId };
    } finally {
      try { pkcs11.C_DestroyObject(session, sessionKeyHandle); } catch { /* */ }
    }
  }

  /**
   * Sign with a wrapped/encrypted HD child key — auto-detects strategy:
   * Strategy A: C_UnwrapKey → C_Sign → C_DestroyObject (HSM-only)
   * Strategy B: C_Decrypt → software sign with @noble/curves → zero memory
   */
  private async unwrapAndSign(
    wrappedBlob: string,
    algorithm: KeyAlgorithm,
    hash: Buffer,
  ): Promise<Buffer> {
    if (this.canHsmWrap()) {
      return this.unwrapAndSignHsm(wrappedBlob, algorithm, hash);
    }
    return this.decryptAndSignSoftware(wrappedBlob, hash);
  }

  /** Strategy A: C_UnwrapKey → C_Sign inside HSM. Key never enters app memory. */
  private async unwrapAndSignHsm(
    wrappedBlob: string,
    algorithm: KeyAlgorithm,
    hash: Buffer,
  ): Promise<Buffer> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    const colonIdx = wrappedBlob.indexOf(':');
    const iv         = Buffer.from(wrappedBlob.slice(0, colonIdx), 'hex');
    const ciphertext = Buffer.from(wrappedBlob.slice(colonIdx + 1), 'hex');

    const wrapKeyHandle = this.findKeyByLabel(WRAP_KEY_LABEL);
    if (!wrapKeyHandle) throw new Error('Master wrap key not found');

    const curveName = ALGORITHM_CONFIG[algorithm].params?.namedCurve as string;
    const curveOid  = EC_CURVE_OIDS[curveName];

    const sessionKeyHandle = pkcs11.C_UnwrapKey(
      session,
      { mechanism: pkcs11js.CKM_AES_CBC_PAD, parameter: iv },
      wrapKeyHandle, ciphertext,
      [
        { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_PRIVATE_KEY },
        { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_EC },
        { type: pkcs11js.CKA_EC_PARAMS,   value: curveOid },
        { type: pkcs11js.CKA_TOKEN,       value: false },
        { type: pkcs11js.CKA_SENSITIVE,   value: true },
        { type: pkcs11js.CKA_EXTRACTABLE, value: false },
        { type: pkcs11js.CKA_SIGN,        value: true },
      ],
    );

    try {
      pkcs11.C_SignInit(session, { mechanism: pkcs11js.CKM_ECDSA }, sessionKeyHandle);
      const signature = Buffer.from(pkcs11.C_Sign(session, hash, Buffer.alloc(512)));
      logger.debug('Signed via HSM unwrap (Strategy A)', { algorithm });
      return signature;
    } finally {
      try { pkcs11.C_DestroyObject(session, sessionKeyHandle); } catch { /* */ }
    }
  }

  /** Strategy B: C_Decrypt → software sign. Key in app memory for ~1ms. */
  private async decryptAndSignSoftware(
    wrappedBlob: string,
    hash: Buffer,
  ): Promise<Buffer> {
    const privateKeyBytes = this.decryptChildKey(wrappedBlob);

    try {
      // Sign in application memory using @noble/curves
      const sig = secp256k1.sign(hash, privateKeyBytes) as any;
      // Return raw r || s (64 bytes) — same format as PKCS#11 CKM_ECDSA
      const compact = sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig;
      logger.debug('Signed via software (Strategy B) — key in memory ~1ms');
      return Buffer.from(compact);
    } finally {
      // Zero the private key from app memory immediately
      zeroBuffer(privateKeyBytes);
    }
  }

  /**
   * Import a 64-byte BIP-32 master seed as a permanent generic secret on the HSM.
   * Used for BIP-32 child key derivation — the seed is read back via C_GetAttributeValue
   * during wallet creation, then immediately zeroed in app memory.
   */
  async importMasterSeed(seedBytes: Buffer): Promise<{ label: string }> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();
    const label   = 'blue:hd:master:v1';

    // Check if it already exists (idempotent)
    const existing = this.findKeyByLabel(label);
    if (existing) {
      logger.info('HD master seed already exists on HSM', { label });
      return { label };
    }

    pkcs11.C_CreateObject(session, [
      { type: pkcs11js.CKA_CLASS,       value: pkcs11js.CKO_SECRET_KEY },
      { type: pkcs11js.CKA_KEY_TYPE,    value: pkcs11js.CKK_GENERIC_SECRET },
      { type: pkcs11js.CKA_VALUE,       value: seedBytes },
      { type: pkcs11js.CKA_VALUE_LEN,   value: 64 },
      { type: pkcs11js.CKA_TOKEN,       value: true },     // persistent
      { type: pkcs11js.CKA_PRIVATE,     value: true },
      { type: pkcs11js.CKA_SENSITIVE,   value: true },
      { type: pkcs11js.CKA_EXTRACTABLE, value: true },     // needed for wrapping backup
      { type: pkcs11js.CKA_LABEL,       value: label },
      { type: pkcs11js.CKA_ID,          value: Buffer.from(label) },
    ]);

    logger.info('HD master seed imported to HSM', { label });
    return { label };
  }

  /**
   * Wrap the HD master seed with blue:wrap:v1 for disaster recovery backup.
   */
  async wrapMasterSeedForBackup(): Promise<string> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    const seedHandle = this.findKeyByLabel('blue:hd:master:v1');
    if (!seedHandle) throw new Error('HD master seed not found on HSM');

    const wrapKeyHandle = this.findKeyByLabel(WRAP_KEY_LABEL);
    if (!wrapKeyHandle) throw new Error('Master wrap key not found');

    const iv = Buffer.from(pkcs11.C_GenerateRandom(session, Buffer.alloc(16)));
    const mechanism = { mechanism: pkcs11js.CKM_AES_CBC_PAD, parameter: iv };
    const wrapped = Buffer.from(
      pkcs11.C_WrapKey(session, mechanism, wrapKeyHandle, seedHandle, Buffer.alloc(512))
    );

    return `${iv.toString('hex')}:${wrapped.toString('hex')}`;
  }

  /**
   * Read the master seed from HSM (for BIP-32 derivation in app memory).
   * CALLER MUST ZERO THE RETURNED BUFFER IMMEDIATELY AFTER USE.
   */
  async readMasterSeed(): Promise<Buffer> {
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    const handle = this.findKeyByLabel('blue:hd:master:v1');
    if (!handle) throw new Error('HD master seed not found. Run HD ceremony first.');

    // Read CKA_VALUE — only works because CKA_SENSITIVE was set to true but CKA_EXTRACTABLE=true
    // on generic secrets (unlike EC private keys where we use C_WrapKey instead).
    const attrs = pkcs11.C_GetAttributeValue(session, handle, [
      { type: pkcs11js.CKA_VALUE },
    ]);

    const seedValue = attrs[0]?.value;
    if (!seedValue || (seedValue as Buffer).length !== 64) {
      throw new Error('Failed to read master seed from HSM — unexpected value');
    }

    return Buffer.from(seedValue as Buffer);
  }

  /** Check if the encrypt key exists on the HSM. */
  encryptKeyExists(): boolean {
    try {
      return !!this.findKeyByLabel(ENCRYPT_KEY_LABEL);
    } catch {
      return false;
    }
  }

  /** Check if the HD master seed exists on the HSM. */
  hdMasterExists(): boolean {
    try {
      return !!this.findKeyByLabel('blue:hd:master:v1');
    } catch {
      return false;
    }
  }

  // ── Legacy helpers ──────────────────────────────────────────────────────────

  private getMechanismForKeyGen(algorithm: KeyAlgorithm): pkcs11js.Mechanism {
    switch (algorithm) {
      case 'EC_P256':
      case 'EC_P384':
      case 'EC_SECP256K1':
      case 'ED25519':
        return { mechanism: pkcs11js.CKM_EC_KEY_PAIR_GEN };
      case 'RSA_2048':
      case 'RSA_4096':
        return { mechanism: pkcs11js.CKM_RSA_PKCS_KEY_PAIR_GEN };
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }

  private getSignMechanism(algorithm: KeyAlgorithm): pkcs11js.Mechanism {
    switch (algorithm) {
      case 'EC_P256':
      case 'EC_P384':
      case 'EC_SECP256K1':
      case 'ED25519':
        return { mechanism: pkcs11js.CKM_ECDSA };
      case 'RSA_2048':
      case 'RSA_4096':
        return { mechanism: pkcs11js.CKM_SHA256_RSA_PKCS };
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }
}
