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

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
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

  return router;
}
