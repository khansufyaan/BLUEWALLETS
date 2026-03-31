import { Router, Request, Response } from 'express';
import { HsmSession } from '../services/hsm-session';
import { getLogBuffer } from '../utils/logger';
import { logger } from '../utils/logger';

// ── Service restart state (lightweight toggle simulation) ─────────────────────
const serviceLastRestart: Record<string, Date> = {};

export function createHealthRoutes(hsmSession: HsmSession): Router {
  const router = Router();

  // ── Public health check (no auth) ─────────────────────────────────────────
  router.get('/', (_req: Request, res: Response) => {
    const status = hsmSession.getStatus();
    res.status(status.connected ? 200 : 503).json({
      service:   'waas-kms',
      status:    status.connected ? 'healthy' : 'degraded',
      hsm:       status,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Auth-protected: log viewer ─────────────────────────────────────────────
  // NOTE: these are mounted under /api/v1/health via the apiRouter which
  //       already requires authentication.
  router.get('/logs', (req: Request, res: Response) => {
    const service = String(req.query.service || 'all');
    const entries = getLogBuffer(service);
    res.json({ service, logs: entries });
  });

  // ── Auth-protected: service soft restart ─────────────────────────────────
  router.post('/services/:service/restart', (req: Request, res: Response) => {
    const { service } = req.params;
    const allowed = ['kms', 'policy', 'rbac', 'wallet', 'vault', 'hsm', 'api', 'all'];
    if (!allowed.includes(service)) {
      res.status(400).json({ error: `Unknown service: ${service}` });
      return;
    }

    serviceLastRestart[service] = new Date();
    logger.info(`Service soft-restart requested`, { service });

    res.json({
      service,
      restarted:  true,
      restartedAt: serviceLastRestart[service].toISOString(),
      message: `${service} service state has been refreshed. (In-process services restart instantly; HSM sessions reconnect on next use.)`,
    });
  });

  return router;
}
