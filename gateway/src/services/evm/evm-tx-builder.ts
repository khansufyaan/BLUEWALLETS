/**
 * EVM Transaction Builder — builds unsigned transactions, assembles signed ones.
 *
 * This is the core of the gateway. It:
 *   1. Builds an unsigned EIP-1559 or legacy transaction
 *   2. Computes the hash that needs to be signed
 *   3. After receiving the HSM signature (r || s), assembles the signed transaction
 *   4. Returns the raw serialized transaction for broadcasting
 */

import { ethers } from 'ethers';
import { getChainConfig } from './evm-provider';
import { getNextNonce, incrementNonce } from './evm-nonce-manager';
import { estimateGas } from './evm-gas-estimator';
import { logger } from '../../utils/logger';

export interface UnsignedTxResult {
  unsignedTx:     ethers.Transaction;
  hashToSign:     string;    // hex, keccak256 of unsigned serialized tx
  nonce:          number;
}

export interface SignedTxResult {
  rawTransaction: string;    // hex, ready for eth_sendRawTransaction
  txHash:         string;    // expected tx hash
}

/**
 * Build an unsigned EVM transaction.
 */
export async function buildUnsignedTx(
  chain: string,
  from: string,
  to: string,
  value: bigint,
): Promise<UnsignedTxResult> {
  const chainCfg = getChainConfig(chain);
  const nonce = await getNextNonce(chain, from);
  const gas = await estimateGas(chain, from, to, value);

  const tx = new ethers.Transaction();
  tx.chainId = BigInt(chainCfg.chainId);
  tx.nonce   = nonce;
  tx.to      = to;
  tx.value   = value;

  if (chainCfg.eip1559 && gas.maxFeePerGas && gas.maxPriorityFeePerGas) {
    tx.type                = 2; // EIP-1559
    tx.maxFeePerGas        = gas.maxFeePerGas;
    tx.maxPriorityFeePerGas = gas.maxPriorityFeePerGas;
    tx.gasLimit            = gas.gasLimit;
  } else {
    tx.type     = 0; // Legacy
    tx.gasPrice = gas.gasPrice!;
    tx.gasLimit = gas.gasLimit;
  }

  // The unsigned hash is what the HSM needs to sign
  const hashToSign = tx.unsignedHash;

  logger.info('Built unsigned tx', {
    chain,
    from,
    to,
    value: value.toString(),
    nonce,
    gasLimit: gas.gasLimit.toString(),
    type: tx.type,
    hash: hashToSign,
  });

  return { unsignedTx: tx, hashToSign, nonce };
}

/**
 * Assemble a signed transaction from the unsigned tx + raw ECDSA signature.
 *
 * The HSM returns raw ECDSA: 64 bytes = r (32 bytes) || s (32 bytes).
 * We need to:
 *   1. Split into r and s
 *   2. Normalize s to lower-half of curve order (EIP-2)
 *   3. Compute recovery parameter v by trying ecrecover with v=27 and v=28
 *   4. Attach the signature to the transaction
 */
export function assembleSignedTx(
  unsignedTx: ethers.Transaction,
  signatureHex: string,
  publicKeyHex: string,
  chain: string,
): SignedTxResult {
  const sigBytes = Buffer.from(signatureHex, 'hex');

  if (sigBytes.length !== 64) {
    throw new Error(`Expected 64-byte ECDSA signature, got ${sigBytes.length} bytes`);
  }

  let r = BigInt('0x' + sigBytes.subarray(0, 32).toString('hex'));
  let s = BigInt('0x' + sigBytes.subarray(32, 64).toString('hex'));

  // EIP-2: s must be in the lower half of the curve order
  const SECP256K1_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const HALF_ORDER = SECP256K1_ORDER / 2n;
  if (s > HALF_ORDER) {
    s = SECP256K1_ORDER - s;
  }

  const rHex = '0x' + r.toString(16).padStart(64, '0');
  const sHex = '0x' + s.toString(16).padStart(64, '0');

  // Compute v by trying recovery with both v=27 and v=28
  const txHash = unsignedTx.unsignedHash;

  // Derive the expected address from the public key
  const fullPubKey = publicKeyHex.startsWith('04')
    ? publicKeyHex
    : '04' + publicKeyHex; // uncompressed
  const expectedAddress = ethers.computeAddress('0x' + fullPubKey).toLowerCase();

  let v = 27;
  for (const tryV of [27, 28]) {
    try {
      const sig = ethers.Signature.from({
        r: rHex,
        s: sHex,
        v: tryV,
      });
      const recovered = ethers.recoverAddress(txHash, sig).toLowerCase();
      if (recovered === expectedAddress) {
        v = tryV;
        break;
      }
    } catch {
      continue;
    }
  }

  // Build the final signature
  const finalSig = ethers.Signature.from({ r: rHex, s: sHex, v });
  unsignedTx.signature = finalSig;

  const rawTransaction = unsignedTx.serialized;
  const txHashFinal = ethers.keccak256(rawTransaction);

  // Increment nonce after successful assembly
  const from = ethers.recoverAddress(txHash, finalSig);
  incrementNonce(chain, from);

  logger.info('Assembled signed tx', {
    chain,
    from,
    txHash: txHashFinal,
    v,
  });

  return { rawTransaction, txHash: txHashFinal };
}
