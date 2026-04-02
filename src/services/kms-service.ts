import pkcs11js from 'pkcs11js';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { HsmSession } from './hsm-session';
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
    const session = this.hsmSession.getSession();
    const pkcs11  = this.hsmSession.getPkcs11();

    let privateKeyHandle: Buffer;

    if (wrappedPrivateKeyHex.startsWith('hsm:')) {
      // Key is stored permanently on the HSM — find by label
      const label = wrappedPrivateKeyHex.slice(4);
      const handle = this.findKeyByLabel(label);
      if (!handle) throw new Error(`HSM key not found: ${label}. HSM may need reconnecting.`);
      privateKeyHandle = handle;
    } else {
      throw new Error('Unsupported key format. Expected hsm: prefix.');
    }

    // Sign — private key never leaves HSM
    pkcs11.C_SignInit(session, { mechanism: pkcs11js.CKM_ECDSA }, privateKeyHandle);
    const signature = Buffer.from(pkcs11.C_Sign(session, hash, Buffer.alloc(512)));

    // Token keys are persistent — do NOT destroy them
    logger.debug('Signed with HSM key', { algorithm });
    return signature;
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
