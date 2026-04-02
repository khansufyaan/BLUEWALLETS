/**
 * Health & Connectivity Routes — comprehensive system health view.
 *
 * Checks:
 *   1. Signer connection (internal network to secure zone)
 *   2. Internet connectivity (can we reach external endpoints?)
 *   3. RPC node health per chain (block height, latency)
 *   4. Compliance vendor API health (TRM, Chainalysis, Notabene)
 */

import { Router, Request, Response } from 'express';
import { SignerClient } from '../services/signer-client';
import { getProvider, getChainConfig } from '../services/evm/evm-provider';
import { getEnabledChains, config } from '../config';
import { complianceStore } from '../stores/compliance-store';
import { logger } from '../utils/logger';

export function createOpsHealthRoutes(signerClient: SignerClient): Router {
  const router = Router();

  /** GET /ops/health/full — complete health check across all systems */
  router.get('/full', async (_req: Request, res: Response) => {
    const startTime = Date.now();

    // Run all checks in parallel with 4s timeout each
    const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), 4000))]);

    const [signerHealth, internetHealth, rpcHealth, vendorHealth] = await Promise.all([
      withTimeout(checkSigner(signerClient), { status: 'error' as const, url: '', latencyMs: 0, error: 'Timeout' }),
      withTimeout(checkInternet(), { status: 'disconnected' as const, targets: [], note: 'Timeout' }),
      withTimeout(checkRpcNodes(), []),
      withTimeout(checkVendors(), {} as any),
    ]);

    const totalLatency = Date.now() - startTime;
    const allHealthy = signerHealth.status === 'connected' &&
                       internetHealth.status === 'connected' &&
                       rpcHealth.every(r => r.status === 'connected') &&
                       Object.values(vendorHealth).every(v => v === 'connected' || v === 'not_configured');

    res.json({
      overall:   allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs: totalLatency,
      signer:    signerHealth,
      internet:  internetHealth,
      rpcNodes:  rpcHealth,
      vendors:   vendorHealth,
    });
  });

  return router;
}

// ── Check functions ─────────────────────────────────────────────────────────

async function checkSigner(signerClient: SignerClient) {
  const start = Date.now();
  try {
    const ok = await signerClient.healthCheck();
    const latency = Date.now() - start;
    if (ok) {
      // Also try to list wallets to verify full connectivity
      let walletCount = 0;
      try {
        const wallets = await signerClient.listWallets();
        walletCount = wallets.length;
      } catch {}

      return {
        status:     'connected' as const,
        url:        config.signerUrl,
        latencyMs:  latency,
        walletCount,
        authMethod: config.internalKey ? 'shared-key' : 'none',
        note:       'Internal network connection to secure zone (no internet)',
      };
    }
    return { status: 'error' as const, url: config.signerUrl, latencyMs: latency, error: 'Health check failed' };
  } catch (error) {
    return {
      status:    'error' as const,
      url:       config.signerUrl,
      latencyMs: Date.now() - start,
      error:     error instanceof Error ? error.message : 'Connection refused',
    };
  }
}

async function checkInternet() {
  const targets = [
    { name: 'Cloudflare DNS',   url: 'https://1.1.1.1/cdn-cgi/trace' },
    { name: 'Google',           url: 'https://www.google.com/generate_204' },
    { name: 'Alchemy',          url: 'https://eth-mainnet.g.alchemy.com' },
  ];

  const results = await Promise.all(targets.map(async (t) => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(t.url, { signal: controller.signal, method: 'HEAD' });
      clearTimeout(timeout);
      return { name: t.name, status: 'reachable' as const, latencyMs: Date.now() - start, httpStatus: res.status };
    } catch (error) {
      return { name: t.name, status: 'unreachable' as const, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : 'timeout' };
    }
  }));

  const anyReachable = results.some(r => r.status === 'reachable');

  return {
    status:  anyReachable ? 'connected' as const : 'disconnected' as const,
    targets: results,
    note:    'Outbound internet connectivity from DMZ',
  };
}

async function checkRpcNodes() {
  const enabled = getEnabledChains();
  return Promise.all(
    Object.entries(enabled).map(async ([key, cfg]) => {
      const start = Date.now();
      try {
        const provider = getProvider(key);
        const blockNumber = await provider.getBlockNumber();
        const latency = Date.now() - start;
        return {
          chain:       key,
          name:        cfg.name,
          chainId:     cfg.chainId,
          status:      'connected' as const,
          blockNumber,
          latencyMs:   latency,
          rpcUrl:      cfg.rpcUrl.replace(/\/[a-zA-Z0-9_-]{20,}/, '/***'),
        };
      } catch (error) {
        return {
          chain:     key,
          name:      cfg.name,
          chainId:   cfg.chainId,
          status:    'error' as const,
          latencyMs: Date.now() - start,
          error:     error instanceof Error ? error.message : 'Connection failed',
          rpcUrl:    cfg.rpcUrl.replace(/\/[a-zA-Z0-9_-]{20,}/, '/***'),
        };
      }
    })
  );
}

async function checkVendors() {
  const cfg = complianceStore.getConfig();
  const results: Record<string, string> = {
    trm:         'not_configured',
    chainalysis: 'not_configured',
    notabene:    'not_configured',
  };

  if (cfg.trm.enabled) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${cfg.trm.baseUrl}/public/v2/screening/addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${cfg.trm.apiKey}:`).toString('base64'),
        },
        body: JSON.stringify([{ address: '0x0000000000000000000000000000000000000000', chain: 'ethereum' }]),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      results.trm = res.ok || res.status === 400 ? 'connected' : 'error'; // 400 = bad request but API is reachable
    } catch { results.trm = 'error'; }
  }

  if (cfg.chainalysis.enabled) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${cfg.chainalysis.baseUrl}/api/kyt/v2/users/blue-waas`, {
        headers: { 'Token': cfg.chainalysis.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      results.chainalysis = res.ok || res.status === 404 ? 'connected' : 'error';
    } catch { results.chainalysis = 'error'; }
  }

  if (cfg.notabene.enabled) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${cfg.notabene.baseUrl}/tf/transactions?limit=1`, {
        headers: { 'Authorization': `Bearer ${cfg.notabene.token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      results.notabene = res.ok || res.status === 401 ? 'connected' : 'error'; // 401 = wrong key but reachable
    } catch { results.notabene = 'error'; }
  }

  return results;
}
