/**
 * Internal API authentication middleware.
 *
 * Validates requests from the gateway using a shared secret.
 * The gateway must send `X-Internal-Key: <secret>` on every request.
 *
 * This is a bootstrap mechanism — production deployments should
 * upgrade to mTLS between signer and gateway.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const INTERNAL_AUTH_KEY = process.env.INTERNAL_AUTH_KEY || '';

export function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  if (!INTERNAL_AUTH_KEY) {
    logger.warn('INTERNAL_AUTH_KEY not set — internal API is unprotected');
    next();
    return;
  }

  const provided = req.headers['x-internal-key'] as string | undefined;
  if (!provided || provided !== INTERNAL_AUTH_KEY) {
    res.status(401).json({ error: 'Invalid or missing internal auth key' });
    return;
  }

  next();
}
