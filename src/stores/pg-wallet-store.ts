/**
 * PostgreSQL-backed wallet store.
 * BigInt balance stored as TEXT, converted on read/write.
 */

import { Pool } from 'pg';
import { IWalletStore } from '../types/store';
import { Wallet } from '../types/wallet';

export class PgWalletStore implements IWalletStore {
  constructor(private pool: Pool) {}

  async create(wallet: Wallet): Promise<Wallet> {
    await this.pool.query(
      `INSERT INTO wallets (id, vault_id, name, key_id, chain, algorithm, address, public_key,
        wrapped_private_key, balance, currency, status, metadata, policy_ids, created_at, updated_at,
        derivation_path, hd_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [wallet.id, wallet.vaultId, wallet.name, wallet.keyId, wallet.chain, wallet.algorithm,
       wallet.address, wallet.publicKey, wallet.wrappedPrivateKey || null,
       wallet.balance.toString(), wallet.currency, wallet.status,
       JSON.stringify(wallet.metadata), JSON.stringify(wallet.policyIds),
       wallet.createdAt, wallet.updatedAt,
       wallet.derivationPath || null, wallet.hdVersion || null]
    );
    return wallet;
  }

  async findById(id: string): Promise<Wallet | null> {
    const { rows } = await this.pool.query('SELECT * FROM wallets WHERE id = $1', [id]);
    return rows[0] ? this.toWallet(rows[0]) : null;
  }

  async findAll(): Promise<Wallet[]> {
    const { rows } = await this.pool.query('SELECT * FROM wallets ORDER BY created_at DESC');
    return rows.map(r => this.toWallet(r));
  }

  async update(id: string, updates: Partial<Wallet>): Promise<Wallet> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (updates.name !== undefined)              { sets.push(`name = $${i++}`);               vals.push(updates.name); }
    if (updates.balance !== undefined)            { sets.push(`balance = $${i++}`);            vals.push(updates.balance.toString()); }
    if (updates.status !== undefined)             { sets.push(`status = $${i++}`);             vals.push(updates.status); }
    if (updates.policyIds !== undefined)          { sets.push(`policy_ids = $${i++}`);         vals.push(JSON.stringify(updates.policyIds)); }
    if (updates.metadata !== undefined)           { sets.push(`metadata = $${i++}`);           vals.push(JSON.stringify(updates.metadata)); }
    if (updates.wrappedPrivateKey !== undefined)  { sets.push(`wrapped_private_key = $${i++}`); vals.push(updates.wrappedPrivateKey); }

    sets.push(`updated_at = $${i++}`);
    vals.push(new Date());
    vals.push(id);

    await this.pool.query(`UPDATE wallets SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    const wallet = await this.findById(id);
    if (!wallet) throw new Error('Wallet not found after update');
    return wallet;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM wallets WHERE id = $1', [id]);
  }

  private toWallet(row: any): Wallet {
    return {
      id:               row.id,
      vaultId:          row.vault_id || '',
      name:             row.name,
      keyId:            row.key_id,
      chain:            row.chain,
      algorithm:        row.algorithm,
      address:          row.address,
      publicKey:        row.public_key,
      wrappedPrivateKey: row.wrapped_private_key || undefined,
      derivationPath:   row.derivation_path || undefined,
      hdVersion:        row.hd_version || undefined,
      balance:          BigInt(row.balance || '0'),
      currency:         row.currency,
      status:           row.status,
      metadata:         row.metadata || {},
      policyIds:        row.policy_ids || [],
      createdAt:        new Date(row.created_at),
      updatedAt:        new Date(row.updated_at),
    };
  }
}
