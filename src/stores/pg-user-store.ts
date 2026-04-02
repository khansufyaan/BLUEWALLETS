/**
 * PostgreSQL-backed user store with WebAuthn credential support.
 * Implements the same interface as InMemoryUserStore.
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { User, WebAuthnCredential } from './user-store';
import { logger } from '../utils/logger';

export class PgUserStore {
  constructor(private pool: Pool) {}

  async seed(): Promise<void> {
    const defaults = [
      { username: 'admin',    displayName: 'System Administrator', role: 'admin',   password: 'Admin1234!',   mustChangePassword: false },
      { username: 'officer1', displayName: 'Officer 1',            role: 'officer', password: 'Officer1234!', mustChangePassword: true  },
      { username: 'officer2', displayName: 'Officer 2',            role: 'officer', password: 'Officer1234!', mustChangePassword: true  },
      { username: 'officer3', displayName: 'Officer 3',            role: 'officer', password: 'Officer1234!', mustChangePassword: true  },
      { username: 'auditor',  displayName: 'Auditor',              role: 'auditor', password: 'Auditor1234!', mustChangePassword: true  },
    ];

    for (const d of defaults) {
      const exists = await this.findByUsername(d.username);
      if (exists) continue;

      const passwordHash = await bcrypt.hash(d.password, 12);
      await this.pool.query(
        `INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), d.username, d.displayName, passwordHash, d.role, d.mustChangePassword, new Date()]
      );
      logger.info('Seeded user', { username: d.username, role: d.role });
    }
  }

  async listAll(): Promise<Omit<User, 'passwordHash' | 'webauthnCredentials'>[]> {
    const { rows } = await this.pool.query(
      'SELECT id, username, display_name, role, created_at, must_change_password FROM users ORDER BY created_at'
    );
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      createdAt: new Date(r.created_at),
      mustChangePassword: r.must_change_password,
    }));
  }

  async createUser(data: { username: string; displayName: string; role: 'admin' | 'officer' | 'auditor'; password: string }): Promise<Omit<User, 'passwordHash' | 'webauthnCredentials'>> {
    const exists = await this.findByUsername(data.username);
    if (exists) throw new Error(`User '${data.username}' already exists`);

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(data.password, 12);
    await this.pool.query(
      `INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, data.username.toLowerCase(), data.displayName, passwordHash, data.role, true, new Date()]
    );
    logger.info('Created user', { username: data.username, role: data.role });
    return {
      id,
      username: data.username.toLowerCase(),
      displayName: data.displayName,
      role: data.role,
      createdAt: new Date(),
      mustChangePassword: true,
    };
  }

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE username = $1', [username.toLowerCase()]
    );
    if (!rows[0]) return null;
    return this.toUser(rows[0]);
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) return null;
    return this.toUser(rows[0]);
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  // ── WebAuthn ──────────────────────────────────────────────────────────────

  async addWebAuthnCredential(userId: string, credential: WebAuthnCredential): Promise<void> {
    await this.pool.query(
      `INSERT INTO webauthn_credentials (credential_id, user_id, public_key, counter, transports, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [credential.credentialId, userId, credential.publicKey,
       credential.counter, JSON.stringify(credential.transports || []), credential.createdAt]
    );
    logger.info('WebAuthn credential registered (PG)', { userId });
  }

  async findByCredentialId(credentialId: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT u.* FROM users u JOIN webauthn_credentials w ON u.id = w.user_id
       WHERE w.credential_id = $1`, [credentialId]
    );
    if (!rows[0]) return null;
    return this.toUser(rows[0]);
  }

  async updateCredentialCounter(userId: string, credentialId: string, newCounter: number): Promise<void> {
    await this.pool.query(
      'UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2 AND user_id = $3',
      [newCounter, credentialId, userId]
    );
  }

  hasWebAuthnCredentials(username: string): boolean {
    // Note: This is sync in the interface but needs to be async for PG.
    // For now, we cache this. In practice, call getWebAuthnCredentials instead.
    return false; // Caller should use async version
  }

  async hasWebAuthnCredentialsAsync(username: string): Promise<boolean> {
    const creds = await this.getWebAuthnCredentials(username);
    return creds.length > 0;
  }

  async getWebAuthnCredentials(username: string): Promise<WebAuthnCredential[]> {
    const { rows } = await this.pool.query(
      `SELECT w.* FROM webauthn_credentials w
       JOIN users u ON u.id = w.user_id
       WHERE u.username = $1`,
      [username.toLowerCase()]
    );
    return rows.map(r => ({
      credentialId: r.credential_id,
      publicKey:    r.public_key,
      counter:      r.counter,
      transports:   r.transports || [],
      createdAt:    new Date(r.created_at),
    }));
  }

  private async loadCredentials(userId: string): Promise<WebAuthnCredential[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM webauthn_credentials WHERE user_id = $1', [userId]
    );
    return rows.map(r => ({
      credentialId: r.credential_id,
      publicKey:    r.public_key,
      counter:      r.counter,
      transports:   r.transports || [],
      createdAt:    new Date(r.created_at),
    }));
  }

  private async toUser(row: any): Promise<User> {
    const creds = await this.loadCredentials(row.id);
    return {
      id:                  row.id,
      username:            row.username,
      displayName:         row.display_name,
      passwordHash:        row.password_hash,
      role:                row.role,
      createdAt:           new Date(row.created_at),
      mustChangePassword:  row.must_change_password,
      webauthnCredentials: creds,
    };
  }
}
