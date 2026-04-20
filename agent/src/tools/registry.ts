/**
 * Tool Registry — defines the tools the agent can call.
 *
 * READ tools execute directly.
 * WRITE tools require admin approval before execution.
 */

import { ToolDefinition } from '../services/llm-client';
import { config } from '../config';
import { logger } from '../logger';

export type ToolKind = 'read' | 'write';

export interface ToolHandler {
  name: string;
  kind: ToolKind;
  description: string;
  parameters: Record<string, unknown>;
  /** Execute the tool. For write tools, this is only called AFTER approval. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  /** The admin session token — forwarded to Gateway/Driver for authz. */
  userToken?: string;
  /** Approval ticket ID — set for write tools that have been approved. */
  approvalId?: string;
}

// ── Helper: call Gateway ops API ─────────────────────────────────────────────
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

// ── Read-only tools ──────────────────────────────────────────────────────────

const LIST_WALLETS: ToolHandler = {
  name: 'list_wallets',
  kind: 'read',
  description: 'List all wallets in the system. Supports filtering by chain or vault.',
  parameters: {
    type: 'object',
    properties: {
      chain: { type: 'string', description: 'Filter by chain: ethereum, bitcoin, solana, bsc, polygon, arbitrum, avalanche, tron, litecoin' },
      vault_id: { type: 'string', description: 'Filter by vault ID' },
    },
  },
  async execute(args, ctx) {
    const data = await gw('/ops/wallets', {}, ctx) as { wallets?: unknown[] } | unknown[];
    const wallets = (Array.isArray(data) ? data : data.wallets) || [];
    let filtered: any[] = wallets as any[];
    if (args.chain) filtered = filtered.filter(w => (w.chain || '').toLowerCase() === String(args.chain).toLowerCase());
    if (args.vault_id) filtered = filtered.filter(w => w.vaultId === args.vault_id);
    return { count: filtered.length, wallets: filtered.slice(0, 50) };
  },
};

const GET_WALLET: ToolHandler = {
  name: 'get_wallet',
  kind: 'read',
  description: 'Get full details for a specific wallet by ID, including balance, chain, address, and policies.',
  parameters: {
    type: 'object',
    properties: { wallet_id: { type: 'string', description: 'Wallet ID (UUID)' } },
    required: ['wallet_id'],
  },
  async execute(args, ctx) {
    return await gw(`/api/v1/wallets/${encodeURIComponent(String(args.wallet_id))}`, {}, ctx);
  },
};

const LIST_VAULTS: ToolHandler = {
  name: 'list_vaults',
  kind: 'read',
  description: 'List all vaults. Vaults organize wallets for a specific purpose (e.g., Treasury, Cold Storage).',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    return await gw('/api/v1/vaults', {}, ctx);
  },
};

const GET_TRANSACTIONS: ToolHandler = {
  name: 'get_transactions',
  kind: 'read',
  description: 'List recent transactions system-wide or for a specific wallet. Returns the most recent transactions sorted by date.',
  parameters: {
    type: 'object',
    properties: {
      wallet_id: { type: 'string', description: 'Optional wallet ID to filter by' },
      limit: { type: 'number', description: 'Max results (1-100, default 20)' },
    },
  },
  async execute(args, ctx) {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    if (args.wallet_id) {
      return await gw(`/api/v1/wallets/${encodeURIComponent(String(args.wallet_id))}/transactions`, {}, ctx);
    }
    const data = await gw('/ops/transactions', {}, ctx) as any;
    const txs = (data?.transactions || data || []).slice(0, limit);
    return { count: txs.length, transactions: txs };
  },
};

const GET_HSM_STATUS: ToolHandler = {
  name: 'get_hsm_status',
  kind: 'read',
  description: 'Get the current status of the HSM: connected/disconnected, firmware version, slot utilization, recent errors.',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    return await gw('/ops/health', {}, ctx);
  },
};

