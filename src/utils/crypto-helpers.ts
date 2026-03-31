/**
 * Parse PKCS#11 EC_POINT attribute into raw public key bytes.
 *
 * PKCS#11 wraps EC public keys in a DER OCTET STRING:
 *   04 <length> <uncompressed-point>
 *
 * For secp256k1/P-256 (65 bytes uncompressed):
 *   04 41 04 <x:32bytes> <y:32bytes>
 *
 * For Ed25519 (32 bytes):
 *   04 20 <raw-key:32bytes>
 */
export function parseEcPoint(ecPointHex: string): {
  uncompressed: Buffer;  // 04 || x || y (65 bytes for secp256k1)
  x: Buffer;
  y: Buffer;
  raw: Buffer;           // The inner content without DER wrapper
} {
  const buf = Buffer.from(ecPointHex, 'hex');

  // Strip DER OCTET STRING wrapper (tag 0x04, then length)
  let inner: Buffer;
  if (buf[0] === 0x04) {
    const len = buf[1];
    if (len === 0x41) {
      // 65-byte uncompressed point (secp256k1, P-256)
      inner = buf.subarray(2, 2 + 65);
    } else if (len === 0x20) {
      // 32-byte Ed25519 key
      inner = buf.subarray(2, 2 + 32);
    } else if (len & 0x80) {
      // Multi-byte length encoding
      const lenBytes = len & 0x7f;
      const actualLen = buf.readUIntBE(2, lenBytes);
      inner = buf.subarray(2 + lenBytes, 2 + lenBytes + actualLen);
    } else {
      inner = buf.subarray(2, 2 + len);
    }
  } else {
    // No wrapper — raw point
    inner = buf;
  }

  // Ed25519: 32 bytes, no x/y split
  if (inner.length === 32) {
    return {
      uncompressed: inner,
      x: inner,
      y: Buffer.alloc(0),
      raw: inner,
    };
  }

  // SEC1 uncompressed point: 04 || x || y
  if (inner[0] === 0x04 && (inner.length === 65 || inner.length === 97)) {
    const coordLen = (inner.length - 1) / 2;
    return {
      uncompressed: inner,
      x: inner.subarray(1, 1 + coordLen),
      y: inner.subarray(1 + coordLen),
      raw: inner,
    };
  }

  // Compressed or unknown format
  return {
    uncompressed: inner,
    x: inner,
    y: Buffer.alloc(0),
    raw: inner,
  };
}

/**
 * Compress a SEC1 uncompressed secp256k1/P-256 public key.
 * Input: 04 || x(32) || y(32) = 65 bytes
 * Output: (02 or 03) || x(32) = 33 bytes
 */
export function compressPublicKey(uncompressed: Buffer): Buffer {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new Error(`Expected 65-byte uncompressed key starting with 0x04, got ${uncompressed.length} bytes`);
  }
  const x = uncompressed.subarray(1, 33);
  const y = uncompressed.subarray(33, 65);
  // Even y → prefix 02, odd y → prefix 03
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]);
}
