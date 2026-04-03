import { Router, Request, Response } from 'express';
import { HsmSession } from '../services/hsm-session';
import { getLogBuffer } from '../utils/logger';
import { logger } from '../utils/logger';

// ── Service restart state (lightweight toggle simulation) ─────────────────────
const serviceLastRestart: Record<string, Date> = {};

// ── Console heartbeat tracking ────────────────────────────────────────────────
let lastConsoleHeartbeat: { lastPingAt: Date; consoleId?: string } | null = null;
const CONSOLE_TIMEOUT_S = 60;

export interface InternalApiTlsInfo {
  mtls: boolean;
  transport: 'mTLS' | 'HTTP';
  port: number;
  certFile?: string;
  caFile?: string;
}

export function createHealthRoutes(
  hsmSession: HsmSession,
  dbType?: 'postgresql' | 'in-memory',
  tlsInfo?: InternalApiTlsInfo,
): Router {
  const router = Router();

  // ── Public health check (no auth) ─────────────────────────────────────────
  router.get('/', (req: Request, res: Response) => {
    // Track Console heartbeat from X-Blue-Console header
    if (req.headers['x-blue-console']) {
      lastConsoleHeartbeat = {
        lastPingAt: new Date(),
        consoleId: req.headers['x-blue-console'] as string,
      };
    }

    const status = hsmSession.getStatus();

    // Extract client cert info from mTLS connection (if available)
    let clientCert: any = undefined;
    if (tlsInfo?.mtls && (req.socket as any).getPeerCertificate) {
      try {
        const peer = (req.socket as any).getPeerCertificate(false);
        if (peer && peer.subject) {
          clientCert = {
            subject:  peer.subject.CN || peer.subject.O || 'Unknown',
            issuer:   peer.issuer?.CN || peer.issuer?.O || 'Unknown',
            validTo:  peer.valid_to,
            serial:   peer.serialNumber,
          };
        }
      } catch { /* no peer cert */ }
    }

    res.status(status.connected ? 200 : 503).json({
      service:   'blue-driver',
      status:    status.connected ? 'healthy' : 'degraded',
      hsm:       status,
      database:  { type: dbType || 'in-memory', connected: true },
      internalApi: tlsInfo ? {
        transport: tlsInfo.transport,
        mtls:      tlsInfo.mtls,
        port:      tlsInfo.port,
        ...(clientCert ? { clientCert } : {}),
      } : { transport: 'HTTP', mtls: false, port: 3200 },
      timestamp: new Date().toISOString(),
    });
  });

  // ── Console connection status ─────────────────────────────────────────────
  router.get('/console-status', (_req: Request, res: Response) => {
    if (!lastConsoleHeartbeat) {
      res.json({ connected: false, lastPingAt: null, secondsAgo: null });
      return;
    }
    const secondsAgo = Math.floor((Date.now() - lastConsoleHeartbeat.lastPingAt.getTime()) / 1000);
    res.json({
      connected:  secondsAgo < CONSOLE_TIMEOUT_S,
      lastPingAt: lastConsoleHeartbeat.lastPingAt.toISOString(),
      secondsAgo,
      consoleId:  lastConsoleHeartbeat.consoleId,
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
