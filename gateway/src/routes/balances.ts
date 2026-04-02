/**
 * Balance Routes — query on-chain balances for wallets.
 */

import { Router, Request, Response } from 'express';
import { SignerClient } from '../services/signer-client';
import { EvmBalanceSync } from '../services/evm/evm-balance-sync';
import { resolveChain } from '../services/evm/evm-provider';
import { logger } from '../utils/logger';

export function createBalanceRoutes(
  signerClient: SignerClient,
  balanceSync: EvmBalanceSync,
): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:id/balance
   *
   * Returns the on-chain balance (queried live from the RPC node).
   */
  router.get('/:id/balance', async (req: Request, res: Response) => {
    try {
      const wallet = await signerClient.getWallet(req.params.id);
      const chain = resolveChain(wallet.chain);
      const balance = await balanceSync.getBalance(chain, wallet.address);

      res.json({
        walletId: wallet.id,
        address:  wallet.address,
        chain:    wallet.chain,
        balance,
        currency: wallet.currency,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Balance query failed';
      logger.error('Balance query failed', { error: msg, walletId: req.params.id });
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/wallets/:id/balance/sync
   *
   * Force-sync on-chain balance and push to signer.
   */
  router.post('/:id/balance/sync', async (req: Request, res: Response) => {
    try {
      const wallet = await signerClient.getWallet(req.params.id);
      const chain = resolveChain(wallet.chain);
      const balance = await balanceSync.syncBalance(chain, wallet.id, wallet.address);

      res.json({
        walletId: wallet.id,
        address:  wallet.address,
        chain:    wallet.chain,
        balance,
        synced:   true,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Balance sync failed';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
