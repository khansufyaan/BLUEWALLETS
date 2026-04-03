import path from 'path';
import fs from 'fs';
import https from 'https';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getHsmConfig, serverConfig } from './config';
import { HsmSession } from './services/hsm-session';
import { KmsService } from './services/kms-service';
import { PolicyEngine } from './services/policy-engine';
import { WalletService } from './services/wallet-service';
import { VaultService } from './services/vault-service';
import { RbacService } from './services/rbac-service';
import { InMemoryUserStore } from './stores/user-store';
import { AuthService } from './services/auth-service';
import {
  InMemoryWalletStore, InMemoryTransactionStore, InMemoryPolicyStore,
  InMemoryVaultStore, InMemoryRoleStore,
} from './stores';
import { createKeyRoutes } from './routes/keys';
import { createHealthRoutes } from './routes/health';
import { createWalletRoutes } from './routes/wallets';
import { createPolicyRoutes } from './routes/policies';
import { createVaultRoutes } from './routes/vaults';
import { createRbacRoutes } from './routes/rbac';
import { createDashboardRoutes } from './routes/dashboard';
import { createCeremonyRoutes } from './routes/ceremony';
import { createAuthRoutes } from './routes/auth';
import { requireAuth } from './middleware/auth';
import { CeremonyService } from './services/ceremony-service';
import { createHsmConfigRoutes } from './routes/hsm-config';
import { HsmConfigService } from './services/hsm-config-service';
import { createInternalRoutes } from './routes/internal';
import { initDatabase, closeDatabase } from './db/pool';
import { PgWalletStore } from './stores/pg-wallet-store';
import { PgTransactionStore } from './stores/pg-transaction-store';
import { PgPolicyStore } from './stores/pg-policy-store';
import { PgVaultStore } from './stores/pg-vault-store';
import { PgRoleStore } from './stores/pg-role-store';
import { PgUserStore } from './stores/pg-user-store';
import { AuditService } from './services/audit-service';
import { logger } from './utils/logger';

