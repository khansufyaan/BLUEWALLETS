import { Pool } from 'pg';
import { IPolicyStore } from '../types/store';
import { Policy } from '../types/policy';

export class PgPolicyStore implements IPolicyStore {
  constructor(private pool: Pool) {}

  async create(policy: Policy): Promise<Policy> {
    await this.pool.query(
      `INSERT INTO policies (id, name, description, rules, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [policy.id, policy.name, policy.description || '', JSON.stringify(policy.rules),
       policy.enabled, policy.createdAt, policy.updatedAt]
    );
    return policy;
  }

  async findById(id: string): Promise<Policy | null> {
    const { rows } = await this.pool.query('SELECT * FROM policies WHERE id = $1', [id]);
    return rows[0] ? this.toPolicy(rows[0]) : null;
  }

  async findAll(): Promise<Policy[]> {
    const { rows } = await this.pool.query('SELECT * FROM policies ORDER BY created_at DESC');
    return rows.map(r => this.toPolicy(r));
  }

  async findByIds(ids: string[]): Promise<Policy[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query(
      'SELECT * FROM policies WHERE id = ANY($1)', [ids]
    );
    return rows.map(r => this.toPolicy(r));
  }

  async update(id: string, updates: Partial<Policy>): Promise<Policy> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (updates.name !== undefined)        { sets.push(`name = $${i++}`);        vals.push(updates.name); }
    if (updates.description !== undefined) { sets.push(`description = $${i++}`); vals.push(updates.description); }
    if (updates.rules !== undefined)       { sets.push(`rules = $${i++}`);       vals.push(JSON.stringify(updates.rules)); }
    if (updates.enabled !== undefined)     { sets.push(`enabled = $${i++}`);     vals.push(updates.enabled); }

    sets.push(`updated_at = $${i++}`);
    vals.push(new Date());
    vals.push(id);

    await this.pool.query(`UPDATE policies SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    const p = await this.findById(id);
    if (!p) throw new Error('Policy not found');
    return p;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM policies WHERE id = $1', [id]);
  }

  private toPolicy(row: any): Policy {
    return {
      id:          row.id,
      name:        row.name,
      description: row.description || '',
      rules:       row.rules || [],
      enabled:     row.enabled,
      createdAt:   new Date(row.created_at),
      updatedAt:   new Date(row.updated_at),
    };
  }
}
