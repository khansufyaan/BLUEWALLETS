/**
 * API Key Management Routes — ops dashboard endpoints.
 *
 * Mounted at /ops/api-keys on the ops app (:3400).
 * Create, list, and revoke API keys for bank integrations.
 */

import { Router, Request, Response } from 'express';
import { apiKeyStore, API_KEY_PERMISSIONS } from '../stores/api-key-store';
import { logger } from '../utils/logger';

export function createOpsApiKeyRoutes(): Router {
  const router = Router();

  /** GET /ops/api-keys — list all API keys (safe, no secrets exposed) */
  router.get('/', (_req: Request, res: Response) => {
    const keys = apiKeyStore.list().map(k => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      permissions: k.permissions,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      expiresAt: k.expiresAt,
      active: !k.revokedAt && (!k.expiresAt || new Date(k.expiresAt) > new Date()),
    }));
    res.json({ keys, availablePermissions: API_KEY_PERMISSIONS });
  });

  /** POST /ops/api-keys — create a new API key (returns plaintext ONCE) */
  router.post('/', (req: Request, res: Response) => {
    const { name, permissions, expiresAt } = req.body;

    if (!name || typeof name !== 'string' || name.length < 1) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const perms = Array.isArray(permissions) ? permissions : [...API_KEY_PERMISSIONS];

    // Validate permissions
    const invalid = perms.filter((p: string) => !(API_KEY_PERMISSIONS as readonly string[]).includes(p));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid permissions: ${invalid.join(', ')}` });
      return;
    }

    // Validate expiry date if provided
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) {
        res.status(400).json({ error: 'Invalid expiresAt date format' });
        return;
      }
      if (d <= new Date()) {
        res.status(400).json({ error: 'expiresAt must be in the future' });
        return;
      }
    }

    try {
      const { apiKey, rawKey } = apiKeyStore.create(name, perms, expiresAt);
      logger.info('API key created via ops dashboard', { id: apiKey.id, name });
      res.status(201).json({
        key: rawKey,  // Only time the full key is returned
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        permissions: apiKey.permissions,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        warning: 'Save this key now. It will not be shown again.',
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  /** DELETE /ops/api-keys/:id — revoke an API key */
  router.delete('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const revoked = apiKeyStore.revoke(id);
    if (!revoked) {
      res.status(404).json({ error: 'API key not found or already revoked' });
      return;
    }
    logger.info('API key revoked via ops dashboard', { id });
    res.json({ revoked: true, id });
  });

  return router;
}
