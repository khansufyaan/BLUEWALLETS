import crypto from 'crypto';
import jsSha3 from 'js-sha3';
import { Chain, CHAIN_CONFIGS, NetworkType } from '../types/chain';
import { parseEcPoint, compressPublicKey } from '../utils/crypto-helpers';

/**
 * Derives blockchain addresses from HSM-extracted public keys.
 * Public keys come from the HSM as DER-encoded EC_POINT (hex string).
 * Private keys remain in the HSM — only the public key is needed for address derivation.
 *
 * Uses Node.js built-in crypto for SHA256, RIPEMD160.
 * Keccak256 is implemented inline (required for Ethereum/EVM/Tron).
 */
export class AddressService {

  deriveAddress(publicKeyHex: string, chain: Chain, network: NetworkType = 'mainnet'): string {
    const config = CHAIN_CONFIGS[chain];

    if (config.evmCompatible) {
      return this.deriveEvmAddress(publicKeyHex);
    }

    switch (chain) {
      case 'bitcoin':
        return this.deriveBitcoinAddress(publicKeyHex, network);
      case 'litecoin':
        return this.deriveLitecoinAddress(publicKeyHex, network);
      case 'solana':
        return this.deriveSolanaAddress(publicKeyHex);
      case 'tron':
        return this.deriveTronAddress(publicKeyHex);
      default:
        throw new Error(`Address derivation not implemented for chain: ${chain}`);
    }
  }

  /**
   * Bitcoin P2WPKH (bech32 native segwit): bc1q...
   */
  private deriveBitcoinAddress(publicKeyHex: string, network: NetworkType): string {
    const { uncompressed } = parseEcPoint(publicKeyHex);
    const compressed = compressPublicKey(uncompressed);
    const pubkeyHash = this.hash160(compressed);

    // Bech32 encoding
    const hrp = network === 'mainnet' ? 'bc' : 'tb';
    const words = this.convertBits(pubkeyHash, 8, 5, true);
    words.unshift(0); // witness version 0
    return this.bech32Encode(hrp, words);
  }

  /**
   * Litecoin P2PKH: L...
   */
  private deriveLitecoinAddress(publicKeyHex: string, network: NetworkType): string {
    const { uncompressed } = parseEcPoint(publicKeyHex);
    const compressed = compressPublicKey(uncompressed);
    const pubkeyHash = this.hash160(compressed);
    const version = network === 'mainnet' ? 0x30 : 0x6f;
    return this.base58Check(version, pubkeyHash);
  }

  /**
   * Ethereum / EVM: 0x + EIP-55 checksum
   */
  private deriveEvmAddress(publicKeyHex: string): string {
    const buf = Buffer.from(publicKeyHex, 'hex');
    let rawPoint: Buffer;

    // Handle both DER-wrapped HSM keys and raw SEC1 keys (from HD derivation)
    if (buf.length === 65 && buf[0] === 0x04) {
      // Raw SEC1 uncompressed: 04 || x(32) || y(32) — strip the 04 prefix
      rawPoint = buf.subarray(1);
    } else {
      // DER-wrapped from HSM — use parseEcPoint
      const { x, y } = parseEcPoint(publicKeyHex);
      rawPoint = Buffer.concat([x, y]);
    }
    const hash = this.keccak256(rawPoint);
    const addressBytes = hash.subarray(12); // last 20 bytes

    // EIP-55 checksum encoding
    const hexAddr = addressBytes.toString('hex');
    const checksumHash = this.keccak256(Buffer.from(hexAddr)).toString('hex');
    let checksummed = '0x';
    for (let i = 0; i < 40; i++) {
      checksummed += parseInt(checksumHash[i], 16) >= 8
        ? hexAddr[i].toUpperCase()
        : hexAddr[i];
    }
    return checksummed;
  }

  /**
   * Solana: Base58(32-byte Ed25519 public key)
   */
  private deriveSolanaAddress(publicKeyHex: string): string {
    const { raw } = parseEcPoint(publicKeyHex);
    if (raw.length !== 32) {
      throw new Error(`Expected 32-byte Ed25519 key for Solana, got ${raw.length} bytes`);
    }
    return this.base58Encode(raw);
  }

  /**
   * Tron: Base58Check(0x41 + Keccak256(pubkey)[12:32])
   */
  private deriveTronAddress(publicKeyHex: string): string {
    const { x, y } = parseEcPoint(publicKeyHex);
    const rawPoint = Buffer.concat([x, y]);
    const hash = this.keccak256(rawPoint);
    const addressBytes = hash.subarray(12);
    return this.base58Check(0x41, addressBytes);
  }

  // ─── Crypto helpers ────────────────────────────────────────

  private hash160(data: Buffer): Buffer {
    const sha = crypto.createHash('sha256').update(data).digest();
    return crypto.createHash('ripemd160').update(sha).digest();
  }

  private sha256d(data: Buffer): Buffer {
    const h1 = crypto.createHash('sha256').update(data).digest();
    return crypto.createHash('sha256').update(h1).digest();
  }

  /**
   * Keccak-256 (NOT SHA3-256 — Ethereum uses the original Keccak, not NIST SHA3).
   * Node.js crypto doesn't have keccak directly, but some builds support it.
   * We use a pure implementation as fallback.
   */
  private keccak256(data: Buffer): Buffer {
    // Keccak-256 (NOT SHA3-256 — Ethereum uses original Keccak, not NIST SHA3).
    // They differ in padding: Keccak uses 0x01, SHA3 uses 0x06.
    return Buffer.from(jsSha3.keccak256.arrayBuffer(data));
  }

  // ─── Base58 / Base58Check ──────────────────────────────────

  private base58Check(version: number, payload: Buffer): string {
    const versioned = Buffer.concat([Buffer.from([version]), payload]);
    const checksum = this.sha256d(versioned).subarray(0, 4);
    return this.base58Encode(Buffer.concat([versioned, checksum]));
  }

  private base58Encode(data: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = BigInt('0x' + data.toString('hex'));
    const chars: string[] = [];
    while (num > 0n) {
      const rem = Number(num % 58n);
      chars.unshift(ALPHABET[rem]);
      num = num / 58n;
    }
    // Leading zero bytes become '1's
    for (const byte of data) {
      if (byte === 0) chars.unshift('1');
      else break;
    }
    return chars.join('');
  }

  // ─── Bech32 ────────────────────────────────────────────────

  private bech32Encode(hrp: string, data: number[]): string {
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const values = this.bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const polymod = this.bech32Polymod(values) ^ 1;
    const checksum: number[] = [];
    for (let i = 0; i < 6; i++) {
      checksum.push((polymod >> (5 * (5 - i))) & 31);
    }
    return hrp + '1' + data.concat(checksum).map(d => CHARSET[d]).join('');
  }

  private bech32Polymod(values: number[]): number {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) {
        if ((b >> i) & 1) chk ^= GEN[i];
      }
    }
    return chk;
  }

  private bech32HrpExpand(hrp: string): number[] {
    const ret: number[] = [];
    for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
    ret.push(0);
    for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
    return ret;
  }

  private convertBits(data: Buffer, fromBits: number, toBits: number, pad: boolean): number[] {
    let acc = 0, bits = 0;
    const ret: number[] = [];
    const maxv = (1 << toBits) - 1;
    for (const b of data) {
      acc = (acc << fromBits) | b;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad && bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
    return ret;
  }
}
