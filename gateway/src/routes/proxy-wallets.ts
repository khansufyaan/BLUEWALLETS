/**
 * Wallet Proxy Routes — Console ↔ Driver.
 * Bank apps and Console UI call these. They proxy to the Driver's internal API.
 */

import { Router, Request, Response } from 'express';
import { proxyGet, proxyPost, proxyDelete } from '../services/driver-proxy';

export function createProxyWalletRoutes(): Router {
  const router = Router();

  router.get('/',           async (_req, res) => proxy(res, () => proxyGet('/wallets')));
  router.get('/:id',        async (req, res)  => proxy(res, () => proxyGet(`/wallets/${req.params.id}`)));
  router.post('/',           async (req, res)  => proxy(res, () => proxyPost('/wallets', req.body), 201));
  router.post('/:id/transfer', async (req, res) => proxy(res, () => proxyPost(`/wallets/${req.params.id}/transfer`, req.body)));
  router.get('/:id/transactions', async (req, res) => proxy(res, () => proxyGet(`/wallets/${req.params.id}/transactions`)));
  router.post('/:id/policies', async (req, res) => proxy(res, () => proxyPost(`/wallets/${req.params.id}/policies`, req.body)));
  router.delete('/:id/policies/:pid', async (req, res) => proxy(res, () => proxyDelete(`/wallets/${req.params.id}/policies/${req.params.pid}`)));

  return router;
}

async function proxy(res: Response, fn: () => Promise<any>, successStatus = 200) {
  try {
    const data = await fn();
    res.status(successStatus).json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Proxy error';
    res.status(400).json({ error: msg });
  }
}
