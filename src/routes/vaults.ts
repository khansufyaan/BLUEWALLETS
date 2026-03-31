import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { VaultService } from '../services/vault-service';
import { WalletService } from '../services/wallet-service';
import { validate } from '../middleware/validate';
import { Wallet } from '../types/wallet';
import { logger } from '../utils/logger';

const createVaultSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
});

const CHAINS = ['bitcoin', 'ethereum', 'solana', 'bsc', 'polygon', 'arbitrum', 'tron', 'avalanche', 'litecoin'] as const;

const createWalletInVaultSchema = z.object({
  chain: z.enum(CHAINS),
  name: z.string().min(1).max(128),
  currency: z.string().min(1).max(10).optional(),
  initialBalance: z.string().regex(/^\d+$/).optional(),
  metadata: z.record(z.string()).optional(),
});

function serializeWallet(w: Wallet) {
  return { ...w, balance: w.balance.toString() };
}

export function createVaultRoutes(vaultService: VaultService, walletService: WalletService): Router {
  const router = Router();

  router.post('/', validate(createVaultSchema), async (req: Request, res: Response) => {
    try {
      const vault = await vaultService.createVault(req.body);
      res.status(201).json(vault);
    } catch (error) {
      logger.error('Vault creation failed', { error });
      res.status(500).json({ error: 'Vault creation failed' });
    }
  });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const vaults = await vaultService.listVaults();
      res.json({ vaults, count: vaults.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list vaults' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const vault = await vaultService.getVault(req.params.id);
      res.json(vault);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  // Create wallet inside a vault
  router.post('/:id/wallets', validate(createWalletInVaultSchema), async (req: Request, res: Response) => {
    try {
      const vault = await vaultService.getVault(req.params.id);
      const wallet = await walletService.createWallet({ ...req.body, vaultId: vault.id });
      await vaultService.addWalletToVault(vault.id, wallet.id);
      res.status(201).json(serializeWallet(wallet));
    } catch (error) {
      logger.error('Wallet creation in vault failed', { error });
      let msg = error instanceof Error ? error.message : 'Failed';
      if (msg.includes('CKR_')) msg += ' (HSM error)';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  // List wallets in a vault
  router.get('/:id/wallets', async (req: Request, res: Response) => {
    try {
      const vault = await vaultService.getVault(req.params.id);
      const allWallets = await walletService.listWallets();
      const vaultWallets = allWallets.filter(w => vault.walletIds.includes(w.id));
      res.json({ wallets: vaultWallets.map(serializeWallet), count: vaultWallets.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  return router;
}
