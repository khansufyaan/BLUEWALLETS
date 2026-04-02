/**
 * PostgreSQL connection pool.
 *
 * Uses DATABASE_URL env var. If not set, returns null (fall back to in-memory stores).
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool | null {
  return pool;
}

export async function initDatabase(): Promise<Pool | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.info('DATABASE_URL not set — using in-memory stores');
    return null;
  }

  pool = new Pool({ connectionString: url });

  // Test connection
  try {
    const client = await pool.connect();
    logger.info('PostgreSQL connected', { database: url.split('/').pop()?.split('?')[0] });

    // Run migrations — try dist first, then src (for dev)
    const distPath = join(__dirname, 'schema.sql');
    const srcPath = join(__dirname, '../../src/db/schema.sql');
    const schemaPath = existsSync(distPath) ? distPath : srcPath;
    const schema = readFileSync(schemaPath, 'utf-8');
    await client.query(schema);
    logger.info('Database schema applied');

    client.release();
    return pool;
  } catch (error) {
    logger.error('PostgreSQL connection failed', {
      error: error instanceof Error ? error.message : error,
    });
    pool = null;
    return null;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
