import { Router, Response } from 'express';
import { proxyGet } from '../services/driver-proxy';

export function createProxyRbacRoutes(): Router {
  const router = Router();

  router.get('/roles',       async (_req, res) => proxy(res, () => proxyGet('/roles')));
  router.get('/permissions', async (_req, res) => proxy(res, () => proxyGet('/permissions')));

  return router;
}

async function proxy(res: Response, fn: () => Promise<any>) {
  try { res.json(await fn()); }
  catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Proxy error' }); }
}
