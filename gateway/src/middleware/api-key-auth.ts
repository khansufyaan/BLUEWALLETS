/**
 * API Key Authentication Middleware
 *
 * Checks for bank API keys on the :3300 bank-facing API.
 * Supports two header formats:
 *   - X-Api-Key: blue_...
 *   - Authorization: Bearer blue_...
 *
 * If a valid API key is found, attaches req.apiKeyData.
 * If no API key header is present, falls through to allow
 * the existing Bearer token auth (backwards compatible).
 */

import { Request, Response, NextFunction } from 'express';
import { apiKeyStore, ApiKey } from '../stores/api-key-store';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      apiKeyData?: ApiKey;
    }
  }
}

/**
 * Middleware that authenticates requests using API keys.
 * If no API key is provided, calls next() to allow other auth methods.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const rawKey = extractApiKey(req);

  // No API key present — let other auth handle it
  if (!rawKey) {
    next();
    return;
  }

  const apiKey = apiKeyStore.validate(rawKey);
  if (!apiKey) {
    logger.warn('Invalid or revoked API key', { prefix: rawKey.slice(0, 13) });
    res.status(401).json({ error: 'Invalid or revoked API key' });
    return;
  }

  req.apiKeyData = apiKey;
  next();
}

/**
 * Middleware that requires a specific permission on the API key.
 * Must be used after apiKeyAuth.
 */
export function requireApiKeyPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If authenticated via API key, check permissions
    if (req.apiKeyData) {
      const hasPermission = permissions.some(p => req.apiKeyData!.permissions.includes(p));
      if (!hasPermission) {
        res.status(403).json({
          error: 'Insufficient API key permissions',
          required: permissions,
          granted: req.apiKeyData.permissions,
        });
        return;
      }
    }
    // If not API key auth (session token), skip permission check — handled by Driver
    next();
  };
}

function extractApiKey(req: Request): string | null {
  // Check X-Api-Key header first
  const xApiKey = req.headers['x-api-key'] as string | undefined;
  if (xApiKey && xApiKey.startsWith('blue_') && xApiKey.length > 5) return xApiKey;

  // Check Authorization: Bearer blue_...
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer blue_') && auth.length > 12) return auth.slice(7);

  return null;
}
