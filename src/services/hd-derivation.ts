/**
 * BIP-32/39/44 Hierarchical Deterministic Key Derivation
 *
 * Pure cryptographic logic — no HSM calls. The derived private key
 * is handed to the KMS service for HSM import + wrapping.
 *
 * SECURITY: All intermediate key buffers are zeroed after use.
 * The caller MUST zero the returned privateKey after HSM import.
 */

import crypto from 'crypto';
import * as bip39 from 'bip39';
import { secp256k1 } from '@noble/curves/secp256k1.js';

// ── BIP-44 coin types ──────────────────────────────────────────────────────

export const BIP44_COIN_TYPES: Record<string, number> = {
  bitcoin: 0,
  ethereum: 60,
  litecoin: 2,
  solana: 501,
  tron: 195,
  bsc: 60,
  polygon: 60,
  arbitrum: 60,
  avalanche: 60,
};

/** EVM chains share coin_type=60, differentiated by account index. */
export const EVM_ACCOUNT_INDEX: Record<string, number> = {
  ethereum: 0,
  bsc: 1,
  polygon: 2,
  arbitrum: 3,
  avalanche: 4,
};

// secp256k1 curve order
const SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const HARDENED_OFFSET = 0x80000000;

// ── Types ──────────────────────────────────────────────────────────────────

interface PathLevel {
  index: number;
  hardened: boolean;
}

export interface DerivedKey {
  privateKey: Buffer;           // 32 bytes — CALLER MUST ZERO AFTER HSM IMPORT
  publicKeyCompressed: Buffer;  // 33 bytes (02/03 || x)
  publicKeyHex: string;         // hex of uncompressed (04 || x || y) for address derivation
}

// ── Mnemonic helpers ───────────────────────────────────────────────────────

/** Convert 32 bytes of entropy to a 24-word BIP-39 mnemonic. */
export function entropyToMnemonic(entropyHex: string): string {
  return bip39.entropyToMnemonic(entropyHex);
}

/** Convert a BIP-39 mnemonic to a 64-byte master seed. */
export function mnemonicToSeed(mnemonic: string, passphrase?: string): Buffer {
  return bip39.mnemonicToSeedSync(mnemonic, passphrase || '');
}

/** Validate a mnemonic string. */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

// ── Path helpers ───────────────────────────────────────────────────────────

/** Parse "m/44'/60'/0'/0/0" into structured levels. */
export function parsePath(path: string): PathLevel[] {
  const parts = path.replace(/^m\/?/, '').split('/').filter(Boolean);
  return parts.map(part => {
    const hardened = part.endsWith("'") || part.endsWith('h');
    const index = parseInt(part.replace(/['h]$/, ''), 10);
    if (isNaN(index)) throw new Error(`Invalid path component: ${part}`);
    return { index, hardened };
  });
}

/** Build a BIP-44 path for a given chain and address index. */
export function buildBip44Path(chain: string, addressIndex: number): string {
  const coinType = BIP44_COIN_TYPES[chain];
  if (coinType === undefined) throw new Error(`Unknown chain: ${chain}`);

  const account = EVM_ACCOUNT_INDEX[chain] ?? 0;

  // Solana uses all-hardened paths per SLIP-44
  if (chain === 'solana') {
    return `m/44'/${coinType}'/${account}'/${addressIndex}'`;
  }

  return `m/44'/${coinType}'/${account}'/0/${addressIndex}`;
}

// ── BIP-32 derivation ──────────────────────────────────────────────────────

/**
 * Derive a child key from a 64-byte master seed and a BIP-44 path.
 *
 * Implementation follows BIP-32 spec:
 * 1. Master key: HMAC-SHA512("Bitcoin seed", seed) → 64 bytes
 *    left 32 = master private key, right 32 = master chain code
 * 2. For each level in path:
 *    - Hardened: HMAC-SHA512(chainCode, 0x00 || key || index)
 *    - Normal:   HMAC-SHA512(chainCode, pubKey || index)
 *    - Child key = (parent + IL) mod n
 */
export function deriveChild(masterSeed: Buffer, path: string): DerivedKey {
  if (masterSeed.length !== 64) throw new Error('Master seed must be 64 bytes');

  const levels = parsePath(path);

  // Step 1: Master key from seed
  const masterHmac = crypto.createHmac('sha512', 'Bitcoin seed').update(masterSeed).digest();
  let key: any = Buffer.from(masterHmac.subarray(0, 32));
  let chainCode: any = Buffer.from(masterHmac.subarray(32, 64));
  zeroBuffer(masterHmac);

  // Step 2: Derive each level
  for (const level of levels) {
    const index = level.hardened ? level.index + HARDENED_OFFSET : level.index;
    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32BE(index);

    let data: Buffer;
    if (level.hardened) {
      // Hardened: 0x00 || private_key(32) || index(4)
      data = Buffer.concat([Buffer.alloc(1, 0), key, indexBuf]);
    } else {
      // Normal: compressed_public_key(33) || index(4)
      const pubCompressed = Buffer.from(secp256k1.getPublicKey(key, true));
      data = Buffer.concat([pubCompressed, indexBuf]);
    }

    const hmac = crypto.createHmac('sha512', chainCode).update(data).digest();
    const il = hmac.subarray(0, 32);
    const ir = hmac.subarray(32, 64);

    // Child key = (parent_key + il) mod n
    const parentBn = bufferToBigInt(key);
    const ilBn = bufferToBigInt(il);

    // BIP-32 spec: if IL >= n, this key is invalid — must skip to next index
    if (ilBn >= SECP256K1_N) {
      throw new Error('BIP-32: derived IL >= curve order n. Try next index.');
    }

    const childBn = (parentBn + ilBn) % SECP256K1_N;

    // BIP-32 spec: if child key == 0, invalid — must skip to next index
    if (childBn === 0n) {
      throw new Error('BIP-32: derived key is 0. Try next index.');
    }

    // Zero old key and chain code
    zeroBuffer(key);
    zeroBuffer(chainCode);
    zeroBuffer(data);

    key = bigIntToBuffer(childBn, 32);
    chainCode = Buffer.from(ir);
    zeroBuffer(hmac);
  }

  // Derive public keys from final child private key
  const pubCompressed = Buffer.from(secp256k1.getPublicKey(key, true));
  const pubUncompressed = Buffer.from(secp256k1.getPublicKey(key, false));

  const result: DerivedKey = {
    privateKey: key,  // Caller MUST zero after HSM import
    publicKeyCompressed: pubCompressed,
    publicKeyHex: pubUncompressed.toString('hex'),
  };

  zeroBuffer(chainCode);
  return result;
}

// ── Utilities ──────────────────────────────────────────────────────────────

/** Best-effort secure wipe of a Buffer. */
export function zeroBuffer(buf: Buffer): void {
  buf.fill(0);
}

function bufferToBigInt(buf: Buffer): bigint {
  return BigInt('0x' + buf.toString('hex'));
}

function bigIntToBuffer(bn: bigint, length: number): Buffer {
  const hex = bn.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}
