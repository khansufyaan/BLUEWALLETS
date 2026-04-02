/**
 * Chainalysis API client — KYT (Know Your Transaction) + Market Intel.
 *
 * Auth: Token header — `Token: ${apiKey}`
 * Docs: https://docs.chainalysis.com/api/kyt/
 *
 * Provides:
 *   1. KYT: Address screening, entity identification, sanctions flags
 *   2. Market Intel: Exchange net flows, whale activity
 */

import { ScreeningResult } from '../../types/compliance';
import { complianceStore } from '../../stores/compliance-store';
import { logger } from '../../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChainalysisCluster {
  name:           string;
  category:       string;     // exchange, mixer, p2p, darknet, defi, unhosted
  riskRating:     string;     // lowRisk, mediumRisk, highRisk, severeRisk
}

export interface ChainalysisSanctionFlag {
  sanctioned:        boolean;
  sanctionsPrograms: string[];  // e.g. ['OFAC SDN']
  entityName:        string | null;
}

export interface ChainalysisExchangeFlow {
  exchange:     string;
  netFlow7dUSD: number;
  direction:    'inflow' | 'outflow';
}

export interface ChainalysisWhaleActivity {
  btcHeld:     number;
  btc7dChange: number;
  signal:      'accumulating' | 'distributing';
}

export interface ChainalysisMarketData {
  exchangeFlows: ChainalysisExchangeFlow[];
  whaleActivity: ChainalysisWhaleActivity;
}

// ── Chain mapping ─────────────────────────────────────────────────────────────

const CHAIN_MAP: Record<string, string> = {
  ethereum:  'ETH',
  bsc:       'BNB',
  polygon:   'MATIC',
  arbitrum:  'ETH',
  avalanche: 'AVAX',
};

// ── KYT Client ────────────────────────────────────────────────────────────────

function getKytHeaders(): Record<string, string> {
  const cfg = complianceStore.getConfig().chainalysis;
  return {
    'Content-Type': 'application/json',
    'Token': cfg.apiKey,
  };
}

function getKytUrl(): string {
  return complianceStore.getConfig().chainalysis.baseUrl || 'https://api.chainalysis.com';
}

/**
 * Register and screen an address via KYT.
 */
export async function screenWithChainalysis(
  address: string,
  chain: string,
): Promise<ScreeningResult | null> {
  const cfg = complianceStore.getConfig().chainalysis;
  if (!cfg.enabled || !cfg.apiKey) return null;

  const asset = CHAIN_MAP[chain] || 'ETH';

  try {
    // Register the withdrawal address
    await fetch(`${getKytUrl()}/api/kyt/v2/users/blue-waas/withdrawaladdresses`, {
      method: 'POST',
      headers: getKytHeaders(),
      body: JSON.stringify({ network: asset, asset, address }),
    }).catch(() => {}); // Don't fail on registration error

    // Get address identifications (entity + sanctions)
    const idRes = await fetch(
      `${getKytUrl()}/api/kyt/v2/addresses/${address}`,
      { headers: getKytHeaders() },
    );

    let entityName: string | null = null;
    let entityCategory: string | null = null;
    let riskScore = 0;
    let sanctioned = false;
    let sanctionsPrograms: string[] = [];
    let categories: string[] = [];
    let rawData: any = {};

    if (idRes.ok) {
      const data = await idRes.json() as any;
      rawData = data;
      entityName = data.cluster?.name || data.name || null;
      entityCategory = data.cluster?.category || data.category || null;

      // Map Chainalysis risk rating to numeric score
      const ratingMap: Record<string, number> = {
        lowRisk: 2, mediumRisk: 5, highRisk: 7, severeRisk: 9,
      };
      riskScore = ratingMap[data.risk?.rating || data.riskRating || ''] || 0;

      // Check identifications for sanctions
      const exposures = data.exposures || [];
      categories = exposures.map((e: any) => e.category).filter(Boolean);
      sanctioned = categories.includes('sanctions') || (data.cluster?.category === 'sanctions');
    }

    // Also check the identifications endpoint for OFAC
    try {
      const sanctionsRes = await fetch(
        `${getKytUrl()}/api/kyt/v2/addresses/${address}/identifications`,
        { headers: getKytHeaders() },
      );
      if (sanctionsRes.ok) {
        const sanctionsData = await sanctionsRes.json() as any;
        if (sanctionsData.sanctionsPrograms && sanctionsData.sanctionsPrograms.length > 0) {
          sanctioned = true;
          sanctionsPrograms = sanctionsData.sanctionsPrograms;
        }
        if (sanctionsData.name) entityName = sanctionsData.name;
      }
    } catch {}

    const riskLevelMap: Record<string, string> = {
      lowRisk: 'low', mediumRisk: 'medium', highRisk: 'high', severeRisk: 'critical',
    };

    const result: ScreeningResult = {
      provider:   'chainalysis',
      address,
      chain,
      riskScore,
      riskLevel:  sanctioned ? 'critical' : (riskScore >= 8 ? 'critical' : riskScore >= 6 ? 'high' : riskScore >= 4 ? 'medium' : 'low'),
      sanctioned,
      categories: [...new Set(categories)],
      alerts:     sanctioned
        ? [`OFAC sanctions hit: ${sanctionsPrograms.join(', ') || 'sanctioned entity'}`]
        : [],
      raw:        { ...rawData, sanctionsPrograms },
      timestamp:  new Date().toISOString(),
    };

    logger.info('Chainalysis screening complete', {
      address, chain, riskScore, sanctioned, entityName,
    });

    return result;
  } catch (error) {
    logger.error('Chainalysis screening failed', {
      error: error instanceof Error ? error.message : error,
      address, chain,
    });
    return {
      provider:   'chainalysis',
      address,
      chain,
      riskScore:  null,
      riskLevel:  'unknown',
      sanctioned: false,
      categories: ['provider-error'],
      alerts:     [`API error: ${error instanceof Error ? error.message : 'Unknown'}`],
      raw:        null,
      timestamp:  new Date().toISOString(),
    };
  }
}

