export interface HsmConfig {
  pkcs11Library: string;
  slotIndex: number;
  pin: string;
  label: string;
}

export interface KeyPairResult {
  keyId: string;
  publicKey: Buffer;
  algorithm: KeyAlgorithm;
  createdAt: Date;
}

export type KeyAlgorithm = 'EC_P256' | 'EC_P384' | 'EC_SECP256K1' | 'RSA_2048' | 'RSA_4096' | 'ED25519';

export interface SignatureResult {
  signature: Buffer;
  keyId: string;
  algorithm: KeyAlgorithm;
  mechanism: string;
}

export interface KeyInfo {
  keyId: string;
  algorithm: KeyAlgorithm;
  publicKey: Buffer;
  label: string;
  createdAt: Date;
}

export interface VerifyResult {
  valid: boolean;
  keyId: string;
}

export interface HsmStatus {
  connected: boolean;
  slotInfo: {
    slotDescription: string;
    manufacturerId: string;
    firmwareVersion: string;
    tokenPresent: boolean;
  } | null;
  tokenInfo: {
    label: string;
    model: string;
    serialNumber: string;
    freePublicMemory: number;
    freePrivateMemory: number;
  } | null;
}

// Maps our algorithm names to PKCS#11 mechanisms
export const ALGORITHM_CONFIG: Record<KeyAlgorithm, {
  keyGenMechanism: string;
  signMechanism: string;
  keyType: string;
  params?: Record<string, unknown>;
}> = {
  EC_P256: {
    keyGenMechanism: 'CKM_EC_KEY_PAIR_GEN',
    signMechanism: 'CKM_ECDSA',
    keyType: 'CKK_EC',
    params: { namedCurve: 'P-256' },
  },
  EC_P384: {
    keyGenMechanism: 'CKM_EC_KEY_PAIR_GEN',
    signMechanism: 'CKM_ECDSA',
    keyType: 'CKK_EC',
    params: { namedCurve: 'P-384' },
  },
  EC_SECP256K1: {
    keyGenMechanism: 'CKM_EC_KEY_PAIR_GEN',
    signMechanism: 'CKM_ECDSA',
    keyType: 'CKK_EC',
    params: { namedCurve: 'secp256k1' },
  },
  RSA_2048: {
    keyGenMechanism: 'CKM_RSA_PKCS_KEY_PAIR_GEN',
    signMechanism: 'CKM_SHA256_RSA_PKCS',
    keyType: 'CKK_RSA',
    params: { modulusBits: 2048, publicExponent: Buffer.from([0x01, 0x00, 0x01]) },
  },
  RSA_4096: {
    keyGenMechanism: 'CKM_RSA_PKCS_KEY_PAIR_GEN',
    signMechanism: 'CKM_SHA256_RSA_PKCS',
    keyType: 'CKK_RSA',
    params: { modulusBits: 4096, publicExponent: Buffer.from([0x01, 0x00, 0x01]) },
  },
  ED25519: {
    keyGenMechanism: 'CKM_EC_EDWARDS_KEY_PAIR_GEN',
    signMechanism: 'CKM_EDDSA',
    keyType: 'CKK_EC_EDWARDS',
    params: { namedCurve: 'Ed25519' },
  },
};

// OID encodings for EC named curves (DER-encoded)
export const EC_CURVE_OIDS: Record<string, Buffer> = {
  'P-256': Buffer.from('06082a8648ce3d030107', 'hex'),       // 1.2.840.10045.3.1.7
  'P-384': Buffer.from('06052b81040022', 'hex'),              // 1.3.132.0.34
  'secp256k1': Buffer.from('06052b8104000a', 'hex'),          // 1.3.132.0.10
  'Ed25519': Buffer.from('06032b6570', 'hex'),                // 1.3.101.112
};

export * from './policy';
export * from './wallet';
export * from './store';
export * from './chain';
export * from './vault';
export * from './rbac';
