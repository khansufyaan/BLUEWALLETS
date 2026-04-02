import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { WalletService } from '../services/wallet-service';
import { validate } from '../middleware/validate';
import { Wallet, Transaction } from '../types/wallet';
import { SUPPORTED_CHAINS } from '../types/chain';
import { logger } from '../utils/logger';

const createWalletSchema = z.object({
  chain: z.enum(SUPPORTED_CHAINS as [string, ...string[]]),
  name: z.string().min(1).max(128),
  currency: z.string().min(1).max(10).optional(),
  initialBalance: z.string().regex(/^\d+$/, 'Must be a non-negative integer string').optional(),
  metadata: z.record(z.string()).optional(),
});

const transferSchema = z.object({
  toWalletId: z.string().uuid(),
  amount: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
  currency: z.string().min(1).max(10),
  memo: z.string().max(256).optional(),
});

const attachPolicySchema = z.object({
  policyId: z.string().uuid(),
});

function serializeWallet(w: Wallet) {
  return { ...w, balance: w.balance.toString() };
}

function serializeTransaction(tx: Transaction) {
  return { ...tx, amount: tx.amount.toString() };
}

export function createWalletRoutes(walletService: WalletService): Router {
  const router = Router();

  router.post('/', validate(createWalletSchema), async (req: Request, res: Response) => {
    try {
      const wallet = await walletService.createWallet(req.body);
      res.status(201).json(serializeWallet(wallet));
    } catch (error) {
      logger.error('Wallet creation failed', { error });
      let msg = error instanceof Error ? error.message : 'Wallet creation failed';
      if (msg.includes('CKR_GENERAL_ERROR') || msg.includes('CKR_MECHANISM_INVALID')) {
        msg += ' (The HSM may not support the required curve or wrapping mechanism for this key type.)';
      }
      res.status(500).json({ error: msg });
    }
  });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const wallets = await walletService.listWallets();
      res.json({ wallets: wallets.map(serializeWallet), count: wallets.length });
    } catch (error) {
      logger.error('Failed to list wallets', { error });
      res.status(500).json({ error: 'Failed to list wallets' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const wallet = await walletService.getWallet(req.params.id);
      res.json(serializeWallet(wallet));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  router.post('/:id/transfer', validate(transferSchema), async (req: Request, res: Response) => {
    try {
      const tx = await walletService.transfer(req.params.id, req.body);
      const status = tx.status === 'rejected' ? 200 : 201;
      res.status(status).json(serializeTransaction(tx));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Transfer failed';
      const status = msg.includes('not found') ? 404
        : msg.includes('Insufficient') || msg.includes('positive') ? 400
        : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.get('/:id/transactions', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const txs = await walletService.getTransactions(req.params.id, limit, offset);
      res.json({ transactions: txs.map(serializeTransaction), count: txs.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  router.post('/:id/policies', validate(attachPolicySchema), async (req: Request, res: Response) => {
    try {
      const wallet = await walletService.attachPolicy(req.params.id, req.body.policyId);
      res.json(serializeWallet(wallet));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  router.delete('/:id/policies/:policyId', async (req: Request, res: Response) => {
    try {
      const wallet = await walletService.detachPolicy(req.params.id, req.params.policyId);
      res.json(serializeWallet(wallet));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  return router;
}
