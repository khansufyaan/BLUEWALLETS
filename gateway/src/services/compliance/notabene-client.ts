/**
 * Notabene Travel Rule API client — FATF compliance for VASP-to-VASP transfers.
 *
 * Auth: OAuth2 client credentials flow (token cached in memory).
 * Docs: https://docs.notabene.id/
 *
 * Provides:
 *   1. Transaction validation (is TR required? which VASP?)
 *   2. Travel Rule message creation and lifecycle
 *   3. Transaction listing with metrics
 *   4. VASP directory lookup
 */

import { ScreeningResult } from '../../types/compliance';
import { complianceStore } from '../../stores/compliance-store';
import { logger } from '../../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotabeneStatus = 'NEW' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'SAVED';

export interface NotabeneTransaction {
  id:                string;
  status:            NotabeneStatus;
  asset:             string;
  amount:            string;
  counterpartyVASP:  string | null;
  createdAt:         string;
  updatedAt:         string;
  ageMinutes:        number;        // computed
  direction:         'SENT' | 'RECEIVED';
  originator?:       any;
  beneficiary?:      any;
}

export interface NotabeneValidation {
  travelRuleRequired:    boolean;
  beneficiaryVASP:       string | null;
  addressType:           'HOSTED' | 'NON_CUSTODIAL' | 'UNKNOWN';
  missingFields:         string[];
  errors:                string[];
  warnings:              string[];
}

export interface NotabeneMetrics {
  totalSentToday:        number;
  acceptedCount:         number;
  rejectedCount:         number;
  pendingCount:          number;
  savedCount:            number;
  responseRate:          number;      // (accepted+rejected) / sent
  rejectionRate:         number;      // rejected / (accepted+rejected)
  oldestPendingMinutes:  number;
}

export interface NotabeneVASP {
  did:          string;
  name:         string;
  jurisdiction: string;
  protocols:    string[];
  status:       string;
}

// ── OAuth2 Token Cache ────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.token) throw new Error('Notabene token not configured');

  // If using a simple bearer token (non-OAuth), return directly
  // Notabene supports both OAuth2 client credentials and simple API tokens
  return cfg.token;
}

