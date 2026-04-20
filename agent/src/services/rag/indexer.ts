/**
 * Knowledge Indexer — periodically pulls from Gateway/Driver and feeds the KnowledgeStore.
 *
 * Runs on startup + every 5 minutes. Deduplicates via sourceId.
 */

import { KnowledgeStore, KnowledgeChunk } from './knowledge-store';
import { config } from '../../config';
import { logger } from '../../logger';

export class KnowledgeIndexer {
  private timer?: NodeJS.Timeout;

  constructor(private store: KnowledgeStore) {}

  start(intervalMs = 5 * 60_000): void {
    // Initial ingest
    this.runOnce().catch(err => logger.warn('Initial indexing failed', { error: err.message }));
    // Periodic
    this.timer = setInterval(() => {
      this.runOnce().catch(err => logger.warn('Periodic indexing failed', { error: err.message }));
    }, intervalMs);
    logger.info('Knowledge indexer started', { intervalMs });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<{ added: number }> {
    let total = 0;
    total += await this.ingestWallets();
    total += await this.ingestVaults();
    total += await this.ingestTransactions();
    total += await this.ingestAuditLog();
    total += await this.ingestPolicies();
    if (total > 0) logger.info('Indexed new knowledge', { total });
    return { added: total };
  }

  private async fetchJson(path: string): Promise<unknown> {
    try {
      const res = await fetch(`${config.gatewayUrl}${path}`, {
        headers: config.internalAuthKey ? { 'X-Internal-Key': config.internalAuthKey } : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  private async ingestWallets(): Promise<number> {
    const data = await this.fetchJson('/ops/wallets') as any;
    const wallets = data?.wallets || data || [];
    const chunks: Omit<KnowledgeChunk, 'embedding'>[] = wallets.slice(0, 500).map((w: any) => ({
      id: `wallet-${w.id}`,
      source: 'wallet' as const,
      sourceId: w.id,
      timestamp: new Date(w.createdAt || Date.now()),
      content: `Wallet "${w.name}" on ${w.chain}. Address: ${w.address}. Balance: ${w.balance} ${w.currency}. Vault: ${w.vaultId}. Status: ${w.status}.`,
      metadata: { chain: w.chain, vaultId: w.vaultId, status: w.status, balance: w.balance },
    }));
    return await this.store.addBatch(chunks);
  }

  private async ingestVaults(): Promise<number> {
    const data = await this.fetchJson('/api/v1/vaults') as any;
    const vaults = data?.vaults || data || [];
    const chunks: Omit<KnowledgeChunk, 'embedding'>[] = vaults.map((v: any) => ({
      id: `vault-${v.id}`,
      source: 'vault' as const,
      sourceId: v.id,
      timestamp: new Date(v.createdAt || Date.now()),
      content: `Vault "${v.name}"${v.description ? ` — ${v.description}` : ''}. Status: ${v.status}. Wallets: ${(v.walletIds || []).length}.`,
      metadata: { status: v.status, walletCount: (v.walletIds || []).length },
    }));
    return await this.store.addBatch(chunks);
  }

  private async ingestTransactions(): Promise<number> {
    const data = await this.fetchJson('/ops/transactions') as any;
    const txs = (data?.transactions || data || []).slice(0, 1000);
    const chunks: Omit<KnowledgeChunk, 'embedding'>[] = txs.map((tx: any) => ({
      id: `tx-${tx.id}`,
      source: 'transaction' as const,
      sourceId: tx.id,
      timestamp: new Date(tx.createdAt || tx.timestamp || Date.now()),
      content: `Transaction ${tx.id}: ${tx.amount} ${tx.currency} from ${tx.fromWalletId || tx.from || '?'} to ${tx.toWalletId || tx.to || '?'} on ${tx.chain}. Status: ${tx.status}.${tx.failureReason ? ` Failure: ${tx.failureReason}` : ''}${tx.memo ? ` Memo: ${tx.memo}` : ''}`,
      metadata: {
        chain: tx.chain, status: tx.status, amount: tx.amount,
        fromWalletId: tx.fromWalletId, toWalletId: tx.toWalletId,
        failureReason: tx.failureReason,
      },
    }));
    return await this.store.addBatch(chunks);
  }

  private async ingestAuditLog(): Promise<number> {
    const data = await this.fetchJson('/ops/audit-log') as any;
    const events = (data?.events || data || []).slice(0, 2000);
    const chunks: Omit<KnowledgeChunk, 'embedding'>[] = events.map((e: any, idx: number) => ({
      id: `audit-${e.id || idx}`,
      source: 'audit' as const,
      sourceId: String(e.id || idx),
      timestamp: new Date(e.timestamp || Date.now()),
      content: `Audit event ${e.event}: ${e.detail || ''} Actor: ${e.actor || 'system'}. Severity: ${e.severity || 'info'}.`,
      metadata: { event: e.event, actor: e.actor, severity: e.severity, ip: e.ip },
    }));
    return await this.store.addBatch(chunks);
  }

  private async ingestPolicies(): Promise<number> {
    const data = await this.fetchJson('/api/v1/policies') as any;
    const policies = data?.policies || data || [];
    const chunks: Omit<KnowledgeChunk, 'embedding'>[] = policies.map((p: any) => ({
      id: `policy-${p.id}`,
      source: 'policy' as const,
      sourceId: p.id,
      timestamp: new Date(p.createdAt || Date.now()),
      content: `Policy "${p.name}": ${p.description || ''} Rules: ${JSON.stringify(p.rules || [])}`,
      metadata: { ruleCount: (p.rules || []).length },
    }));
    return await this.store.addBatch(chunks);
  }
}
