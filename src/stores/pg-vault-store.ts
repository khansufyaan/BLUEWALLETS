import { Pool } from 'pg';
import { IVaultStore } from '../types/store';
import { Vault } from '../types/vault';

export class PgVaultStore implements IVaultStore {
  constructor(private pool: Pool) {}

  async create(vault: Vault): Promise<Vault> {
    await this.pool.query(
      `INSERT INTO vaults (id, name, description, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [vault.id, vault.name, vault.description || '', vault.status || 'active', vault.createdAt, vault.updatedAt]
    );
    return vault;
  }

  async findById(id: string): Promise<Vault | null> {
    const { rows } = await this.pool.query('SELECT * FROM vaults WHERE id = $1', [id]);
    return rows[0] ? this.toVault(rows[0]) : null;
  }

  async findAll(): Promise<Vault[]> {
    const { rows } = await this.pool.query('SELECT * FROM vaults ORDER BY created_at DESC');
    return rows.map(r => this.toVault(r));
  }

  async update(id: string, updates: Partial<Vault>): Promise<Vault> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (updates.name !== undefined)        { sets.push(`name = $${i++}`);        vals.push(updates.name); }
    if (updates.description !== undefined) { sets.push(`description = $${i++}`); vals.push(updates.description); }
    if (updates.status !== undefined)      { sets.push(`status = $${i++}`);      vals.push(updates.status); }

    sets.push(`updated_at = $${i++}`);
    vals.push(new Date());
    vals.push(id);

    await this.pool.query(`UPDATE vaults SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    const v = await this.findById(id);
    if (!v) throw new Error('Vault not found');
    return v;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM vaults WHERE id = $1', [id]);
  }

  private toVault(row: any): Vault {
    return {
      id:          row.id,
      name:        row.name,
      description: row.description || '',
      walletIds:   [], // derived from wallets table by vault_id, not stored here
      status:      row.status,
      createdAt:   new Date(row.created_at),
      updatedAt:   new Date(row.updated_at),
    };
  }
}
