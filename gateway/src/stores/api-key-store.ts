/**
 * API Key Store — in-memory store for bank API keys.
 *
 * Keys are hashed (SHA-256) before storage. The plaintext is returned
 * exactly once on creation and never stored.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  permissions: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

/** All available permission scopes for API keys. */
export const API_KEY_PERMISSIONS = [
  'wallets:read',
  'wallets:create',
  'vaults:read',
  'vaults:create',
  'transfers:execute',
  'policies:read',
  'policies:write',
  'dashboard:read',
] as const;

export type ApiKeyPermission = typeof API_KEY_PERMISSIONS[number];

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateRawKey(): string {
  return `blue_${crypto.randomBytes(32).toString('hex')}`;
}

class ApiKeyStore {
  private keys = new Map<string, ApiKey>();
  private hashIndex = new Map<string, string>(); // keyHash → id

  /** Create a new API key. Returns the full plaintext key (only time it's available). */
  create(name: string, permissions: string[], expiresAt?: string): { apiKey: ApiKey; rawKey: string } {
    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const prefix = rawKey.slice(0, 13); // "blue_" + 8 hex chars

    const apiKey: ApiKey = {
      id: uuidv4(),
      name,
      keyHash,
      prefix,
      permissions,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: expiresAt || null,
    };

    this.keys.set(apiKey.id, apiKey);
    this.hashIndex.set(keyHash, apiKey.id);
    logger.info('API key created', { id: apiKey.id, name, prefix });

    return { apiKey, rawKey };
  }

  /** Look up an API key by its raw value. Returns null if not found, revoked, or expired. */
  validate(rawKey: string): ApiKey | null {
    const keyHash = hashKey(rawKey);
    const id = this.hashIndex.get(keyHash);
    if (!id) return null;

    const key = this.keys.get(id);
    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null;

    // Update last used
    key.lastUsedAt = new Date().toISOString();
    return key;
  }

  /** List all keys (safe for display — keyHash is NOT the raw key). */
  list(): ApiKey[] {
    return Array.from(this.keys.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /** Revoke (soft delete) a key by ID. */
  revoke(id: string): boolean {
    const key = this.keys.get(id);
    if (!key || key.revokedAt) return false;
    key.revokedAt = new Date().toISOString();
    this.hashIndex.delete(key.keyHash);
    logger.info('API key revoked', { id, name: key.name });
    return true;
  }

  /** Get a key by ID. */
  get(id: string): ApiKey | null {
    return this.keys.get(id) || null;
  }
}

export const apiKeyStore = new ApiKeyStore();