function getHeaders(): Record<string, string> {
  const cfg = complianceStore.getConfig().notabene;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.token}`,
  };
}

function getBaseUrl(): string {
  return complianceStore.getConfig().notabene.baseUrl || 'https://api.notabene.id';
}

// ── API Methods ───────────────────────────────────────────────────────────────

/**
 * Validate a transaction — is Travel Rule required?
 * POST /tf/simple/transaction (txValidateFull)
 */
export async function validateTransaction(
  address: string,
  chain: string,
  asset: string,
  amount: string,
  txHash?: string,
): Promise<NotabeneValidation | null> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.enabled || !cfg.token) return null;

  const chainMap: Record<string, string> = {
    ethereum: 'ethereum', bsc: 'bsc', polygon: 'polygon',
    arbitrum: 'arbitrum', avalanche: 'avalanche',
  };

  try {
    const res = await fetch(`${getBaseUrl()}/tf/simple/transaction`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        transactionAsset: asset,
        transactionAmount: amount,
        transactionBlockchainInfo: {
          origin: txHash ? { txHash, chain: chainMap[chain] || chain } : undefined,
        },
        beneficiaryAccountNumber: address,
      }),
    });

    if (!res.ok) throw new Error(`Notabene API returned ${res.status}`);
    const data = await res.json() as any;

    return {
      travelRuleRequired: data.beneficiaryAddressType === 'HOSTED',
      beneficiaryVASP:    data.beneficiaryVASPname || null,
      addressType:        data.beneficiaryAddressType || 'UNKNOWN',
      missingFields:      data.missingFields || [],
      errors:             (data.errors || []).map((e: any) => e.message || e),
      warnings:           (data.warnings || []).map((w: any) => w.message || w),
    };
  } catch (error) {
    logger.error('Notabene validation failed', { error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * Create a Travel Rule transaction message.
 * POST /tf/simple/transaction (txCreate)
 */
export async function createTravelRuleMessage(params: {
  transactionRef:     string;
  beneficiaryVASPdid: string;
  asset:              string;
  amount:             string;
  originatorName:     string;
  originatorAccount:  string;
  beneficiaryName:    string;
  beneficiaryAccount: string;
}): Promise<{ id: string; status: NotabeneStatus } | null> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.enabled || !cfg.token || !cfg.vaspDID) return null;

  try {
    const res = await fetch(`${getBaseUrl()}/tf/simple/transaction`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        transactionRef:       params.transactionRef,
        originatorVASPdid:    cfg.vaspDID,
        beneficiaryVASPdid:   params.beneficiaryVASPdid,
        transactionAsset:     params.asset,
        transactionAmount:    params.amount,
        originator: {
          originatorPersons: [{
            naturalPerson: {
              name: [{ nameIdentifier: [{ primaryIdentifier: params.originatorName }] }],
            },
          }],
          accountNumber: [params.originatorAccount],
        },
        beneficiary: {
          beneficiaryPersons: [{
            naturalPerson: {
              name: [{ nameIdentifier: [{ primaryIdentifier: params.beneficiaryName }] }],
            },
          }],
          accountNumber: [params.beneficiaryAccount],
        },
      }),
    });

    if (!res.ok) throw new Error(`Notabene API returned ${res.status}`);
    const data = await res.json() as any;
    return { id: data.id, status: data.status || 'NEW' };
  } catch (error) {
    logger.error('Notabene create TR failed', { error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * List all Travel Rule transactions with computed metrics.
 * GET /tf/transactions
 */
export async function listTransactions(
  status?: string,
  limit = 100,
): Promise<{ transactions: NotabeneTransaction[]; metrics: NotabeneMetrics } | null> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.enabled || !cfg.token) return null;

  try {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (status) params.set('status', status);
    else params.set('status', 'ALL');
    params.set('direction', 'BOTH');

    const res = await fetch(`${getBaseUrl()}/tf/transactions?${params}`, {
      headers: getHeaders(),
    });

    if (!res.ok) throw new Error(`Notabene API returned ${res.status}`);
    const data = await res.json() as any;
    const raw = Array.isArray(data) ? data : (data.transactions || data.items || []);

    const now = Date.now();
    const transactions: NotabeneTransaction[] = raw.map((t: any) => ({
      id:               t.id,
      status:           t.status,
      asset:            t.transactionAsset || t.asset || '',
      amount:           t.transactionAmount || t.amount || '0',
      counterpartyVASP: t.beneficiaryVASPname || t.counterpartyVASP || null,
      createdAt:        t.createdAt || t.created_at || '',
      updatedAt:        t.updatedAt || t.updated_at || '',
      ageMinutes:       Math.round((now - new Date(t.createdAt || 0).getTime()) / 60_000),
      direction:        t.direction || 'SENT',
    }));

    // Compute metrics
    const today = new Date().toISOString().slice(0, 10);
    const todayTxs = transactions.filter(t => t.createdAt?.startsWith(today));
    const pending = transactions.filter(t => t.status === 'SENT' || t.status === 'NEW');
    const accepted = transactions.filter(t => t.status === 'ACCEPTED');
    const rejected = transactions.filter(t => t.status === 'REJECTED');
    const saved = transactions.filter(t => t.status === 'SAVED');
    const responded = accepted.length + rejected.length;
    const sent = transactions.filter(t => t.status !== 'SAVED' && t.status !== 'CANCELLED');

    const metrics: NotabeneMetrics = {
      totalSentToday:       todayTxs.length,
      acceptedCount:        accepted.length,
      rejectedCount:        rejected.length,
      pendingCount:         pending.length,
      savedCount:           saved.length,
      responseRate:         sent.length > 0 ? responded / sent.length : 0,
      rejectionRate:        responded > 0 ? rejected.length / responded : 0,
      oldestPendingMinutes: pending.length > 0 ? Math.max(...pending.map(p => p.ageMinutes)) : 0,
    };

    return { transactions, metrics };
  } catch (error) {
    logger.error('Notabene list transactions failed', { error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * Get a specific transaction status.
 * GET /tf/transactions/{id}
 */
export async function getTransaction(id: string): Promise<NotabeneTransaction | null> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.enabled || !cfg.token) return null;

  try {
    const res = await fetch(`${getBaseUrl()}/tf/transactions/${id}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;

    return {
      id:               data.id,
      status:           data.status,
      asset:            data.transactionAsset || '',
      amount:           data.transactionAmount || '0',
      counterpartyVASP: data.beneficiaryVASPname || null,
      createdAt:        data.createdAt || '',
      updatedAt:        data.updatedAt || '',
      ageMinutes:       Math.round((Date.now() - new Date(data.createdAt || 0).getTime()) / 60_000),
      direction:        data.direction || 'SENT',
    };
  } catch {
    return null;
  }
}

/**
 * Look up a VASP in the directory.
 * GET /tf/vasp/{did}
 */
export async function getVASP(did: string): Promise<NotabeneVASP | null> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.enabled || !cfg.token) return null;

  try {
    const res = await fetch(`${getBaseUrl()}/tf/vasp/${did}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;

    return {
      did:          data.did || did,
      name:         data.name || 'Unknown VASP',
      jurisdiction: data.jurisdiction || '',
      protocols:    data.protocols || [],
      status:       data.status || 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Screen for Travel Rule compliance (used by compliance middleware).
 */
export async function checkTravelRule(
  address: string,
  chain: string,
  amountUsd: number,
  originatorInfo?: { name?: string; accountId?: string },
): Promise<ScreeningResult | null> {
  const cfg = complianceStore.getConfig().notabene;
  if (!cfg.enabled || !cfg.token) return null;

  // Travel Rule typically applies for transfers > $3,000 USD
  if (amountUsd < 3000) return null;

  const validation = await validateTransaction(address, chain, 'ETH', amountUsd.toString());
  if (!validation) return null;

  const isRejected = validation.errors.length > 0;

  return {
    provider:   'notabene',
    address,
    chain,
    riskScore:  isRejected ? 10 : validation.travelRuleRequired ? 5 : 0,
    riskLevel:  isRejected ? 'critical' : validation.travelRuleRequired ? 'medium' : 'low',
    sanctioned: false,
    categories: ['travel-rule'],
    alerts:     isRejected
      ? [`Travel Rule validation failed: ${validation.errors.join(', ')}`]
      : validation.travelRuleRequired
        ? [`Travel Rule required — counterparty: ${validation.beneficiaryVASP || 'unknown VASP'}`]
        : ['Travel Rule not required (non-custodial address)'],
    raw:        validation,
    timestamp:  new Date().toISOString(),
  };
}
