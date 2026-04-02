/**
 * Auth Proxy — Console login is proxied to the Driver.
 * User credentials are validated against the Driver's user store.
 */

import { Router, Response } from 'express';
import { proxyPost, proxyGet } from '../services/driver-proxy';

export function createProxyAuthRoutes(): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    try {
      const result = await proxyPost('/auth/login', req.body);
      res.json(result);
    } catch (e) {
      res.status(401).json({ error: e instanceof Error ? e.message : 'Login failed' });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      await proxyPost('/auth/logout', {}, token ? { 'Authorization': `Bearer ${token}` } : {});
      res.json({ loggedOut: true });
    } catch {
      res.json({ loggedOut: true });
    }
  });

  router.get('/me', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) { res.status(401).json({ error: 'No token' }); return; }
      const user = await proxyGet('/auth/me', { 'X-User-Token': token });
      res.json(user);
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  return router;
}
