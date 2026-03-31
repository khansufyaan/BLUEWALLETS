import { Role } from '../types/rbac';
import { IRoleStore } from '../types/store';

export class InMemoryRoleStore implements IRoleStore {
  private roles = new Map<string, Role>();

  async create(role: Role): Promise<Role> {
    this.roles.set(role.id, role);
    return role;
  }

  async findById(id: string): Promise<Role | null> {
    return this.roles.get(id) || null;
  }

  async findAll(): Promise<Role[]> {
    return Array.from(this.roles.values());
  }

  async update(id: string, partial: Partial<Role>): Promise<Role> {
    const existing = this.roles.get(id);
    if (!existing) throw new Error(`Role not found: ${id}`);
    const updated = { ...existing, ...partial, updatedAt: new Date() };
    this.roles.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.roles.delete(id);
  }
}
