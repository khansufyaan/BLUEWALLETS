// ─── Permissions (Operations) ────────────────────────────
// Following DFNS pattern: Resource:Action
export type Permission =
  // Vault operations
  | 'Vaults:Create' | 'Vaults:Read' | 'Vaults:Update' | 'Vaults:Archive'
  // Wallet operations
  | 'Wallets:Create' | 'Wallets:Read' | 'Wallets:Transfer' | 'Wallets:Archive'
  // Key operations
  | 'Keys:Create' | 'Keys:Read' | 'Keys:Sign' | 'Keys:Delete'
  // Policy operations
  | 'Policies:Create' | 'Policies:Read' | 'Policies:Update' | 'Policies:Delete'
  | 'Policies:Attach' | 'Policies:Approve'
  // Role operations
  | 'Roles:Create' | 'Roles:Read' | 'Roles:Update' | 'Roles:Delete' | 'Roles:Assign'
  // User/auth operations
  | 'Users:Create' | 'Users:Read' | 'Users:Update' | 'Users:Deactivate'
  // Audit
  | 'AuditLogs:Read';

export const ALL_PERMISSIONS: Permission[] = [
  'Vaults:Create', 'Vaults:Read', 'Vaults:Update', 'Vaults:Archive',
  'Wallets:Create', 'Wallets:Read', 'Wallets:Transfer', 'Wallets:Archive',
  'Keys:Create', 'Keys:Read', 'Keys:Sign', 'Keys:Delete',
  'Policies:Create', 'Policies:Read', 'Policies:Update', 'Policies:Delete',
  'Policies:Attach', 'Policies:Approve',
  'Roles:Create', 'Roles:Read', 'Roles:Update', 'Roles:Delete', 'Roles:Assign',
  'Users:Create', 'Users:Read', 'Users:Update', 'Users:Deactivate',
  'AuditLogs:Read',
];

// Group permissions by resource for display
export const PERMISSION_GROUPS: Record<string, Permission[]> = {
  Vaults: ['Vaults:Create', 'Vaults:Read', 'Vaults:Update', 'Vaults:Archive'],
  Wallets: ['Wallets:Create', 'Wallets:Read', 'Wallets:Transfer', 'Wallets:Archive'],
  Keys: ['Keys:Create', 'Keys:Read', 'Keys:Sign', 'Keys:Delete'],
  Policies: ['Policies:Create', 'Policies:Read', 'Policies:Update', 'Policies:Delete', 'Policies:Attach', 'Policies:Approve'],
  Roles: ['Roles:Create', 'Roles:Read', 'Roles:Update', 'Roles:Delete', 'Roles:Assign'],
  Users: ['Users:Create', 'Users:Read', 'Users:Update', 'Users:Deactivate'],
  Audit: ['AuditLogs:Read'],
};

// ─── Roles ───────────────────────────────────────────────
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isManaged: boolean;       // managed roles can't be edited/deleted
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  permissions?: Permission[];
  status?: 'active' | 'archived';
}

// ─── Users (simple for now) ──────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  roleIds: string[];
  status: 'active' | 'deactivated';
  createdAt: Date;
}

// ─── Default Managed Roles ───────────────────────────────
export const DEFAULT_ROLES: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Admin',
    description: 'Full platform access — create resources, approve transactions, assign roles, and manage user accounts',
    permissions: ALL_PERMISSIONS,
    isManaged: true,
    status: 'active',
  },
  {
    name: 'Operator',
    description: 'Maker — initiate wallets, transfers, and policies. Cannot approve transactions or manage users.',
    permissions: [
      'Vaults:Create', 'Vaults:Read', 'Vaults:Update',
      'Wallets:Create', 'Wallets:Read', 'Wallets:Transfer', 'Wallets:Archive',
      'Keys:Create', 'Keys:Read', 'Keys:Sign',
      'Policies:Create', 'Policies:Read', 'Policies:Update', 'Policies:Attach',
      'Roles:Read', 'Users:Read',
      'AuditLogs:Read',
    ],
    isManaged: true,
    status: 'active',
  },
  {
    name: 'Compliance',
    description: 'Checker — review and approve transactions, policies, and role changes. Cannot initiate transfers or create resources.',
    permissions: [
      'Vaults:Read',
      'Wallets:Read',
      'Keys:Read',
      'Policies:Read', 'Policies:Approve',
      'Roles:Read',
      'Users:Read',
      'AuditLogs:Read',
    ],
    isManaged: true,
    status: 'active',
  },
  {
    name: 'Auditor',
    description: 'Read-only access to all resources with full audit trail visibility for regulatory reporting',
    permissions: [
      'Vaults:Read', 'Wallets:Read', 'Keys:Read',
      'Policies:Read', 'Roles:Read', 'Users:Read',
      'AuditLogs:Read',
    ],
    isManaged: true,
    status: 'active',
  },
];
