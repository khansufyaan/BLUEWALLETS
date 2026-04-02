import { Pool } from 'pg';
import { IRoleStore } from '../types/store';
import { Role } from '../types/rbac';

export class PgRoleStore implements IRoleStore {
  constructor(private pool: Pool) {}

  async create(role: Role): Promise<Role> {
    await this.pool.query(
      `INSERT INTO roles (id, name, description, permissions, status, is_managed, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, permissions=$4, status=$5, updated_at=$8`,
      [role.id, role.name, role.description || '', JSON.stringify(role.permissions),
       role.status, role.isManaged || false, role.createdAt, role.updatedAt]
    );
    return role;
  }

  async findById(id: string): Promise<Role | null> {
    const { rows } = await this.pool.query('SELECT * FROM roles WHERE id = $1', [id]);
    return rows[0] ? this.toRole(rows[0]) : null;
  }

  async findAll(): Promise<Role[]> {
    const { rows } = await this.pool.query('SELECT * FROM roles ORDER BY name');
    return rows.map(r => this.toRole(r));
  }

  async update(id: string, updates: Partial<Role>): Promise<Role> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (updates.name !== undefined)        { sets.push(`name = $${i++}`);        vals.push(updates.name); }
    if (updates.description !== undefined) { sets.push(`description = $${i++}`); vals.push(updates.description); }
    if (updates.permissions !== undefined) { sets.push(`permissions = $${i++}`); vals.push(JSON.stringify(updates.permissions)); }
    if (updates.status !== undefined)      { sets.push(`status = $${i++}`);      vals.push(updates.status); }

    sets.push(`updated_at = $${i++}`);
    vals.push(new Date());
    vals.push(id);

    await this.pool.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    const r = await this.findById(id);
    if (!r) throw new Error('Role not found');
    return r;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM roles WHERE id = $1', [id]);
  }

  private toRole(row: any): Role {
    return {
      id:          row.id,
      name:        row.name,
      description: row.description || '',
      permissions: row.permissions || [],
      status:      row.status,
      isManaged:   row.is_managed || false,
      createdAt:   new Date(row.created_at),
      updatedAt:   new Date(row.updated_at),
    };
  }
}
