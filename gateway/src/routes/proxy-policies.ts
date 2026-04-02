import { Router, Response } from 'express';
import { proxyGet, proxyPost, proxyPut, proxyDelete } from '../services/driver-proxy';

export function createProxyPolicyRoutes(): Router {
  const router = Router();

  router.get('/',       async (_req, res) => proxy(res, () => proxyGet('/policies')));
  router.get('/:id',    async (req, res)  => proxy(res, () => proxyGet(`/policies/${req.params.id}`)));
  router.post('/',       async (req, res)  => proxy(res, () => proxyPost('/policies', req.body), 201));
  router.put('/:id',    async (req, res)  => proxy(res, () => proxyPut(`/policies/${req.params.id}`, req.body)));
  router.delete('/:id', async (req, res)  => proxy(res, () => proxyDelete(`/policies/${req.params.id}`)));

  return router;
}

async function proxy(res: Response, fn: () => Promise<any>, status = 200) {
  try { res.status(status).json(await fn()); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Proxy error' }); }
}
