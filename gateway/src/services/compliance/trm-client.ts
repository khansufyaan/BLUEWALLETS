/**
 * TRM Labs API client — blockchain risk screening and transaction monitoring.
 *
 * Auth: Basic auth — Base64 encode `${apiKey}:` (key as username, empty password)
 * Docs: https://documentation.trmlabs.com/
 *
 * Provides:
 *   1. Batch address screening → risk score 0-100, entity categories, exposures
 *   2. Transaction monitoring → inputs, outputs, counterparty exposures
 */

import { ScreeningResult } from '../../types/compliance';
import { complianceStore } from '../../stores/compliance-store';
import { logger } from '../../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TRMRiskIndicator {
  category:            string;     // sanctions, darknet, mixer, ransomware, etc.
  categoryDescription: string;
  riskLevel:           string;     // low, medium, high, severe
}

export interface TRMExposure {
  category:   string;
  percentage: number;
  type:       'direct' | 'indirect';
}

export interface TRMEntity {
  name:     string;
  category: string;     // exchange, mixer, p2p, defi, darknet, unhosted
}

export interface TRMScreeningResult {
  address:          string;
  chain:            string;
  riskScore:        number;     // 0-100
  riskLevel:        string;     // low, medium, high, severe, critical
  entityName:       string | null;
  entityCategory:   string | null;
  riskIndicators:   TRMRiskIndicator[];
  entities:         TRMEntity[];
  directExposure:   TRMExposure[];
  indirectExposure: TRMExposure[];
  raw:              any;
}

export interface TRMTransactionResult {
  txHash:         string;
  chain:          string;
  riskScore:      number;
  riskIndicators: TRMRiskIndicator[];
  exposures:      TRMExposure[];
  counterparties: { address: string; entityName?: string; category?: string }[];
  raw:            any;
}

// ── Chain mapping ─────────────────────────────────────────────────────────────

const CHAIN_MAP: Record<string, string> = {
  ethereum:  'ethereum',
  bsc:       'bsc',
  polygon:   'polygon',
  arbitrum:  'arbitrum',
  avalanche: 'avalanche_c_chain',
};

// ── Client functions ──────────────────────────────────────────────────────────

function getAuthHeader(): string {
  const cfg = complianceStore.getConfig().trm;
  // TRM uses Basic auth: key as username, empty password
  return 'Basic ' + Buffer.from(`${cfg.apiKey}:`).toString('base64');
}

function getBaseUrl(): string {
  return complianceStore.getConfig().trm.baseUrl || 'https://api.trmlabs.com';
}

/**
 * Batch screen addresses for risk.
 * POST /public/v2/screening/addresses
 */
export async function batchScreenAddresses(
  addresses: { address: string; chain: string }[],
): Promise<TRMScreeningResult[]> {
  const cfg = complianceStore.getConfig().trm;
  if (!cfg.enabled || !cfg.apiKey) return [];

  try {
    const res = await fetch(`${getBaseUrl()}/public/v2/screening/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify(
        addresses.map(a => ({
          address: a.address,
          chain:   CHAIN_MAP[a.chain] || a.chain,
        }))
      ),
    });

    if (!res.ok) throw new Error(`TRM API returned ${res.status}`);

    const data = await res.json() as any[];

    return data.map((entry, i) => {
      const entities = (entry.entities || []) as TRMEntity[];
      const riskIndicators = (entry.riskIndicators || entry.addressRiskIndicators || []) as TRMRiskIndicator[];
      const riskScore = entry.riskScore ?? 0;

      const directExposure = (entry.exposures || [])
        .filter((e: any) => e.type === 'direct')
        .map((e: any) => ({ category: e.category, percentage: e.percentage || 0, type: 'direct' as const }));

      const indirectExposure = (entry.exposures || [])
        .filter((e: any) => e.type === 'indirect')
        .map((e: any) => ({ category: e.category, percentage: e.percentage || 0, type: 'indirect' as const }));

      return {
        address:        addresses[i]?.address || entry.address || '',
        chain:          addresses[i]?.chain || '',
        riskScore,
        riskLevel:      classifyRisk(riskScore),
        entityName:     entities[0]?.name || null,
        entityCategory: entities[0]?.category || riskIndicators[0]?.category || null,
        riskIndicators,
        entities,
        directExposure,
        indirectExposure,
        raw: entry,
      };
    });
  } catch (error) {
    logger.error('TRM batch screening failed', { error: error instanceof Error ? error.message : error });
    return [];
  }
}

/**
 * Screen a single address (convenience wrapper).
 */
export async function screenWithTrm(
  address: string,
  chain: string,
): Promise<ScreeningResult | null> {
  const cfg = complianceStore.getConfig().trm;
  if (!cfg.enabled || !cfg.apiKey) return null;

  const results = await batchScreenAddresses([{ address, chain }]);
  if (results.length === 0) {
    return {
      provider:   'trm',
      address,
      chain,
      riskScore:  null,
      riskLevel:  'unknown',
      sanctioned: false,
      categories: ['provider-error'],
      alerts:     ['TRM screening returned no results'],
      raw:        null,
      timestamp:  new Date().toISOString(),
    };
  }

  const r = results[0];
  const sanctioned = r.riskIndicators.some(ri =>
    ri.category?.toLowerCase().includes('sanctions')
  );

  return {
    provider:   'trm',
    address,
    chain,
    riskScore:  r.riskScore,
    riskLevel:  r.riskLevel,
    sanctioned,
    categories: [...new Set(r.riskIndicators.map(ri => ri.category))],
    alerts:     r.riskIndicators.map(ri => ri.categoryDescription || ri.category),
    raw:        r.raw,
    timestamp:  new Date().toISOString(),
  };
}

/**
 * Monitor a transaction by hash.
 * POST /public/v2/transaction-monitoring/transactions
 */
export async function monitorTransaction(
  txHash: string,
  chain: string,
  asset: string = 'ETH',
): Promise<TRMTransactionResult | null> {
  const cfg = complianceStore.getConfig().trm;
  if (!cfg.enabled || !cfg.apiKey) return null;

  try {
    const res = await fetch(`${getBaseUrl()}/public/v2/transaction-monitoring/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify({
        txHash,
        chain: CHAIN_MAP[chain] || chain,
        asset,
      }),
    });

    if (!res.ok) throw new Error(`TRM API returned ${res.status}`);
    const data = await res.json() as any;

    return {
      txHash,
      chain,
      riskScore:      data.riskScore ?? 0,
      riskIndicators: data.riskIndicators || [],
      exposures:      (data.exposures || []).map((e: any) => ({
        category:   e.category,
        percentage: e.percentage || 0,
        type:       e.type || 'direct',
      })),
      counterparties: (data.counterparties || []).map((c: any) => ({
        address:    c.address,
        entityName: c.entityName,
        category:   c.category,
      })),
      raw: data,
    };
  } catch (error) {
    logger.error('TRM transaction monitoring failed', { error: error instanceof Error ? error.message : error, txHash });
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifyRisk(score: number): string {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
