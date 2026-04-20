/**
 * Blue Gateway — Blockchain connectivity tier.
 *
 * Two ports:
 *   :3100 (PORT)     — Bank-facing API (transfers, balances)
 *   :3400 (OPS_PORT) — Ops dashboard (monitoring, blockchain state)
 *
 * Communicates with blue-signer (:3200) over internal network.
 */

import path from 'path';
import fs from 'fs';
import https from 'https';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config, getEnabledChains } from './config';
import { SignerClient } from './services/signer-client';
import { EvmBalanceSync } from './services/evm/evm-balance-sync';
import { EvmDepositMonitor } from './services/evm/evm-deposit-monitor';
import { createTransferRoutes } from './routes/transfers';
import { createBalanceRoutes } from './routes/balances';
import { createOpsRoutes } from './routes/ops';
import { createProxyWalletRoutes } from './routes/proxy-wallets';
import { createProxyVaultRoutes } from './routes/proxy-vaults';
import { createProxyPolicyRoutes } from './routes/proxy-policies';
import { createProxyRbacRoutes } from './routes/proxy-rbac';
import { createProxyAuthRoutes } from './routes/proxy-auth';
import { createProxyDashboardRoutes } from './routes/proxy-dashboard';
import { createOpsComplianceRoutes } from './routes/ops-compliance';
import { createOpsGasRoutes } from './routes/ops-gas';
import { createOpsSettingsRoutes } from './routes/ops-settings';
import { createOpsHealthRoutes } from './routes/ops-health';
import { complianceScreen } from './middleware/compliance-screen';
import { apiKeyAuth } from './middleware/api-key-auth';
import { createOpsApiKeyRoutes } from './routes/ops-api-keys';
import { GasStation } from './services/gas-station';
import { logger } from './utils/logger';

