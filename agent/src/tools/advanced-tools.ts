/**
 * Advanced tools — natural language generation, forensic analysis, RAG search.
 */

import { ToolHandler, ToolContext } from './registry';
import { config } from '../config';
import { KnowledgeStore } from '../services/rag/knowledge-store';

// ── Helper: call Gateway ─────────────────────────────────────────────────────
async function gw(path: string, opts: RequestInit = {}, ctx?: ToolContext): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (ctx?.userToken) headers['Authorization'] = `Bearer ${ctx.userToken}`;
  if (config.internalAuthKey) headers['X-Internal-Key'] = config.internalAuthKey;
  const url = path.startsWith('http') ? path : `${config.gatewayUrl}${path}`;
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. DRAFT POLICY — Natural language → policy JSON
// ═══════════════════════════════════════════════════════════════════════════
export const DRAFT_POLICY: ToolHandler = {
  name: 'draft_policy',
  kind: 'write',
  description: `Draft a wallet/transfer policy from natural language. Returns a structured policy object that the admin can review and activate. Examples:
  - "Block any outbound transfer over 10 ETH"
  - "Require 2 approvals for transfers to non-whitelisted addresses"
  - "Allow only transfers to these 5 addresses: 0x..., 0x..."
  - "Block transfers from 2am-6am UTC"`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short name for the policy' },
      description: { type: 'string', description: 'Human-readable description' },
      rules: {
        type: 'array',
        description: 'Array of rule objects. Each rule has type + params.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['amount_limit', 'whitelist', 'blacklist', 'time_window', 'approval_required', 'velocity_limit', 'chain_restriction'],
              description: 'Rule type',
            },
            max_amount: { type: 'string', description: 'Max amount in smallest unit (for amount_limit)' },
            addresses: { type: 'array', items: { type: 'string' }, description: 'Address list (for whitelist/blacklist)' },
            start_hour_utc: { type: 'number', description: '0-23 (for time_window)' },
            end_hour_utc: { type: 'number', description: '0-23 (for time_window)' },
            approvers_required: { type: 'number', description: 'Count (for approval_required)' },
            max_tx_per_hour: { type: 'number', description: 'Rate limit (for velocity_limit)' },
            allowed_chains: { type: 'array', items: { type: 'string' }, description: 'Chain whitelist (for chain_restriction)' },
          },
          required: ['type'],
        },
      },
      apply_to_wallet_ids: { type: 'array', items: { type: 'string' }, description: 'Optional: attach to these wallets immediately' },
    },
    required: ['name', 'rules'],
  },
  async execute(args, ctx) {
    // Create the policy via Driver API
    const policy = await gw('/api/v1/policies', {
      method: 'POST',
      body: JSON.stringify({
        name: args.name,
        description: args.description,
        rules: args.rules,
      }),
    }, ctx) as any;

    const attached: string[] = [];
    if (Array.isArray(args.apply_to_wallet_ids) && policy?.id) {
      for (const walletId of args.apply_to_wallet_ids as string[]) {
        try {
          await gw(`/api/v1/wallets/${encodeURIComponent(walletId)}/policies`, {
            method: 'POST',
            body: JSON.stringify({ policyId: policy.id }),
          }, ctx);
          attached.push(walletId);
        } catch { /* skip */ }
      }
    }

    return { policy, attached_to_wallets: attached };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. DRAFT AUTOMATION — Natural language → When/If/Then rule
// ═══════════════════════════════════════════════════════════════════════════
export const DRAFT_AUTOMATION: ToolHandler = {
  name: 'draft_automation',
  kind: 'write',
  description: `Create a When/If/Then automation rule from natural language. Examples:
  - "When ETH arrives in Deposit Vault, sweep it to Treasury"
  - "Every night at 2am UTC, move any hot wallet balance above 10 ETH to cold storage"
  - "When USDT deposits exceed 100, liquidate to USDC"`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Automation name' },
      trigger: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['time', 'transaction'], description: 'Trigger type' },
          schedule: { type: 'string', enum: ['hourly', 'daily', 'weekly'], description: 'For time trigger' },
          time: { type: 'string', description: 'UTC time HH:MM (for time trigger)' },
          direction: { type: 'string', enum: ['inbound', 'outbound', 'any'], description: 'For tx trigger' },
          source_wallets: { type: 'array', items: { type: 'string' } },
          asset: { type: 'string', description: 'ETH, BTC, USDC, etc.' },
          amount_gte: { type: 'string' },
        },
        required: ['type'],
      },
      condition: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['unconditional', 'balance_above', 'balance_below'] },
          asset: { type: 'string' },
          threshold: { type: 'string' },
        },
      },
      action: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['transfer'] },
          from: { type: 'string' },
          to: { type: 'string' },
          amount_type: { type: 'string', enum: ['full', 'specific', 'partial', 'inherited'] },
          amount: { type: 'string' },
          asset: { type: 'string' },
        },
        required: ['type', 'from', 'to'],
      },
    },
    required: ['name', 'trigger', 'action'],
  },
  async execute(args, _ctx) {
    // Store automation — for now, return the structured object so the UI can render it.
    // Production: POST to /ops/automations endpoint on the Driver.
    return {
      id: `auto-${Date.now()}`,
      name: args.name,
      active: false, // Draft — admin must activate
      trigger: args.trigger,
      condition: args.condition || { type: 'unconditional' },
      action: args.action,
      status: 'draft',
      message: 'Automation drafted. Review in the Automations page and toggle active to enable.',
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. BATCH CREATE WALLETS — NL → bulk wallet provisioning
// ═══════════════════════════════════════════════════════════════════════════
export const BATCH_CREATE_WALLETS: ToolHandler = {
  name: 'batch_create_wallets',
  kind: 'write',
  description: `Create multiple wallets at once across one or more chains. Useful for: "Create 10 ETH wallets named hot-1 through hot-10" or "Spin up wallets on ethereum, polygon, arbitrum for a new customer".`,
  parameters: {
    type: 'object',
    properties: {
      vault_id: { type: 'string', description: 'Vault to create wallets in' },
      chain: { type: 'string', description: 'Chain for all wallets (or use chains array for mixed)' },
      chains: { type: 'array', items: { type: 'string' }, description: 'Multiple chains — one wallet per chain' },
      count: { type: 'number', description: 'Number of wallets to create (default 1)' },
      name_prefix: { type: 'string', description: 'Name prefix — wallets will be named "{prefix}-1", "{prefix}-2", etc.' },
      names: { type: 'array', items: { type: 'string' }, description: 'Explicit names (overrides count + prefix)' },
    },
    required: ['vault_id'],
  },
  async execute(args, ctx) {
    const results: Array<{ name: string; chain: string; wallet?: unknown; error?: string }> = [];
    const chains: string[] = Array.isArray(args.chains)
      ? (args.chains as unknown[]).map(String)
      : (args.chain ? [String(args.chain)] : []);
    const names: string[] = Array.isArray(args.names)
      ? (args.names as unknown[]).map(String)
      : [];
    const count = Number(args.count) || (names.length > 0 ? names.length : 1);
    const prefix = String(args.name_prefix || 'wallet');

    if (chains.length === 0) throw new Error('Must specify chain or chains');

    const plan: Array<{ name: string; chain: string }> = [];
    if (names.length > 0) {
      for (let i = 0; i < names.length; i++) {
        plan.push({ name: names[i], chain: chains[i % chains.length] });
      }
    } else {
      for (let i = 0; i < count; i++) {
        plan.push({ name: `${prefix}-${i + 1}`, chain: chains[i % chains.length] });
      }
    }

    if (plan.length > 50) throw new Error('Batch limited to 50 wallets per call for safety');

    for (const item of plan) {
      try {
        const wallet = await gw(`/api/v1/vaults/${encodeURIComponent(String(args.vault_id))}/wallets`, {
          method: 'POST',
          body: JSON.stringify({ chain: item.chain, name: item.name, initialBalance: '0' }),
        }, ctx);
        results.push({ ...item, wallet });
      } catch (err) {
        results.push({ ...item, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      total: plan.length,
      succeeded: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
      results,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. DRAFT COMPLIANCE RULE — NL → screening config
// ═══════════════════════════════════════════════════════════════════════════
export const DRAFT_COMPLIANCE_RULE: ToolHandler = {
  name: 'draft_compliance_rule',
  kind: 'write',
  description: `Generate a compliance screening rule for the TRM/Chainalysis gate. Examples:
  - "Block any address with a TRM risk score above 70"
  - "Require manual review for transfers > $10,000 USD equivalent"
  - "Auto-block addresses tagged as 'sanctions' or 'stolen funds'"`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      provider: { type: 'string', enum: ['trm', 'chainalysis', 'any'] },
      action: { type: 'string', enum: ['block', 'flag', 'require_review'] },
      risk_score_gte: { type: 'number', description: 'Trigger when risk score >= this' },
      usd_amount_gte: { type: 'number', description: 'Trigger when USD value >= this' },
      tags_any: { type: 'array', items: { type: 'string' }, description: 'Trigger if any of these tags match (sanctions, stolen_funds, mixer, etc.)' },
    },
    required: ['name', 'action'],
  },
  async execute(args, _ctx) {
    // Return the draft for admin review — actual compliance config lives in settings
    return {
      id: `crule-${Date.now()}`,
      status: 'draft',
      rule: args,
      message: 'Compliance rule drafted. Review in the Compliance Settings page to activate.',
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. DRAFT ROLE ASSIGNMENT — NL → RBAC change
// ═══════════════════════════════════════════════════════════════════════════
export const DRAFT_ROLE_ASSIGNMENT: ToolHandler = {
  name: 'draft_role_assignment',
  kind: 'write',
  description: `Modify a user's role or permissions. Examples:
  - "Give alice the operator role on the Production vault"
  - "Remove bob's transfer permissions"
  - "Add a new role called 'read-only-auditor' with just read permissions"`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['assign_role', 'revoke_role', 'create_role'] },
      username: { type: 'string', description: 'Target user (for assign/revoke)' },
      role_name: { type: 'string', description: 'Role to assign/revoke/create' },
      scope: { type: 'string', description: 'Optional: vault ID or "global"' },
      permissions: { type: 'array', items: { type: 'string' }, description: 'For create_role — list of permissions' },
    },
    required: ['action', 'role_name'],
  },
  async execute(args, _ctx) {
    return {
      id: `rbac-${Date.now()}`,
      status: 'draft',
      change: args,
      message: 'Role change drafted. Review in the Roles page to apply.',
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. ANALYZE INCIDENT — Forensic timeline builder
// ═══════════════════════════════════════════════════════════════════════════
export const ANALYZE_INCIDENT: ToolHandler = {
  name: 'analyze_incident',
  kind: 'read',
  description: `Build a forensic timeline for a specific transaction, wallet, or incident. Cross-references audit log, transactions, policy evaluations, and compliance screenings. Use this when an admin asks "What happened with tx X?" or "Why was this blocked?".`,
  parameters: {
    type: 'object',
    properties: {
      tx_id: { type: 'string', description: 'Transaction ID to analyze' },
      wallet_id: { type: 'string', description: 'Or wallet ID — returns all events for this wallet' },
      hours_before: { type: 'number', description: 'How many hours before the target to include in context (default 24)' },
    },
  },
  async execute(args, ctx) {
    const events: Array<{ timestamp: string; type: string; source: string; detail: string }> = [];

    // Fetch the target transaction
    let targetTx: any = null;
    if (args.tx_id) {
      try {
        const allTxs = await gw('/ops/transactions', {}, ctx) as any;
        const txs = allTxs?.transactions || allTxs || [];
        targetTx = txs.find((t: any) => t.id === args.tx_id || t.txHash === args.tx_id);
      } catch { /* */ }
    }

    // Collect events from wallet history
    let walletId = args.wallet_id as string | undefined;
    if (targetTx) walletId = walletId || targetTx.fromWalletId;

    if (walletId) {
      try {
        const wallet = await gw(`/api/v1/wallets/${encodeURIComponent(walletId)}`, {}, ctx) as any;
        if (wallet?.createdAt) {
          events.push({
            timestamp: wallet.createdAt,
            type: 'wallet.created',
            source: 'wallet-service',
            detail: `Wallet "${wallet.name}" created on ${wallet.chain}. Key mode: ${wallet.hdVersion ? 'HD' : 'HSM token'}.`,
          });
        }
        // Wallet transactions
        const txData = await gw(`/api/v1/wallets/${encodeURIComponent(walletId)}/transactions`, {}, ctx) as any;
        const walletTxs = txData?.transactions || txData || [];
        for (const t of walletTxs.slice(0, 50)) {
          events.push({
            timestamp: t.createdAt || t.timestamp,
            type: `transaction.${t.status}`,
            source: 'tx-store',
            detail: `${t.fromWalletId === walletId ? 'Sent' : 'Received'} ${t.amount} ${t.currency} ${t.fromWalletId === walletId ? 'to' : 'from'} ${t.fromWalletId === walletId ? t.toWalletId : t.fromWalletId}. Status: ${t.status}.${t.failureReason ? ` Failure: ${t.failureReason}` : ''}`,
          });
        }
      } catch { /* */ }
    }

    // Audit log entries
    try {
      const auditData = await gw('/ops/audit-log', {}, ctx) as any;
      const auditEvents = (auditData?.events || auditData || []);
      const relevant = auditEvents.filter((e: any) => {
        const blob = JSON.stringify(e).toLowerCase();
        return (args.tx_id && blob.includes(String(args.tx_id).toLowerCase())) ||
               (walletId && blob.includes(String(walletId).toLowerCase()));
      });
      for (const a of relevant.slice(0, 30)) {
        events.push({
          timestamp: a.timestamp,
          type: a.event || 'audit',
          source: 'audit-log',
          detail: `${a.detail || ''} (${a.actor || 'system'})`,
        });
      }
    } catch { /* */ }

    // Sort chronologically
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return {
      target: { tx_id: args.tx_id, wallet_id: walletId },
      transaction: targetTx,
      timeline: events,
      event_count: events.length,
      summary: `${events.length} events found. ${targetTx ? `Transaction status: ${targetTx.status}.` : ''}${targetTx?.failureReason ? ` Failure reason: ${targetTx.failureReason}.` : ''}`,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 7. EXPLAIN TRANSACTION — Plain English transaction summary
// ═══════════════════════════════════════════════════════════════════════════
export const EXPLAIN_TRANSACTION: ToolHandler = {
  name: 'explain_transaction',
  kind: 'read',
  description: `Produce a plain-English explanation of a specific transaction, including what happened, who was involved, whether it succeeded, and if relevant, why it was blocked/flagged. Used by the "Explain" button on transaction rows.`,
  parameters: {
    type: 'object',
    properties: {
      tx_id: { type: 'string', description: 'Transaction ID' },
    },
    required: ['tx_id'],
  },
  async execute(args, ctx) {
    const allTxs = await gw('/ops/transactions', {}, ctx) as any;
    const txs = allTxs?.transactions || allTxs || [];
    const tx = txs.find((t: any) => t.id === args.tx_id || t.txHash === args.tx_id);
    if (!tx) throw new Error(`Transaction ${args.tx_id} not found`);

    // Fetch wallet names
    let fromName = tx.fromWalletId;
    let toName = tx.toWalletId;
    try {
      if (tx.fromWalletId) {
        const w = await gw(`/api/v1/wallets/${encodeURIComponent(tx.fromWalletId)}`, {}, ctx) as any;
        fromName = w?.name || tx.fromWalletId;
      }
      if (tx.toWalletId) {
        const w = await gw(`/api/v1/wallets/${encodeURIComponent(tx.toWalletId)}`, {}, ctx) as any;
        toName = w?.name || tx.toWalletId;
      }
    } catch { /* */ }

    return {
      transaction: tx,
      from_wallet_name: fromName,
      to_wallet_name: toName,
      // The LLM will narrate this into plain English
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 8. RAG SEARCH — semantic search over indexed knowledge
// ═══════════════════════════════════════════════════════════════════════════
export function createRagSearchTool(store: KnowledgeStore): ToolHandler {
  return {
    name: 'search_knowledge',
    kind: 'read',
    description: `Semantic search across all indexed data: audit logs, transactions, wallets, vaults, policies. Use this for open-ended questions like "have we ever had issues like this before" or "find all events related to user X in the last week".`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        source: {
          type: 'string',
          enum: ['audit', 'transaction', 'wallet', 'vault', 'policy'],
          description: 'Optional: restrict to one source type',
        },
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
      required: ['query'],
    },
    async execute(args, _ctx) {
      const k = Math.min(Number(args.limit) || 10, 50);
      const results = await store.search(String(args.query), {
        k,
        source: args.source as any,
      });
      return {
        query: args.query,
        count: results.length,
        results: results.map(r => ({
          source: r.source,
          sourceId: r.sourceId,
          timestamp: r.timestamp,
          content: r.content,
          metadata: r.metadata,
          score: Math.round(r.score * 1000) / 1000,
        })),
      };
    },
  };
}

export const ADVANCED_TOOLS: ToolHandler[] = [
  DRAFT_POLICY,
  DRAFT_AUTOMATION,
  BATCH_CREATE_WALLETS,
  DRAFT_COMPLIANCE_RULE,
  DRAFT_ROLE_ASSIGNMENT,
  ANALYZE_INCIDENT,
  EXPLAIN_TRANSACTION,
];
