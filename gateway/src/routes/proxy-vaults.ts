import { Router, Response } from 'express';
import { proxyGet, proxyPost } from '../services/driver-proxy';

export function createProxyVaultRoutes(): Router {
  const router = Router();

  router.get('/',              async (_req, res) => proxy(res, () => proxyGet('/vaults')));
  router.get('/:id',           async (req, res)  => proxy(res, () => proxyGet(`/vaults/${req.params.id}`)));
  router.post('/',              async (req, res)  => proxy(res, () => proxyPost('/vaults', req.body), 201));
  router.post('/:id/wallets',  async (req, res)  => proxy(res, () => proxyPost(`/vaults/${req.params.id}/wallets`, req.body), 201));
  router.get('/:id/wallets',   async (req, res)  => proxy(res, () => proxyGet(`/vaults/${req.params.id}/wallets`)));

  return router;
}

async function proxy(res: Response, fn: () => Promise<any>, status = 200) {
  try { res.status(status).json(await fn()); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Proxy error' }); }
}