async function main() {
  // Initialize services
  const signerClient = new SignerClient();
  const balanceSync = new EvmBalanceSync(signerClient);
  const depositMonitor = new EvmDepositMonitor(signerClient);

  // Check signer connectivity
  const signerOk = await signerClient.healthCheck();
  if (signerOk) {
    logger.info('Signer connection verified', { url: config.signerUrl });
  } else {
    logger.warn('Signer not reachable — gateway will retry on requests', { url: config.signerUrl });
  }

  // ── Bank API (:3100) ──────────────────────────────────────────────────────
  const app = express();
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || false,
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    const signerUp = await signerClient.healthCheck();
    const enabledChains = Object.keys(getEnabledChains());
    res.json({
      service: 'blue-gateway',
      status:  signerUp ? 'healthy' : 'degraded',
      signer:  signerUp ? 'connected' : 'unreachable',
      chains:  enabledChains,
    });
  });

  // Auth routes (proxied to Driver — no auth middleware here)
  app.use('/auth', createProxyAuthRoutes());

  // API routes (bank-facing) — API key auth sits before all routes
  const apiRouter = express.Router();
  apiRouter.use(apiKeyAuth);
  // Blockchain operations
  apiRouter.use('/transfers', complianceScreen, createTransferRoutes(signerClient, balanceSync));
  // Proxy to Driver for wallet/vault/policy/rbac/dashboard
  apiRouter.use('/wallets', createProxyWalletRoutes());
  apiRouter.use('/wallets', createBalanceRoutes(signerClient, balanceSync)); // on-chain balance enrichment
  apiRouter.use('/vaults', createProxyVaultRoutes());
  apiRouter.use('/policies', createProxyPolicyRoutes());
  apiRouter.use('/', createProxyRbacRoutes());
  apiRouter.use('/dashboard', createProxyDashboardRoutes());
  app.use('/api/v1', apiRouter);

  // ── Ops Dashboard (:3400) ─────────────────────────────────────────────────
  const OPS_PORT = parseInt(process.env.OPS_PORT || '3400', 10);
  const opsApp = express();
  opsApp.use(helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity: false,  // disable HSTS — app serves HTTP, not HTTPS
  }));
  opsApp.use(cors({
    origin: process.env.CORS_ORIGIN || false,
    credentials: true,
  }));
  opsApp.use(express.json({ limit: '1mb' }));

  // Gas station service
  const gasStation = new GasStation(signerClient);

  // Auth proxy (login via Driver) — needed for Console dashboard login
  opsApp.use('/auth', createProxyAuthRoutes());

  // Data proxies (wallets, vaults, policies, dashboard — all via Driver)
  const opsApiRouter = express.Router();
  opsApiRouter.use('/wallets', createProxyWalletRoutes());
  opsApiRouter.use('/wallets', createBalanceRoutes(signerClient, balanceSync));
  opsApiRouter.use('/vaults', createProxyVaultRoutes());
  opsApiRouter.use('/policies', createProxyPolicyRoutes());
  opsApiRouter.use('/', createProxyRbacRoutes());
  opsApiRouter.use('/dashboard', createProxyDashboardRoutes());
  opsApiRouter.use('/transfers', complianceScreen, createTransferRoutes(signerClient, balanceSync));
  opsApp.use('/api/v1', opsApiRouter);

  // Ops API routes
  opsApp.use('/ops', createOpsRoutes(signerClient));
  opsApp.use('/ops/compliance', createOpsComplianceRoutes(signerClient));
  opsApp.use('/ops/gas-station', createOpsGasRoutes(signerClient, gasStation));
  opsApp.use('/ops/settings', createOpsSettingsRoutes());
  opsApp.use('/ops/api-keys', createOpsApiKeyRoutes());
  opsApp.use('/ops/health', createOpsHealthRoutes(signerClient));

  // Health
  opsApp.get('/health', async (_req, res) => {
    const signerUp = await signerClient.healthCheck();
    res.json({ service: 'blue-gateway-ops', status: signerUp ? 'healthy' : 'degraded' });
  });

  // ── Blue Agent reverse proxy ───────────────────────────────────────────────
  // Forwards browser /agent-api/* and /health (under /agent-api) to the agent service.
  const AGENT_URL = process.env.AGENT_URL || 'http://blue-agent:3500';
  opsApp.use('/agent-api', async (req, res) => {
    try {
      const url = `${AGENT_URL}${req.originalUrl.replace(/^\/agent-api/, '')}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
      }
      delete headers.host;
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body);
      if (body) headers['content-type'] = 'application/json';

      const response = await fetch(url, { method: req.method, headers, body });
      const text = await response.text();
      res.status(response.status);
      response.headers.forEach((v, k) => { if (!/^(transfer-encoding|content-length|connection)$/i.test(k)) res.setHeader(k, v); });
      res.send(text);
    } catch (err) {
      logger.warn('Agent proxy error', { error: err instanceof Error ? err.message : 'unknown', url: req.originalUrl });
      res.status(502).json({ error: 'Agent service unreachable' });
    }
  });

  // Serve ops dashboard static files
  const publicDir = path.join(__dirname, '../public');
  opsApp.use(express.static(publicDir));
  opsApp.get('*', (req, res) => {
    if (!req.path.startsWith('/ops') && !req.path.startsWith('/health')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });

  // ── Start servers first (don't block on RPC) ──────────────────────────────
  const enabledChains = Object.keys(getEnabledChains());
  const server = app.listen(config.port, () => {
    logger.info(`Blue Gateway API running on port ${config.port}`);
    logger.info(`Signer URL: ${config.signerUrl}`);
    logger.info(`Enabled chains: ${enabledChains.join(', ') || 'none'}`);
  });

  // Start ops dashboard — with optional TLS for enterprise environments
  const opsTlsCert = process.env.OPS_TLS_CERT || '';
  const opsTlsKey = process.env.OPS_TLS_KEY || '';
  let opsServer: any;

  if (opsTlsCert && opsTlsKey && fs.existsSync(opsTlsCert) && fs.existsSync(opsTlsKey)) {
    const tlsOptions = {
      cert: fs.readFileSync(opsTlsCert),
      key: fs.readFileSync(opsTlsKey),
    };
    opsServer = https.createServer(tlsOptions, opsApp).listen(OPS_PORT, () => {
      logger.info(`Ops Dashboard running on port ${OPS_PORT} (HTTPS/TLS)`);
    });
  } else {
    opsServer = opsApp.listen(OPS_PORT, () => {
      logger.info(`Ops Dashboard running on port ${OPS_PORT} (HTTP)`);
    });
  }

  // Start gas station (will check if configured)
  gasStation.start();

  // Start deposit monitor in background (don't block servers on slow RPC)
  if (enabledChains.length > 0) {
    depositMonitor.start(enabledChains).then(() => {
      logger.info('Deposit monitoring active', { chains: enabledChains });
    }).catch(err => {
      logger.warn('Deposit monitor failed to start', { error: err.message });
    });
  } else {
    logger.warn('No EVM chains configured — deposit monitoring disabled');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    depositMonitor.stop();
    gasStation.stop();
    server.close();
    opsServer.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});
