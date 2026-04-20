/**
 * Compliance Ops Dashboard Routes — full intelligence platform.
 *
 * Aggregates data from TRM Labs, Chainalysis, and Notabene into a
 * unified compliance intelligence view.
 */

import { Router, Request, Response } from 'express';
import { complianceStore } from '../stores/compliance-store';
import { SignerClient } from '../services/signer-client';
import { screenWithChainalysis, getEntityInfo, getMarketData } from '../services/compliance/chainalysis-client';
import { screenWithTrm, batchScreenAddresses } from '../services/compliance/trm-client';
import { listTransactions as listNbTransactions, validateTransaction } from '../services/compliance/notabene-client';
import { logger } from '../utils/logger';

export function createOpsComplianceRoutes(signerClient: SignerClient): Router {
  const router = Router();

  // ── Config ──────────────────────────────────────────────────

  /** GET /ops/compliance/config — configured providers (keys masked) */
  router.get('/config', (_req: Request, res: Response) => {
    res.json(complianceStore.getConfigMasked());
  });

  /** POST /ops/compliance/config — set API keys from dashboard */
  router.post('/config', (req: Request, res: Response) => {
    try {
      complianceStore.setConfig(req.body);
      const updated = complianceStore.getConfig();
      logger.info('Compliance config updated', {
        chainalysis: updated.chainalysis.enabled,
        trm:         updated.trm.enabled,
        notabene:    updated.notabene.enabled,
      });
      res.json(complianceStore.getConfigMasked());
    } catch (error) {
      res.status(400).json({ error: 'Invalid compliance config' });
    }
  });

  // ── Summary (aggregates all three sources) ──────────────────

  /** GET /ops/compliance/summary — stat cards + requires-action alerts */
  router.get('/summary', async (_req: Request, res: Response) => {
    const stats = complianceStore.getStats();
    const decisions = complianceStore.getDecisions(100);

    // Count high-risk from TRM screenings (score >= 70)
    const highRiskCount = decisions.filter(d =>
      d.results.some(r => r.provider === 'trm' && r.riskScore !== null && r.riskScore >= 70)
    ).length;

    // Count sanctions from Chainalysis
    const sanctionsHits = decisions.filter(d =>
      d.results.some(r => r.provider === 'chainalysis' && r.sanctioned)
    ).length;

    // Get Notabene pending TRs
    let trPending = 0;
    let oldestPendingMinutes = 0;
    const nbData = await listNbTransactions().catch(() => null);
    if (nbData) {
      trPending = nbData.metrics.pendingCount;
      oldestPendingMinutes = nbData.metrics.oldestPendingMinutes;
    }

    // Build requires-action list
    type ActionItem = {
      severity: 'critical' | 'high' | 'warning' | 'info';
      source: 'TRM' | 'Chainalysis' | 'Notabene';
      type: string;
      title: string;
      description: string;
      address?: string;
      txHash?: string;
    };

    const requiresAction: ActionItem[] = [];

    // Sanctions hits → critical
    const sanctionedDecisions = decisions.filter(d =>
      d.results.some(r => r.sanctioned)
    );
    sanctionedDecisions.forEach(d => {
      const sanctionResult = d.results.find(r => r.sanctioned);
      requiresAction.push({
        severity: 'critical',
        source: (sanctionResult?.provider === 'chainalysis' ? 'Chainalysis' : 'TRM') as any,
        type: 'sanctions',
        title: 'Sanctions Hit',
        description: `Address ${d.address.slice(0, 10)}... flagged by ${sanctionResult?.provider}`,
        address: d.address,
      });
    });

    // High risk (TRM score >= 70) → high
    const highRiskDecisions = decisions.filter(d =>
      !d.results.some(r => r.sanctioned) &&
      d.results.some(r => r.provider === 'trm' && r.riskScore !== null && r.riskScore >= 70)
    );
    highRiskDecisions.slice(0, 5).forEach(d => {
      const trmResult = d.results.find(r => r.provider === 'trm');
      requiresAction.push({
        severity: 'high',
        source: 'TRM',
        type: 'high-risk',
        title: `High Risk (${trmResult?.riskScore}/100)`,
        description: `${d.address.slice(0, 10)}... — ${trmResult?.categories?.join(', ') || 'review required'}`,
        address: d.address,
      });
    });

    // Pending TRs > 2 hours → warning
    if (nbData) {
      const oldPending = nbData.transactions.filter(t =>
        (t.status === 'SENT' || t.status === 'NEW') && t.ageMinutes > 120
      );
      oldPending.slice(0, 3).forEach(t => {
        requiresAction.push({
          severity: 'warning',
          source: 'Notabene',
          type: 'travel-rule-pending',
          title: 'TR Pending > 2h',
          description: `${t.asset} ${t.amount} to ${t.counterpartyVASP || 'unknown VASP'} — ${t.ageMinutes}min`,
        });
      });
    }

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, warning: 2, info: 3 };
    requiresAction.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    res.json({
      screenedToday:       stats.total,
      highRiskCount,
      sanctionsHits,
      trPending,
      oldestPendingMinutes,
      blocked:             stats.blocked,
      allowed:             stats.allowed,
      providers:           stats.providers,
      requiresAction,
    });
  });

  // ── Screenings ──────────────────────────────────────────────

  /** GET /ops/compliance/screenings — screening decision history */
  router.get('/screenings', (req: Request, res: Response) => {
    const raw = parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 1000)) : 100;
    res.json({ decisions: complianceStore.getDecisions(limit) });
  });

  /** GET /ops/compliance/blocked — blocked transfers only */
  router.get('/blocked', (req: Request, res: Response) => {
    const raw = parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 1000)) : 100;
    res.json({ decisions: complianceStore.getBlockedDecisions(limit) });
  });

  /** GET /ops/compliance/stats — basic stats */
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(complianceStore.getStats());
  });

  // ── Manual screening ───────────────────────────────────────

  /** POST /ops/compliance/screen — manually screen an address */
  router.post('/screen', async (req: Request, res: Response) => {
    const { address, chain } = req.body;
    if (!address) {
      res.status(400).json({ error: 'address is required' });
      return;
    }

    const resolvedChain = (chain || 'ethereum').toLowerCase();
    const results = [];

    const [chainalysis, trm] = await Promise.allSettled([
      screenWithChainalysis(address, resolvedChain),
      screenWithTrm(address, resolvedChain),
    ]);

    if (chainalysis.status === 'fulfilled' && chainalysis.value) results.push(chainalysis.value);
    if (trm.status === 'fulfilled' && trm.value) results.push(trm.value);

    res.json({ address, chain: resolvedChain, results });
  });

  // ── Risk by category (TRM primary) ─────────────────────────

  /** GET /ops/compliance/risk-by-category */
  router.get('/risk-by-category', (_req: Request, res: Response) => {
    const decisions = complianceStore.getDecisions(500);
    const categoryMap = new Map<string, { count: number; highRisk: number }>();

    decisions.forEach(d => {
      d.results.forEach(r => {
        if (r.provider !== 'trm') return;
        r.categories.forEach(cat => {
          const existing = categoryMap.get(cat) || { count: 0, highRisk: 0 };
          existing.count++;
          if (r.riskScore !== null && r.riskScore >= 70) existing.highRisk++;
          categoryMap.set(cat, existing);
        });
      });
    });

    const categories = [...categoryMap.entries()]
      .map(([name, data]) => ({
        name,
        count: data.count,
        highRiskCount: data.highRisk,
        riskLevel: data.highRisk > 0 ? 'high' : 'medium',
        percentage: decisions.length > 0 ? Math.round((data.count / decisions.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({ categories, source: 'TRM' });
  });

  // ── Chain risk distribution (TRM) ──────────────────────────

  /** GET /ops/compliance/chain-risk */
  router.get('/chain-risk', (_req: Request, res: Response) => {
    const decisions = complianceStore.getDecisions(500);
    const chainMap = new Map<string, { total: number; highRisk: number }>();

    decisions.forEach(d => {
      const existing = chainMap.get(d.chain) || { total: 0, highRisk: 0 };
      existing.total++;
      const hasHighRisk = d.results.some(r =>
        r.provider === 'trm' && r.riskScore !== null && r.riskScore >= 70
      );
      if (hasHighRisk) existing.highRisk++;
      chainMap.set(d.chain, existing);
    });

    const chains = [...chainMap.entries()]
      .map(([name, data]) => ({
        name,
        highRiskCount: data.highRisk,
        totalCount: data.total,
      }))
      .sort((a, b) => b.highRiskCount - a.highRiskCount);

    res.json({ chains, source: 'TRM' });
  });

  // ── Travel Rule (Notabene) ─────────────────────────────────

  /** GET /ops/compliance/travel-rule — Notabene TR transactions + metrics */
  router.get('/travel-rule', async (_req: Request, res: Response) => {
    const data = await listNbTransactions();
    if (!data) {
      res.json({ transactions: [], metrics: null, source: 'Notabene', available: false });
      return;
    }
    res.json({ ...data, source: 'Notabene', available: true });
  });

  // ── Exchange Flows (Chainalysis Market Intel) ──────────────

  /** GET /ops/compliance/market — exchange flows + whale activity */
  router.get('/market', async (_req: Request, res: Response) => {
    const data = await getMarketData();
    if (!data) {
      res.json({ exchangeFlows: [], whaleActivity: null, source: 'Chainalysis', available: false });
      return;
    }
    res.json({ ...data, source: 'Chainalysis', available: true });
  });

  // ── Health check per vendor ────────────────────────────────

  /** GET /ops/compliance/health — ping each vendor API */
  router.get('/health', async (_req: Request, res: Response) => {
    const config = complianceStore.getConfig();
    const vendorStatus: Record<string, string> = {
      trm: 'not_configured',
      chainalysis: 'not_configured',
      notabene: 'not_configured',
    };

    if (config.trm.enabled) {
      try {
        // TRM doesn't have a health endpoint — try a minimal screen
        await batchScreenAddresses([{ address: '0x0000000000000000000000000000000000000000', chain: 'ethereum' }]);
        vendorStatus.trm = 'connected';
      } catch { vendorStatus.trm = 'error'; }
    }

    if (config.chainalysis.enabled) {
      try {
        const r = await screenWithChainalysis('0x0000000000000000000000000000000000000000', 'ethereum');
        vendorStatus.chainalysis = r ? 'connected' : 'error';
      } catch { vendorStatus.chainalysis = 'error'; }
    }

    if (config.notabene.enabled) {
      try {
        const r = await listNbTransactions('ALL', 1);
        vendorStatus.notabene = r ? 'connected' : 'error';
      } catch { vendorStatus.notabene = 'error'; }
    }

    res.json({ vendors: vendorStatus, timestamp: new Date().toISOString() });
  });

  // ── Freeze/Unfreeze ─────────────────────────────────────────

  /** POST /ops/compliance/freeze/:walletId */
  router.post('/freeze/:walletId', async (req: Request, res: Response) => {
    try {
      await signerClient.updateWalletStatus(req.params.walletId, 'frozen');
      logger.info('Wallet frozen via compliance', { walletId: req.params.walletId });
      res.json({ walletId: req.params.walletId, status: 'frozen' });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Freeze failed' });
    }
  });

  /** POST /ops/compliance/unfreeze/:walletId */
  router.post('/unfreeze/:walletId', async (req: Request, res: Response) => {
    try {
      await signerClient.updateWalletStatus(req.params.walletId, 'active');
      logger.info('Wallet unfrozen via compliance', { walletId: req.params.walletId });
      res.json({ walletId: req.params.walletId, status: 'active' });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unfreeze failed' });
    }
  });

  return router;
}