async function main() {
  // Initialize HSM connection — optional at startup.
  // If no env vars are set, the server starts without HSM.
  // Users configure it via POST /api/v1/hsm/connect in the UI.
  const hsmConfig = getHsmConfig();
  const hsmSession = new HsmSession(hsmConfig ?? {
    pkcs11Library: '',
    slotIndex: 0,
    pin: '',
    label: 'waas-kms',
  });

  if (hsmConfig) {
    try {
      await hsmSession.initialize();
      logger.info('HSM pre-configured from environment variables');
    } catch (error) {
      logger.warn('HSM startup connection failed — continuing without HSM', { error });
    }
  } else {
    logger.info('No HSM env vars detected — starting without HSM (configure via UI)');
  }

  // ── Database (PostgreSQL if DATABASE_URL is set, else in-memory) ──────────
  const pgPool = await initDatabase();

  let userStore: InMemoryUserStore | PgUserStore;
  let walletStore: any;
  let transactionStore: any;
  let policyStore: any;
  let vaultStore: any;
  let roleStore: any;

  if (pgPool) {
    logger.info('Using PostgreSQL stores');
    userStore        = new PgUserStore(pgPool);
    walletStore      = new PgWalletStore(pgPool);
    transactionStore = new PgTransactionStore(pgPool);
    policyStore      = new PgPolicyStore(pgPool);
    vaultStore       = new PgVaultStore(pgPool);
    roleStore        = new PgRoleStore(pgPool);
  } else {
    logger.info('Using in-memory stores');
    userStore        = new InMemoryUserStore();
    walletStore      = new InMemoryWalletStore();
    transactionStore = new InMemoryTransactionStore();
    policyStore      = new InMemoryPolicyStore();
    vaultStore       = new InMemoryVaultStore();
    roleStore        = new InMemoryRoleStore();
  }

  await userStore.seed();
  const authService = new AuthService(userStore as any);

  // Create services
  const kms = new KmsService(hsmSession);
  const policyEngine = new PolicyEngine(policyStore);
  const walletService = new WalletService(kms, policyEngine, walletStore, transactionStore);
  const vaultService = new VaultService(vaultStore);
  const rbacService = new RbacService(roleStore);
  const ceremonyService = new CeremonyService(hsmSession, kms);
  const hsmConfigService = new HsmConfigService(hsmSession);

  // Seed default roles
  await rbacService.seedDefaults();

  // Create Express app
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json());

  // Health route (public: /health — just the GET /)
  // Additional health sub-routes (logs, restart) live under /api/v1/health (authenticated)
  app.use('/health', createHealthRoutes(hsmSession, pgPool ? 'postgresql' : 'in-memory'));

  // Auth routes (no auth required — these ARE the auth endpoints)
  app.use('/auth', createAuthRoutes(authService));

  // All /api/v1/* routes require authentication via a dedicated router
  const apiRouter = express.Router();
  apiRouter.use(requireAuth(authService));
  apiRouter.use('/keys', createKeyRoutes(kms));
  apiRouter.use('/wallets', createWalletRoutes(walletService));
  apiRouter.use('/policies', createPolicyRoutes(policyEngine));
  apiRouter.use('/vaults', createVaultRoutes(vaultService, walletService));
  apiRouter.use('/', createRbacRoutes(rbacService));
  apiRouter.use('/dashboard', createDashboardRoutes(walletService, vaultService, policyEngine, rbacService, transactionStore));
  apiRouter.use('/ceremony', createCeremonyRoutes(ceremonyService, authService));
  apiRouter.use('/hsm', createHsmConfigRoutes(hsmConfigService));

  // Users management (admin only)
  apiRouter.get('/users', async (_req, res) => {
    try {
      const users = await userStore.listAll();
      res.json({ users });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list users' });
    }
  });
  apiRouter.post('/users', async (req, res) => {
    try {
      if (req.session?.role !== 'admin') {
        res.status(403).json({ error: 'Admin role required' });
        return;
      }
      const { username, displayName, role, password } = req.body;
      if (!username || !displayName || !role || !password) {
        res.status(400).json({ error: 'username, displayName, role, and password are required' });
        return;
      }
      if (!['admin', 'officer', 'auditor'].includes(role)) {
        res.status(400).json({ error: 'role must be admin, officer, or auditor' });
        return;
      }
      const user = await userStore.createUser({ username, displayName, role, password });
      res.status(201).json({ user });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create user';
      res.status(400).json({ error: msg });
    }
  });
  apiRouter.use('/health', createHealthRoutes(hsmSession, pgPool ? 'postgresql' : 'in-memory')); // auth-protected sub-routes (logs, restart)
  app.use('/api/v1', apiRouter);

  // Serve UI console
  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/health')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });

  // ── Internal API (gateway-facing, port 3200) ──────────────────────────────
  const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || '3200', 10);

  // Detect mTLS configuration before mounting routes (so health can report it)
  const certsDir = path.join(__dirname, '../certs');
  const mtlsEnabled = process.env.MTLS_ENABLED === 'true';
  const hasCerts = mtlsEnabled &&
                   fs.existsSync(path.join(certsDir, 'driver-cert.pem')) &&
                   fs.existsSync(path.join(certsDir, 'driver-key.pem')) &&
                   fs.existsSync(path.join(certsDir, 'ca.pem'));

  const tlsInfo = {
    mtls:      hasCerts,
    transport: (hasCerts ? 'mTLS' : 'HTTP') as 'mTLS' | 'HTTP',
    port:      INTERNAL_PORT,
    ...(hasCerts ? { certFile: 'driver-cert.pem', caFile: 'ca.pem' } : {}),
  };

  const internalApp = express();
  internalApp.use(helmet({ contentSecurityPolicy: false }));
  internalApp.use(express.json());
  internalApp.use('/internal', createInternalRoutes({
    kms, walletStore, transactionStore, walletService,
    vaultService, policyEngine, rbacService, authService,
  }));

  // Health check for internal API (also tracks Console heartbeat via shared handler)
  internalApp.use('/health', createHealthRoutes(hsmSession, pgPool ? 'postgresql' : 'in-memory', tlsInfo));

  // Start servers
  const server = app.listen(serverConfig.port, () => {
    logger.info(`Blue Wallets admin console running on port ${serverConfig.port}`);
    logger.info(`HSM status: ${hsmSession.isConnected() ? 'connected' : 'disconnected'}`);
    logger.info(`UI Console: http://localhost:${serverConfig.port}`);
  });

  // ── mTLS for internal API (if certs are present) ─────────────────────────
  let internalServer: any;

  if (hasCerts) {
    const tlsOptions = {
      cert: fs.readFileSync(path.join(certsDir, 'driver-cert.pem')),
      key:  fs.readFileSync(path.join(certsDir, 'driver-key.pem')),
      ca:   fs.readFileSync(path.join(certsDir, 'ca.pem')),
      requestCert: true,           // require client certificate
      rejectUnauthorized: true,    // reject if client cert not signed by our CA
    };

    internalServer = https.createServer(tlsOptions, internalApp).listen(INTERNAL_PORT, () => {
      logger.info(`Internal API running on port ${INTERNAL_PORT} (mTLS enabled)`);
    });
  } else {
    internalServer = internalApp.listen(INTERNAL_PORT, () => {
      logger.info(`Internal API running on port ${INTERNAL_PORT} (HTTP — no certs found)`);
    });
  }

  // ── Audit service ─────────────────────────────────────────────────────────
  const auditService = new AuditService(pgPool, hsmSession);

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    server.close();
    internalServer.close();
    await hsmSession.cleanup();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});
