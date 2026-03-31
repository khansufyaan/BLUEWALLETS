import { Router, Request, Response } from 'express';
import { WalletService } from '../services/wallet-service';
import { VaultService } from '../services/vault-service';
import { PolicyEngine } from '../services/policy-engine';
import { RbacService } from '../services/rbac-service';
import { ITransactionStore } from '../types/store';
import { Transaction } from '../types/wallet';

function serializeTx(tx: Transaction) {
  return { ...tx, amount: tx.amount.toString() };
}

export function createDashboardRoutes(
  walletService: WalletService,
  vaultService: VaultService,
  policyEngine: PolicyEngine,
  rbacService: RbacService,
  transactionStore: ITransactionStore
): Router {
  const router = Router();

  // Global transaction feed
  router.get('/transactions', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const txs = await transactionStore.findAll(limit, offset);
      res.json({ transactions: txs.map(serializeTx), count: txs.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  // Dashboard stats
  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const [wallets, vaults, policies, roles, recentTxs] = await Promise.all([
        walletService.listWallets(),
        vaultService.listVaults(),
        policyEngine.listPolicies(),
        rbacService.listRoles(),
        transactionStore.findAll(1000),
      ]);

      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      const txToday = recentTxs.filter(tx => tx.createdAt.getTime() >= oneDayAgo);
      const completedToday = txToday.filter(tx => tx.status === 'completed');
      const rejectedToday = txToday.filter(tx => tx.status === 'rejected');
      const pendingAll = recentTxs.filter(tx => tx.status === 'pending');
      const volumeToday = completedToday.reduce((sum, tx) => sum + tx.amount, 0n);

      // Volume by currency for human-readable display
      const volumeByCurrency: Record<string, bigint> = {};
      completedToday.forEach(tx => {
        volumeByCurrency[tx.currency] = (volumeByCurrency[tx.currency] || 0n) + tx.amount;
      });
      const volumeByCurrencySerialized: Record<string, string> = {};
      for (const [k, v] of Object.entries(volumeByCurrency)) {
        volumeByCurrencySerialized[k] = v.toString();
      }

      // AUM (Assets Under Management) by currency
      const aumByCurrency: Record<string, bigint> = {};
      wallets.forEach(w => {
        aumByCurrency[w.currency] = (aumByCurrency[w.currency] || 0n) + w.balance;
      });
      const aumSerialized: Record<string, string> = {};
      for (const [k, v] of Object.entries(aumByCurrency)) {
        aumSerialized[k] = v.toString();
      }

      res.json({
        vaults: vaults.length,
        wallets: wallets.length,
        chains: new Set(wallets.map(w => w.chain)).size,
        activePolicies: policies.filter(p => p.enabled).length,
        totalPolicies: policies.length,
        roles: roles.length,
        transactionsToday: txToday.length,
        completedToday: completedToday.length,
        rejectedToday: rejectedToday.length,
        pendingApprovals: pendingAll.length,
        volumeToday: volumeToday.toString(),
        volumeByCurrency: volumeByCurrencySerialized,
        aumByCurrency: aumSerialized,
        totalTransactions: recentTxs.length,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  return router;
}
