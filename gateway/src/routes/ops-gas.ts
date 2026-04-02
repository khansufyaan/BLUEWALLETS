/**
 * Gas Station Ops Dashboard Routes
 */

import { Router, Request, Response } from 'express';
import { gasStore } from '../stores/gas-store';
import { SignerClient } from '../services/signer-client';
import { GasStation } from '../services/gas-station';
import { getProvider } from '../services/evm/evm-provider';
import { getEnabledChains } from '../config';
import { logger } from '../utils/logger';

export function createOpsGasRoutes(
  signerClient: SignerClient,
  gasStation: GasStation,
): Router {
  const router = Router();

  /** GET /ops/gas-station/config */
  router.get('/config', (_req: Request, res: Response) => {
    res.json(gasStore.getConfig());
  });

  /** POST /ops/gas-station/config — set treasury wallet + thresholds */
  router.post('/config', async (req: Request, res: Response) => {
    try {
      const updates = req.body;

      // If setting treasury wallet, fetch its address from signer
      if (updates.treasuryWalletId && !updates.treasuryAddress) {
        const wallet = await signerClient.getWallet(updates.treasuryWalletId);
        updates.treasuryAddress = wallet.address;
      }

      const config = gasStore.setConfig(updates);
      gasStation.restart();

      logger.info('Gas station config updated', {
        treasury: config.treasuryAddress,
        enabled: config.enabled,
      });

      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Config update failed';
      res.status(400).json({ error: msg });
    }
  });

  /** GET /ops/gas-station/status — treasury balance, daily spend, wallet gas levels */
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const config = gasStore.getConfig();
      const stats = gasStore.getStats();

      let treasuryBalance: string | null = null;
      if (config.treasuryAddress) {
        try {
          const enabled = getEnabledChains();
          const firstChain = Object.keys(enabled)[0];
          if (firstChain) {
            const provider = getProvider(firstChain);
            const bal = await provider.getBalance(config.treasuryAddress);
            treasuryBalance = bal.toString();
          }
        } catch { /* RPC might be slow */ }
      }

      // Get wallet gas levels
      let walletGasLevels: any[] = [];
      try {
        const wallets = await signerClient.listWallets();
        const enabled = getEnabledChains();
        walletGasLevels = await Promise.all(
          wallets
            .filter(w => w.status === 'active' && w.id !== config.treasuryWalletId)
            .slice(0, 20) // limit to avoid RPC overload
            .map(async (w) => {
              const chainKey = w.chain.toLowerCase();
              if (!enabled[chainKey]) return { ...w, gasBalance: null };
              try {
                const provider = getProvider(chainKey);
                const bal = await provider.getBalance(w.address);
                return {
                  id:      w.id,
                  name:    w.name,
                  chain:   w.chain,
                  address: w.address,
                  gasBalance:    bal.toString(),
                  belowThreshold: bal < BigInt(config.thresholdWei),
                };
              } catch {
                return { id: w.id, name: w.name, chain: w.chain, address: w.address, gasBalance: null, belowThreshold: false };
              }
            })
        );
      } catch { /* signer might be slow */ }

      res.json({
        ...stats,
        treasuryBalance,
        walletGasLevels,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get gas station status' });
    }
  });

  /** GET /ops/gas-station/history — funding transaction history */
  router.get('/history', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ fundings: gasStore.getFundings(limit) });
  });

  return router;
}
