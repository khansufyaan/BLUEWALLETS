import { Router, Request, Response } from 'express';
import { HsmSession } from '../services/hsm-session';

export function createHealthRoutes(hsmSession: HsmSession): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const status = hsmSession.getStatus();
    res.status(status.connected ? 200 : 503).json({
      service: 'waas-kms',
      status: status.connected ? 'healthy' : 'degraded',
      hsm: status,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
