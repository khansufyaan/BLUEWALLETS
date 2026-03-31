import { Request, Response, NextFunction } from 'express';
import { AuthService, Session } from '../services/auth-service';

// Augment express Request type
declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

export function requireAuth(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const session = authService.validate(token);
    if (!session) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }
    req.session = session;
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.session.role)) {
      res.status(403).json({ error: `Role '${req.session.role}' is not permitted. Required: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}
