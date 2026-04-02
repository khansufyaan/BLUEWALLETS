/**
 * Ops Dashboard API — backend for the gateway operations dashboard.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { txStore } from '../stores/tx-store';
import { depositStore } from '../stores/deposit-store';
import { SignerClient } from '../services/signer-client';
import { getProvider, getChainConfig } from '../services/evm/evm-provider';
import { getEnabledChains } from '../config';
import { logger } from '../utils/logger';

export function createOpsRoutes(signerClient: SignerClient): Router {
  const router = Router();

  /** GET /ops/stats — aggregate dashboard KPIs */
  router.get('/stats', (_req: Request, res: Response) => {
    const txStats = txStore.getStats();
    const depositStats = depositStore.getStats();
    const enabledChains = Object.keys(getEnabledChains());

    res.json({
      transactions: txStats,
      deposits:     depositStats,
      activeChains: enabledChains.length,
      chains:       enabledChains,
    });
  });

  /** GET /ops/transactions — list broadcast transactions */
  router.get('/transactions', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const txs = status ? txStore.getByStatus(status as any) : txStore.getAll();
    res.json({ transactions: txs.slice(0, 100) });
  });

  /** GET /ops/deposits — list detected deposits */
  router.get('/deposits', (_req: Request, res: Response) => {
    res.json({ deposits: depositStore.getAll().slice(0, 100) });
  });

  /** GET /ops/wallets — wallets with on-chain balances */
  router.get('/wallets', async (_req: Request, res: Response) => {
    try {
      const wallets = await signerClient.listWallets();
      // Enrich with on-chain balance for EVM wallets
      const enriched = await Promise.all(wallets.map(async (w) => {
        try {
          const chainKey = w.chain.toLowerCase();
          const chains = getEnabledChains();
          if (!chains[chainKey]) return { ...w, onChainBalance: null };
          const provider = getProvider(chainKey);
          const balance = await provider.getBalance(w.address);
          return { ...w, onChainBalance: balance.toString() };
        } catch {
          return { ...w, onChainBalance: null };
        }
      }));
      res.json({ wallets: enriched });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to list wallets';
      res.status(500).json({ error: msg });
    }
  });

  /** GET /ops/chains — per-chain health */
  router.get('/chains', async (_req: Request, res: Response) => {
    const enabled = getEnabledChains();
    const chainHealth = await Promise.all(
      Object.entries(enabled).map(async ([key, cfg]) => {
        const start = Date.now();
        try {
          const provider = getProvider(key);
          const [blockNumber, feeData] = await Promise.all([
            provider.getBlockNumber(),
            provider.getFeeData(),
          ]);
          const latency = Date.now() - start;

          return {
            chain:     key,
            name:      cfg.name,
            chainId:   cfg.chainId,
            ticker:    cfg.ticker,
            status:    'connected',
            blockNumber,
            latencyMs: latency,
            gasPrice:  feeData.gasPrice?.toString() || null,
            maxFeePerGas: feeData.maxFeePerGas?.toString() || null,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() || null,
            eip1559:   cfg.eip1559,
            rpcUrl:    cfg.rpcUrl.replace(/\/[a-zA-Z0-9]{20,}/, '/***'), // mask API key
          };
        } catch (error) {
          return {
            chain:  key,
            name:   cfg.name,
            chainId: cfg.chainId,
            ticker: cfg.ticker,
            status: 'error',
            error:  error instanceof Error ? error.message : 'Connection failed',
            latencyMs: Date.now() - start,
          };
        }
      })
    );
    res.json({ chains: chainHealth });
  });

  return router;
}
