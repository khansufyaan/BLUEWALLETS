/**
 * Internal API — Blue Driver ↔ Blue Console communication.
 *
 * Runs on port 3200, firewalled to accept connections only from the Console.
 * Provides all operations the Console needs: signing, wallets, vaults,
 * policies, RBAC, dashboard, and authentication.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { KmsService } from '../services/kms-service';
import { WalletService } from '../services/wallet-service';
import { VaultService } from '../services/vault-service';
import { PolicyEngine } from '../services/policy-engine';
import { RbacService } from '../services/rbac-service';
import { AuthService } from '../services/auth-service';
import { IWalletStore, ITransactionStore } from '../types/store';
import { validate } from '../middleware/validate';
import { requireInternalAuth } from '../middleware/internal-auth';
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '../types/rbac';
import { logger } from '../utils/logger';

export interface InternalServices {
  kms:              KmsService;
  walletStore:      IWalletStore;
  transactionStore: ITransactionStore;
  walletService:    WalletService;
  vaultService:     VaultService;
  policyEngine:     PolicyEngine;
  rbacService:      RbacService;
  authService:      AuthService;
}

const signSchema = z.object({
  walletId: z.string().min(1),
  hashHex:  z.string().regex(/^[0-9a-fA-F]+$/, 'hashHex must be hex'),
  chain:    z.string().optional(),
});

export function createInternalRoutes(svc: InternalServices): Router {
  const router = Router();
  router.use(requireInternalAuth);

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNING
  // ═══════════════════════════════════════════════════════════════════════════

  router.post('/sign', validate(signSchema), async (req: Request, res: Response) => {
    const { walletId, hashHex } = req.body;
    try {
      const wallet = await svc.walletStore.findById(walletId);
      if (!wallet) { res.status(404).json({ error: `Wallet not found: ${walletId}` }); return; }
      if (!wallet.wrappedPrivateKey) { res.status(400).json({ error: 'No wrapped key' }); return; }

      const signature = await svc.kms.signWithWrappedKey(wallet.wrappedPrivateKey, wallet.algorithm, Buffer.from(hashHex, 'hex'));
      res.json({ signatureHex: signature.toString('hex'), publicKeyHex: wallet.publicKey, algorithm: wallet.algorithm, chain: wallet.chain, address: wallet.address });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Signing failed';
      logger.error('Internal sign failed', { error, walletId });
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WALLETS
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/wallets', async (_req: Request, res: Response) => {
    try {
      const wallets = await svc.walletStore.findAll();
      const safe = wallets.map(w => ({
        id: w.id, name: w.name, chain: w.chain, algorithm: w.algorithm,
        address: w.address, publicKey: w.publicKey, currency: w.currency,
        balance: w.balance.toString(), status: w.status, vaultId: w.vaultId,
        policyIds: w.policyIds, metadata: w.metadata, createdAt: w.createdAt,
        derivationPath: w.derivationPath || null, hdVersion: w.hdVersion || null,
      }));
      res.json({ wallets: safe });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list wallets' });
    }
  });

  router.get('/wallets/:id', async (req: Request, res: Response) => {
    try {
      const w = await svc.walletStore.findById(req.params.id);
      if (!w) { res.status(404).json({ error: 'Wallet not found' }); return; }
      res.json({
        id: w.id, name: w.name, chain: w.chain, algorithm: w.algorithm,
        address: w.address, publicKey: w.publicKey, currency: w.currency,
        balance: w.balance.toString(), status: w.status, vaultId: w.vaultId,
        policyIds: w.policyIds, metadata: w.metadata, createdAt: w.createdAt,
        derivationPath: w.derivationPath || null, hdVersion: w.hdVersion || null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get wallet' });
    }
  });

  router.post('/wallets', async (req: Request, res: Response) => {
    try {
      const wallet = await svc.walletService.createWallet(req.body);
      res.status(201).json({ ...wallet, balance: wallet.balance.toString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create wallet';
      res.status(400).json({ error: msg });
    }
  });

  router.post('/wallets/:id/transfer', async (req: Request, res: Response) => {
    try {
      const tx = await svc.walletService.transfer(req.params.id, req.body);
      res.json({ ...tx, amount: tx.amount.toString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Transfer failed';
      res.status(400).json({ error: msg });
    }
  });

  router.get('/wallets/:id/transactions', async (req: Request, res: Response) => {
    try {
      const txs = await svc.walletService.getTransactions(req.params.id);
      res.json({ transactions: txs.map(t => ({ ...t, amount: t.amount.toString() })) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get transactions' });
    }
  });

  router.post('/wallets/:id/balance', async (req: Request, res: Response) => {
    try {
      const wallet = await svc.walletStore.findById(req.params.id);
      if (!wallet) { res.status(404).json({ error: 'Wallet not found' }); return; }
      await svc.walletStore.update(req.params.id, { balance: BigInt(req.body.balance) });
      res.json({ updated: true, balance: req.body.balance });
    } catch (error) {
      res.status(500).json({ error: 'Balance update failed' });
    }
  });

  router.post('/wallets/:id/status', async (req: Request, res: Response) => {
    try {
      const { status } = req.body;
      if (!['active', 'frozen'].includes(status)) { res.status(400).json({ error: 'status must be active or frozen' }); return; }
      await svc.walletStore.update(req.params.id, { status });
      res.json({ updated: true, walletId: req.params.id, status });
    } catch (error) {
      res.status(500).json({ error: 'Status update failed' });
    }
  });

  router.post('/wallets/:id/policies', async (req: Request, res: Response) => {
    try {
      const result = await svc.walletService.attachPolicy(req.params.id, req.body.policyId);
      res.json({ ...result, balance: result.balance.toString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to attach policy';
      res.status(400).json({ error: msg });
    }
  });

  router.delete('/wallets/:id/policies/:policyId', async (req: Request, res: Response) => {
    try {
      const result = await svc.walletService.detachPolicy(req.params.id, req.params.policyId);
      res.json({ ...result, balance: result.balance.toString() });
    } catch (error) {
      res.status(400).json({ error: 'Failed to detach policy' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VAULTS
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/vaults', async (_req: Request, res: Response) => {
    try {
      const vaults = await svc.vaultService.listVaults();
      res.json({ vaults });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list vaults' });
    }
  });

  router.get('/vaults/:id', async (req: Request, res: Response) => {
    try {
      const vault = await svc.vaultService.getVault(req.params.id);
      res.json(vault);
    } catch (error) {
      res.status(404).json({ error: 'Vault not found' });
    }
  });

  router.post('/vaults', async (req: Request, res: Response) => {
    try {
      const vault = await svc.vaultService.createVault(req.body);
      res.status(201).json(vault);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create vault';
      res.status(400).json({ error: msg });
    }
  });

  router.post('/vaults/:id/wallets', async (req: Request, res: Response) => {
    try {
      const wallet = await svc.walletService.createWallet({ ...req.body, vaultId: req.params.id });
      res.status(201).json({ ...wallet, balance: wallet.balance.toString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create wallet in vault';
      res.status(400).json({ error: msg });
    }
  });

  router.get('/vaults/:id/wallets', async (req: Request, res: Response) => {
    try {
      const wallets = await svc.walletStore.findAll();
      const filtered = wallets.filter(w => w.vaultId === req.params.id);
      res.json({ wallets: filtered.map(w => ({ ...w, balance: w.balance.toString() })) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list vault wallets' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POLICIES
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/policies', async (_req: Request, res: Response) => {
    try {
      const policies = await svc.policyEngine.listPolicies();
      res.json({ policies });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list policies' });
    }
  });

  router.get('/policies/:id', async (req: Request, res: Response) => {
    try {
      const policy = await svc.policyEngine.getPolicy(req.params.id);
      res.json(policy);
    } catch (error) {
      res.status(404).json({ error: 'Policy not found' });
    }
  });

  router.post('/policies', async (req: Request, res: Response) => {
    try {
      const policy = await svc.policyEngine.createPolicy(req.body);
      res.status(201).json(policy);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create policy';
      res.status(400).json({ error: msg });
    }
  });

  router.put('/policies/:id', async (req: Request, res: Response) => {
    try {
      const policy = await svc.policyEngine.updatePolicy(req.params.id, req.body);
      res.json(policy);
    } catch (error) {
      res.status(400).json({ error: 'Failed to update policy' });
    }
  });

  router.delete('/policies/:id', async (req: Request, res: Response) => {
    try {
      await svc.policyEngine.deletePolicy(req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      res.status(400).json({ error: 'Failed to delete policy' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RBAC
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/roles', async (_req: Request, res: Response) => {
    try {
      const roles = await svc.rbacService.listRoles();
      res.json({ roles });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list roles' });
    }
  });

  router.get('/permissions', (_req: Request, res: Response) => {
    res.json({ permissions: ALL_PERMISSIONS, groups: PERMISSION_GROUPS });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/dashboard/stats', async (_req: Request, res: Response) => {
    try {
      const wallets = await svc.walletStore.findAll();
      const allTxs = await svc.transactionStore.findAll(1000);
      const vaults = await svc.vaultService.listVaults();

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayTxs = allTxs.filter(t => new Date(t.createdAt) >= todayStart);

      // Compute AUM by currency
      const aumByCurrency: Record<string, string> = {};
      wallets.forEach(w => {
        if (w.balance > 0n) {
          const current = BigInt(aumByCurrency[w.currency] || '0');
          aumByCurrency[w.currency] = (current + w.balance).toString();
        }
      });

      res.json({
        wallets: wallets.length,
        chains: new Set(wallets.map(w => w.chain)).size,
        totalTransactions: allTxs.length,
        transactionsToday: todayTxs.length,
        rejectedToday: todayTxs.filter(t => t.status === 'rejected').length,
        pendingApprovals: allTxs.filter(t => t.status === 'pending').length,
        aumByCurrency,
        vaults: vaults.length,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  router.get('/dashboard/transactions', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const txs = await svc.transactionStore.findAll(limit);
      res.json({ transactions: txs });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get transactions' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH (proxied from Console)
  // ═══════════════════════════════════════════════════════════════════════════

  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      const result = await svc.authService.login(username, password);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Login failed';
      res.status(401).json({ error: msg });
    }
  });

  router.post('/auth/logout', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) svc.authService.logout(token);
      res.json({ loggedOut: true });
    } catch (error) {
      res.json({ loggedOut: true });
    }
  });

  router.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const token = req.headers['x-user-token'] as string;
      if (!token) { res.status(401).json({ error: 'No token' }); return; }
      const user = svc.authService.validate(token);
      if (!user) { res.status(401).json({ error: 'Invalid token' }); return; }
      res.json(user);
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  return router;
}
