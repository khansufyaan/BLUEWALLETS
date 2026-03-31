import path from 'path';
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
import { CeremonyApprovalService } from './services/ceremony-approval-service';
import { createHsmConfigRoutes } from './routes/hsm-config';
import { HsmConfigService } from './services/hsm-config-service';
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

  // Create user store and auth service (seed first)
  const userStore = new InMemoryUserStore();
  await userStore.seed();
  const authService = new AuthService(userStore);

  // Create stores
  const walletStore = new InMemoryWalletStore();
  const transactionStore = new InMemoryTransactionStore();
  const policyStore = new InMemoryPolicyStore();
  const vaultStore = new InMemoryVaultStore();
  const roleStore = new InMemoryRoleStore();

  // Create services
  const kms = new KmsService(hsmSession);
  const policyEngine = new PolicyEngine(policyStore);
  const walletService = new WalletService(kms, policyEngine, walletStore, transactionStore);
  const vaultService = new VaultService(vaultStore);
  const rbacService = new RbacService(roleStore);
  const ceremonyApprovalService = new CeremonyApprovalService();
  const ceremonyService = new CeremonyService(hsmSession, ceremonyApprovalService);
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
  app.use('/health', createHealthRoutes(hsmSession));

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
  apiRouter.use('/ceremony', createCeremonyRoutes(ceremonyService, ceremonyApprovalService, authService));
  apiRouter.use('/hsm', createHsmConfigRoutes(hsmConfigService));
  apiRouter.use('/health', createHealthRoutes(hsmSession)); // auth-protected sub-routes (logs, restart)
  app.use('/api/v1', apiRouter);

  // Serve UI console
  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/health')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });

  // Start server
  const server = app.listen(serverConfig.port, () => {
    logger.info(`Blue Wallets server running on port ${serverConfig.port}`);
    logger.info(`HSM status: ${hsmSession.isConnected() ? 'connected' : 'disconnected'}`);
    logger.info(`UI Console: http://localhost:${serverConfig.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    server.close();
    await hsmSession.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});
