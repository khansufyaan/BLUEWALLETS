import { Router, Response } from 'express';
import { proxyGet } from '../services/driver-proxy';

export function createProxyDashboardRoutes(): Router {
  const router = Router();

  router.get('/stats',        async (req, res) => proxy(res, () => proxyGet(`/dashboard/stats`)));
  router.get('/transactions', async (req, res) => {
    const limit = req.query.limit || '50';
    proxy(res, () => proxyGet(`/dashboard/transactions?limit=${limit}`));
  });

  return router;
}

async function proxy(res: Response, fn: () => Promise<any>) {
  try { res.json(await fn()); }
  catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Proxy error' }); }
}
