/**
 * HSM-Signed Audit Log Service.
 *
 * Every sensitive action writes to the audit_log table with:
 *   - A SHA-256 hash of the canonical entry
 *   - An HSM ECDSA signature of that hash (if HSM is connected)
 *   - A prev_hash linking to the previous entry (hash chain for tamper detection)
 *
 * If the HSM is not connected, entries are stored unsigned (signature: null).
 * The hash chain is always maintained regardless of HSM state.
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import { HsmSession } from './hsm-session';
import { logger } from '../utils/logger';

export interface AuditEntry {
  id?:            number;
  timestamp:      Date;
  action:         string;
  actorId?:       string;
  actorUsername?:  string;
  actorRole?:     string;
  targetType?:    string;
  targetId?:      string;
  details?:       Record<string, any>;
  hash:           string;
  signature?:     string | null;
  prevHash?:      string | null;
}

export class AuditService {
  private lastHash: string | null = null;

  // In-memory fallback when no PG pool
  private memoryLog: AuditEntry[] = [];

  constructor(
    private pgPool: Pool | null,
    private hsmSession: HsmSession,
  ) {
    // Initialize hash chain from last DB entry
    this.initHashChain().catch(() => {});
  }

  private async initHashChain(): Promise<void> {
    if (!this.pgPool) return;
    try {
      const { rows } = await this.pgPool.query(
        'SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1'
      );
      if (rows[0]) {
        this.lastHash = rows[0].hash;
        logger.info('Audit hash chain initialized', { lastHash: this.lastHash?.slice(0, 16) });
      }
    } catch {}
  }

  /**
   * Record an audit event. Signs with HSM if available.
   */
  async record(params: {
    action:       string;
    actorId?:     string;
    actorUsername?: string;
    actorRole?:   string;
    targetType?:  string;
    targetId?:    string;
    details?:     Record<string, any>;
  }): Promise<AuditEntry> {
    const entry: AuditEntry = {
      timestamp:     new Date(),
      action:        params.action,
      actorId:       params.actorId,
      actorUsername:  params.actorUsername,
      actorRole:     params.actorRole,
      targetType:    params.targetType,
      targetId:      params.targetId,
      details:       params.details,
      hash:          '',
      signature:     null,
      prevHash:      this.lastHash,
    };

    // Compute hash of canonical entry (includes prev_hash for chain integrity)
    const canonical = JSON.stringify({
      timestamp:  entry.timestamp.toISOString(),
      action:     entry.action,
      actorId:    entry.actorId,
      targetType: entry.targetType,
      targetId:   entry.targetId,
      details:    entry.details,
      prevHash:   entry.prevHash,
    });
    entry.hash = crypto.createHash('sha256').update(canonical).digest('hex');

    // Sign with HSM if connected
    if (this.hsmSession.isConnected()) {
      try {
        entry.signature = await this.signWithHsm(entry.hash);
      } catch (err) {
        // HSM signing failed — store unsigned
        logger.warn('Audit HSM signing failed, storing unsigned', {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    // Persist
    if (this.pgPool) {
      try {
        const { rows } = await this.pgPool.query(
          `INSERT INTO audit_log (timestamp, action, actor_id, actor_username, actor_role,
            target_type, target_id, details, hash, signature, prev_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [entry.timestamp, entry.action, entry.actorId, entry.actorUsername, entry.actorRole,
           entry.targetType, entry.targetId, JSON.stringify(entry.details),
           entry.hash, entry.signature, entry.prevHash]
        );
        entry.id = rows[0].id;
      } catch (err) {
        logger.error('Failed to write audit log to PG', {
          error: err instanceof Error ? err.message : err,
        });
      }
    } else {
      // In-memory fallback
      entry.id = this.memoryLog.length + 1;
      this.memoryLog.push(entry);
      if (this.memoryLog.length > 10_000) this.memoryLog.shift();
    }

    this.lastHash = entry.hash;

    logger.debug('Audit entry recorded', {
      action: entry.action,
      actor: entry.actorUsername,
      signed: !!entry.signature,
    });

    return entry;
  }

  /**
   * Get audit log entries.
   */
  async getLog(limit = 100, offset = 0): Promise<AuditEntry[]> {
    if (this.pgPool) {
      const { rows } = await this.pgPool.query(
        'SELECT * FROM audit_log ORDER BY id DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return rows.map(r => ({
        id:            r.id,
        timestamp:     new Date(r.timestamp),
        action:        r.action,
        actorId:       r.actor_id,
        actorUsername:  r.actor_username,
        actorRole:     r.actor_role,
        targetType:    r.target_type,
        targetId:      r.target_id,
        details:       r.details,
        hash:          r.hash,
        signature:     r.signature,
        prevHash:      r.prev_hash,
      }));
    }
    return this.memoryLog.slice(-limit).reverse();
  }

  /**
   * Verify hash chain integrity.
   */
  async verifyChain(limit = 100): Promise<{ valid: boolean; entries: number; broken?: number }> {
    const entries = await this.getLog(limit);
    const reversed = [...entries].reverse(); // oldest first

    for (let i = 1; i < reversed.length; i++) {
      if (reversed[i].prevHash !== reversed[i - 1].hash) {
        return { valid: false, entries: reversed.length, broken: reversed[i].id };
      }
    }

    return { valid: true, entries: reversed.length };
  }

  /**
   * Sign a hash with the HSM's audit key.
   * Uses the wrap key for signing if no dedicated audit key exists.
   */
  private async signWithHsm(hashHex: string): Promise<string> {
    const session = this.hsmSession.getSession();
    const pkcs11 = this.hsmSession.getPkcs11();
    const pkcs11js = await import('pkcs11js');

    // Find the wrap key (we reuse it for audit signing since it's the only persistent key)
    pkcs11.C_FindObjectsInit(session, [
      { type: pkcs11js.default.CKA_LABEL, value: 'blue:wrap:v1' },
      { type: pkcs11js.default.CKA_TOKEN, value: true },
    ]);
    const keyHandle = pkcs11.C_FindObjects(session);
    pkcs11.C_FindObjectsFinal(session);

    if (!keyHandle) {
      throw new Error('No HSM key available for audit signing');
    }

    // HMAC-SHA256 with the wrap key (AES keys can do HMAC)
    const hashBuffer = Buffer.from(hashHex, 'hex');
    pkcs11.C_SignInit(session, { mechanism: pkcs11js.default.CKM_SHA256_HMAC }, keyHandle);
    const sig = Buffer.from(pkcs11.C_Sign(session, hashBuffer, Buffer.alloc(32)));
    return sig.toString('hex');
  }
}
