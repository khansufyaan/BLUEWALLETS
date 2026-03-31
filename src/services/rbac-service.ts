import { v4 as uuidv4 } from 'uuid';
import { Role, Permission, CreateRoleRequest, UpdateRoleRequest, DEFAULT_ROLES, ALL_PERMISSIONS } from '../types/rbac';
import { IRoleStore } from '../types/store';
import { logger } from '../utils/logger';

export class RbacService {
  constructor(private store: IRoleStore) {}

  /**
   * Seed default managed roles on startup.
   */
  async seedDefaults(): Promise<void> {
    const existing = await this.store.findAll();
    if (existing.length > 0) return;

    for (const roleDef of DEFAULT_ROLES) {
      const role: Role = {
        id: uuidv4(),
        ...roleDef,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.store.create(role);
      logger.info('Seeded default role', { roleId: role.id, name: role.name });
    }
  }

  async createRole(req: CreateRoleRequest): Promise<Role> {
    // Validate permissions
    for (const perm of req.permissions) {
      if (!ALL_PERMISSIONS.includes(perm)) {
        throw new Error(`Invalid permission: ${perm}`);
      }
    }

    const role: Role = {
      id: uuidv4(),
      name: req.name,
      description: req.description || '',
      permissions: req.permissions,
      isManaged: false,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.store.create(role);
    logger.info('Role created', { roleId: role.id, name: role.name });
    return role;
  }

  async getRole(id: string): Promise<Role> {
    const role = await this.store.findById(id);
    if (!role) throw new Error(`Role not found: ${id}`);
    return role;
  }

  async listRoles(): Promise<Role[]> {
    return this.store.findAll();
  }

  async updateRole(id: string, data: UpdateRoleRequest): Promise<Role> {
    const role = await this.getRole(id);
    if (role.isManaged && data.permissions) {
      throw new Error('Cannot modify permissions of managed roles');
    }
    if (data.permissions) {
      for (const perm of data.permissions) {
        if (!ALL_PERMISSIONS.includes(perm)) {
          throw new Error(`Invalid permission: ${perm}`);
        }
      }
    }
    return this.store.update(id, data);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (role.isManaged) throw new Error('Cannot delete managed roles');
    await this.store.delete(id);
    logger.info('Role deleted', { roleId: id });
  }

  /**
   * Check if a set of role IDs grants a specific permission.
   */
  async hasPermission(roleIds: string[], permission: Permission): Promise<boolean> {
    for (const roleId of roleIds) {
      const role = await this.store.findById(roleId);
      if (role && role.status === 'active' && role.permissions.includes(permission)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all permissions from a set of role IDs.
   */
  async getEffectivePermissions(roleIds: string[]): Promise<Permission[]> {
    const perms = new Set<Permission>();
    for (const roleId of roleIds) {
      const role = await this.store.findById(roleId);
      if (role && role.status === 'active') {
        role.permissions.forEach(p => perms.add(p));
      }
    }
    return Array.from(perms);
  }
}