const GET_CHAIN_STATUS: ToolHandler = {
  name: 'get_chain_status',
  kind: 'read',
  description: 'Get the status of all configured blockchain connections: block height, gas prices, RPC health.',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    return await gw('/ops/chains', {}, ctx);
  },
};

const GET_DEPOSITS: ToolHandler = {
  name: 'get_deposits',
  kind: 'read',
  description: 'List recent incoming deposits detected on monitored wallets.',
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max results (1-100, default 20)' } },
  },
  async execute(args, ctx) {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    const data = await gw('/ops/deposits', {}, ctx) as any;
    const deposits = (data?.deposits || data || []).slice(0, limit);
    return { count: deposits.length, deposits };
  },
};

const SEARCH_AUDIT_LOG: ToolHandler = {
  name: 'search_audit_log',
  kind: 'read',
  description: 'Search the audit log for events matching a query string. Returns recent audit entries with actor, event type, and details.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term (e.g., "failed", "policy violation", username)' },
      limit: { type: 'number', description: 'Max results (1-100, default 30)' },
    },
  },
  async execute(args, ctx) {
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
    const q = String(args.query || '').toLowerCase();
    try {
      const data = await gw('/ops/audit-log', {}, ctx) as any;
      const events = data?.events || data || [];
      const filtered = q
        ? events.filter((e: any) =>
            JSON.stringify(e).toLowerCase().includes(q))
        : events;
      return { count: filtered.length, events: filtered.slice(0, limit) };
    } catch (err) {
      return { error: 'Audit log unavailable', message: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ── Write tools (require approval) ───────────────────────────────────────────

const CREATE_WALLET: ToolHandler = {
  name: 'create_wallet',
  kind: 'write',
  description: 'Create a new wallet in a vault. REQUIRES ADMIN APPROVAL. Specify chain (ethereum, bitcoin, etc.), vault_id, and name.',
  parameters: {
    type: 'object',
    properties: {
      chain: { type: 'string', description: 'Blockchain: ethereum, bitcoin, solana, bsc, polygon, arbitrum, avalanche, tron, litecoin' },
      vault_id: { type: 'string', description: 'ID of the vault to create the wallet in' },
      name: { type: 'string', description: 'Human-readable name for the wallet' },
    },
    required: ['chain', 'vault_id', 'name'],
  },
  async execute(args, ctx) {
    return await gw(`/api/v1/vaults/${encodeURIComponent(String(args.vault_id))}/wallets`, {
      method: 'POST',
      body: JSON.stringify({
        chain: args.chain,
        name: args.name,
        initialBalance: '0',
      }),
    }, ctx);
  },
};

const CREATE_VAULT: ToolHandler = {
  name: 'create_vault',
  kind: 'write',
  description: 'Create a new vault for organizing wallets. REQUIRES ADMIN APPROVAL.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Vault name (e.g., "Treasury", "Cold Storage")' },
      description: { type: 'string', description: 'Optional description' },
    },
    required: ['name'],
  },
  async execute(args, ctx) {
    return await gw('/api/v1/vaults', {
      method: 'POST',
      body: JSON.stringify({ name: args.name, description: args.description }),
    }, ctx);
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const ALL_TOOLS: ToolHandler[] = [
  LIST_WALLETS,
  GET_WALLET,
  LIST_VAULTS,
  GET_TRANSACTIONS,
  GET_HSM_STATUS,
  GET_CHAIN_STATUS,
  GET_DEPOSITS,
  SEARCH_AUDIT_LOG,
  CREATE_WALLET,
  CREATE_VAULT,
];

export function getAvailableTools(): ToolHandler[] {
  return config.allowWriteTools ? ALL_TOOLS : ALL_TOOLS.filter(t => t.kind === 'read');
}

export function toOpenAIDefinitions(tools: ToolHandler[]): ToolDefinition[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function findTool(name: string): ToolHandler | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}