/**
 * Get entity/cluster info for an address.
 */
export async function getEntityInfo(address: string): Promise<{
  entityName: string | null;
  entityCategory: string | null;
  sanctioned: boolean;
  sanctionsPrograms: string[];
} | null> {
  const cfg = complianceStore.getConfig().chainalysis;
  if (!cfg.enabled || !cfg.apiKey) return null;

  try {
    const res = await fetch(
      `${getKytUrl()}/api/kyt/v2/addresses/${address}`,
      { headers: getKytHeaders() },
    );
    if (!res.ok) return null;

    const data = await res.json() as any;

    // Check sanctions
    let sanctioned = false;
    let sanctionsPrograms: string[] = [];
    try {
      const sRes = await fetch(
        `${getKytUrl()}/api/kyt/v2/addresses/${address}/identifications`,
        { headers: getKytHeaders() },
      );
      if (sRes.ok) {
        const sData = await sRes.json() as any;
        if (sData.sanctionsPrograms?.length > 0) {
          sanctioned = true;
          sanctionsPrograms = sData.sanctionsPrograms;
        }
      }
    } catch {}

    return {
      entityName:     data.cluster?.name || data.name || null,
      entityCategory: data.cluster?.category || data.category || null,
      sanctioned,
      sanctionsPrograms,
    };
  } catch {
    return null;
  }
}

// ── Market Intel Client ───────────────────────────────────────────────────────

const MARKET_URL = 'https://api.markets.chainalysis.com';

/**
 * Get exchange net flows (7d) and whale activity.
 * Source: Chainalysis Market Intel API only.
 */
export async function getMarketData(): Promise<ChainalysisMarketData | null> {
  const cfg = complianceStore.getConfig().chainalysis;
  if (!cfg.enabled || !cfg.apiKey) return null;

  try {
    // Exchange net flows
    const flowsRes = await fetch(
      `${MARKET_URL}/api/v2/market/metrics?assets=BTC,ETH,USDT,USDC&metrics=exchange-net-flows&timeframe=7d`,
      { headers: { 'Token': cfg.apiKey } },
    );

    let exchangeFlows: ChainalysisExchangeFlow[] = [];
    if (flowsRes.ok) {
      const flowsData = await flowsRes.json() as any;
      // Parse exchange flows from response
      const flows = flowsData.data || flowsData || [];
      if (Array.isArray(flows)) {
        exchangeFlows = flows.slice(0, 10).map((f: any) => ({
          exchange:     f.exchange || f.name || 'Unknown',
          netFlow7dUSD: f.netFlowUSD || f.value || 0,
          direction:    (f.netFlowUSD || f.value || 0) >= 0 ? 'inflow' as const : 'outflow' as const,
        }));
      }
    }

    // Whale activity — supply distribution by entity
    const whaleRes = await fetch(
      `${MARKET_URL}/api/v2/market/metrics?assets=BTC&metrics=supply-distribution-by-entity&timeframe=7d`,
      { headers: { 'Token': cfg.apiKey } },
    );

    let whaleActivity: ChainalysisWhaleActivity = {
      btcHeld: 0, btc7dChange: 0, signal: 'accumulating',
    };
    if (whaleRes.ok) {
      const whaleData = await whaleRes.json() as any;
      const whale = whaleData.data || whaleData || {};
      const btcHeld = whale.whaleHoldings || whale.btcHeld || 0;
      const btc7dChange = whale.change7d || whale.btc7dChange || 0;
      whaleActivity = {
        btcHeld,
        btc7dChange,
        signal: btc7dChange >= 0 ? 'accumulating' : 'distributing',
      };
    }

    return { exchangeFlows, whaleActivity };
  } catch (error) {
    logger.error('Chainalysis market data failed', {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
