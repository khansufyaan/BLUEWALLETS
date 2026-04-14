import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/auth-service';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function getRpId(req: Request): string {
  // Extract hostname without port
  const host = req.headers.host || 'localhost';
  return host.split(':')[0];
}

function getOrigin(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.headers.host}`;
}

// Simple in-memory rate limiter for auth endpoints
const _authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_WINDOW_MS = 60_000; // 1 minute
const AUTH_RATE_MAX = 10; // 10 attempts per minute per IP

function authRateLimit(req: Request, res: Response, next: Function): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = _authAttempts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= AUTH_RATE_MAX) {
      res.status(429).json({ error: 'Too many authentication attempts. Try again later.' });
      return;
    }
    entry.count++;
  } else {
    _authAttempts.set(ip, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
  }
  // Cleanup stale entries periodically
  if (_authAttempts.size > 10000) {
    for (const [key, val] of _authAttempts) {
      if (now > val.resetAt) _authAttempts.delete(key);
    }
  }
  next();
}

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  // ── Password Login ────────────────────────────────────────────────────────

  router.post('/login', authRateLimit, validate(loginSchema), async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body as { username: string; password: string };
      const session = await authService.login(username, password);
      res.json({
        token: session.token,
        user: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
        },
        expiresAt: session.expiresAt,
        hasPasskey: authService.hasPasskey(username),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Login failed';
      logger.warn('Login failed', { username: req.body?.username });
      res.status(401).json({ error: msg });
    }
  });

  router.post('/logout', requireAuth(authService), (req: Request, res: Response) => {
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    authService.logout(token);
    res.json({ loggedOut: true });
  });

  router.get('/me', requireAuth(authService), (req: Request, res: Response) => {
    res.json({ user: req.session });
  });

  // ── WebAuthn Registration (requires auth — you must be logged in) ─────────

  /** POST /auth/webauthn/register/options */
  router.post('/webauthn/register/options', requireAuth(authService), async (req: Request, res: Response) => {
    try {
      const options = await authService.webauthnRegisterOptions(
        req.session!.userId,
        getRpId(req),
      );
      res.json(options);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to generate registration options';
      res.status(400).json({ error: msg });
    }
  });

  /** POST /auth/webauthn/register/verify */
  router.post('/webauthn/register/verify', requireAuth(authService), async (req: Request, res: Response) => {
    try {
      await authService.webauthnRegisterVerify(
        req.session!.userId,
        req.body,
        getRpId(req),
        getOrigin(req),
      );
      res.json({ registered: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Registration verification failed';
      res.status(400).json({ error: msg });
    }
  });

  // ── WebAuthn Login (no auth required) ─────────────────────────────────────

  /** POST /auth/webauthn/login/options */
  router.post('/webauthn/login/options', async (req: Request, res: Response) => {
    try {
      const { username } = req.body;
      if (!username) { res.status(400).json({ error: 'username required' }); return; }

      const options = await authService.webauthnLoginOptions(username, getRpId(req));
      res.json(options);
    } catch (error) {
      // Don't reveal whether user exists
      res.json({ available: false });
    }
  });

  /** POST /auth/webauthn/login/verify */
  router.post('/webauthn/login/verify', async (req: Request, res: Response) => {
    try {
      const { username, ...credentialResponse } = req.body;
      if (!username) { res.status(400).json({ error: 'username required' }); return; }

      const session = await authService.webauthnLoginVerify(
        username,
        credentialResponse,
        getRpId(req),
        getOrigin(req),
      );

      res.json({
        token: session.token,
        user: {
          id: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
        },
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Authentication failed';
      logger.warn('WebAuthn login failed', { username: req.body?.username });
      res.status(401).json({ error: msg });
    }
  });

  return router;
}
