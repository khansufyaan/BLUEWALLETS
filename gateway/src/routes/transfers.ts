/**
 * Transfer Routes — withdrawal (send) from a Blue wallet to an external address.
 *
 * This is the full withdrawal flow:
 *   1. Build unsigned EVM transaction (nonce, gas, RLP)
 *   2. Send hash to signer for HSM signing
 *   3. Assemble signed transaction
 *   4. Broadcast to RPC node
 *   5. Optionally wait for confirmation
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { SignerClient } from '../services/signer-client';
import { buildUnsignedTx, assembleSignedTx } from '../services/evm/evm-tx-builder';
import { broadcast, waitForConfirmation } from '../services/evm/evm-broadcaster';
import { resolveChain } from '../services/evm/evm-provider';
import { EvmBalanceSync } from '../services/evm/evm-balance-sync';
import { txStore } from '../stores/tx-store';
import { logger } from '../utils/logger';

const transferSchema = z.object({
  walletId:  z.string().min(1),
  toAddress: z.string().min(1),
  amount:    z.string().min(1),  // wei
  chain:     z.string().min(1),
  waitForConfirmation: z.boolean().optional().default(false),
});

export function createTransferRoutes(
  signerClient: SignerClient,
  balanceSync: EvmBalanceSync,
): Router {
  const router = Router();

  /**
   * POST /api/v1/transfers
   *
   * Execute a withdrawal: send crypto from a Blue wallet to an external address.
   */
  router.post('/', async (req: Request, res: Response) => {
    // Validate input
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { walletId, toAddress, amount, chain: rawChain, waitForConfirmation: shouldWait } = parsed.data;

    try {
      // 1. Resolve chain and validate
      const chain = resolveChain(rawChain);
      const value = BigInt(amount);

      // 2. Get wallet from signer
      const wallet = await signerClient.getWallet(walletId);
      if (wallet.status !== 'active') {
        res.status(400).json({ error: `Wallet is ${wallet.status}` });
        return;
      }

      // Validate destination address
      if (!ethers.isAddress(toAddress)) {
        res.status(400).json({ error: `Invalid destination address: ${toAddress}` });
        return;
      }

      logger.info('Transfer initiated', {
        chain, walletId, from: wallet.address, to: toAddress, amount,
      });

      // 3. Build unsigned transaction
      const { unsignedTx, hashToSign } = await buildUnsignedTx(
        chain,
        wallet.address,
        toAddress,
        value,
      );

      // 4. Send hash to signer for HSM signing
      const hashHex = hashToSign.startsWith('0x') ? hashToSign.slice(2) : hashToSign;
      const signResult = await signerClient.sign(walletId, hashHex);

      // 5. Assemble signed transaction
      const { rawTransaction, txHash } = assembleSignedTx(
        unsignedTx,
        signResult.signatureHex,
        signResult.publicKeyHex,
        chain,
      );

      // 6. Broadcast to RPC node
      const broadcastResult = await broadcast(chain, rawTransaction);

      // 7. Record in tx store for ops dashboard
      txStore.add({
        id:        broadcastResult.txHash,
        walletId,
        chain,
        from:      wallet.address,
        to:        toAddress,
        amount,
        txHash:    broadcastResult.txHash,
        status:    'pending',
        nonce:     unsignedTx.nonce,
        gasLimit:  unsignedTx.gasLimit.toString(),
        createdAt: new Date().toISOString(),
      });

      // 8. Optionally wait for confirmation
      if (shouldWait) {
        const confirmed = await waitForConfirmation(chain, broadcastResult.txHash);

        txStore.update(broadcastResult.txHash, {
          status:      confirmed.status,
          blockNumber: confirmed.blockNumber,
          gasUsed:     confirmed.gasUsed,
          confirmedAt: confirmed.status === 'confirmed' ? new Date().toISOString() : undefined,
        });

        if (confirmed.status === 'confirmed') {
          await balanceSync.syncBalance(chain, walletId, wallet.address);
        }

        res.json({
          txHash:      confirmed.txHash,
          status:      confirmed.status,
          chain,
          from:        wallet.address,
          to:          toAddress,
          amount,
          blockNumber: confirmed.blockNumber,
          gasUsed:     confirmed.gasUsed,
        });
        return;
      }

      // Return immediately without waiting for confirmation
      res.json({
        txHash: broadcastResult.txHash,
        status: 'pending',
        chain,
        from:   wallet.address,
        to:     toAddress,
        amount,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Transfer failed';
      logger.error('Transfer failed', { error: msg, walletId, toAddress, chain: rawChain });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
