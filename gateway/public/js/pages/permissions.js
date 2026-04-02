import { api } from '../api.js';

const ACTION_COLORS = {
  create:     { bg: 'rgba(37,99,235,0.1)',   color: 'var(--blue-400)' },
  read:       { bg: 'rgba(16,185,129,0.1)',   color: 'var(--emerald)' },
  update:     { bg: 'rgba(245,158,11,0.1)',   color: 'var(--amber)' },
  delete:     { bg: 'rgba(239,68,68,0.1)',    color: 'var(--red)' },
  archive:    { bg: 'rgba(239,68,68,0.1)',    color: 'var(--red)' },
  deactivate: { bg: 'rgba(239,68,68,0.1)',    color: 'var(--red)' },
  sign:       { bg: 'rgba(139,92,246,0.1)',   color: '#A78BFA' },
  transfer:   { bg: 'rgba(236,72,153,0.1)',   color: '#F472B6' },
  attach:     { bg: 'rgba(14,165,233,0.1)',   color: '#38BDF8' },
  assign:     { bg: 'rgba(14,165,233,0.1)',   color: '#38BDF8' },
  approve:    { bg: 'rgba(16,185,129,0.1)',   color: 'var(--emerald)' },
};

function actionBadge(action) {
  const a = action.toLowerCase();
  const c = ACTION_COLORS[a] || { bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' };
  return `<span class="perm-action-badge" style="background:${c.bg};color:${c.color}">${action}</span>`;
}

function roleHasPerm(roles, perm) {
  return roles.map(r => {
    const has = r.permissions.includes(perm);
    return `<td class="perm-matrix-cell">${has
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--emerald)" stroke-width="2"><path d="M3 7l3 3 5-5"/></svg>'
      : '<span class="perm-matrix-none">&mdash;</span>'
    }</td>`;
  }).join('');
}

export async function renderPermissions() {
  try {
    const [permData, roles] = await Promise.all([
      api.getPermissions(),
      api.getRoles(),
    ]);

    const groups = permData.groups;
    const totalPerms = Object.values(groups).reduce((sum, perms) => sum + perms.length, 0);

    // Role column headers
    const roleHeaders = roles.map(r =>
      `<th class="perm-matrix-role-th"><span class="perm-matrix-role-name">${r.name}</span></th>`
    ).join('');

    // Build grouped rows
    const groupSections = Object.entries(groups).map(([group, perms]) => {
      const rows = perms.map(p => {
        const [, action] = p.split(':');
        return `
          <tr class="perm-row" data-perm="${p.toLowerCase()}">
            <td class="perm-row-name">
              <span class="mono">${p}</span>
              <span class="perm-row-desc">${getPermDescription(p)}</span>
            </td>
            <td>${actionBadge(action)}</td>
            ${roleHasPerm(roles, p)}
          </tr>`;
      }).join('');

      return `
        <tr class="perm-group-row">
          <td colspan="${3 + roles.length}">
            <span class="perm-group-name">${group}</span>
            <span class="perm-group-count">${perms.length}</span>
          </td>
        </tr>
        ${rows}`;
    }).join('');

    return `
      <div class="permissions-page">
        <div class="page-header">
          <div class="page-header-left">
            <h2>Permissions</h2>
            <span class="count-badge">${totalPerms}</span>
          </div>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:16px">
          Permission matrix showing which roles have access to each operation. Pattern: <span class="mono">Resource:Action</span>
        </p>

        <div class="search-wrapper" style="max-width:320px;margin-bottom:16px">
          <span class="search-icon">&#128269;</span>
          <input type="text" class="search-input" id="perm-search" placeholder="Filter permissions...">
        </div>

        <div class="perm-matrix-wrap">
          <table class="perm-matrix">
            <thead>
              <tr>
                <th class="perm-matrix-perm-th">Permission</th>
                <th class="perm-matrix-action-th">Action</th>
                ${roleHeaders}
              </tr>
            </thead>
            <tbody id="perm-matrix-body">
              ${groupSections}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initPermissions() {
  document.getElementById('perm-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.perm-row').forEach(row => {
      row.style.display = row.dataset.perm.includes(q) ? '' : 'none';
    });
    // Hide group headers if all their rows are hidden
    document.querySelectorAll('.perm-group-row').forEach(groupRow => {
      let next = groupRow.nextElementSibling;
      let anyVisible = false;
      while (next && !next.classList.contains('perm-group-row')) {
        if (next.style.display !== 'none') anyVisible = true;
        next = next.nextElementSibling;
      }
      groupRow.style.display = anyVisible ? '' : 'none';
    });
  });
}

function getPermDescription(perm) {
  const map = {
    'Vaults:Create': 'Create new vaults to organize wallets',
    'Vaults:Read': 'View vault details and list vaults',
    'Vaults:Update': 'Modify vault name and settings',
    'Vaults:Archive': 'Archive vaults (soft delete)',
    'Wallets:Create': 'Generate new blockchain wallets with HSM keys',
    'Wallets:Read': 'View wallet details, balances, and addresses',
    'Wallets:Transfer': 'Execute fund transfers between wallets',
    'Wallets:Archive': 'Archive wallets (disable transfers)',
    'Keys:Create': 'Generate cryptographic key pairs in the HSM',
    'Keys:Read': 'View public keys and key metadata',
    'Keys:Sign': 'Request HSM to sign data with private keys',
    'Keys:Delete': 'Permanently remove keys from the HSM',
    'Policies:Create': 'Create new governance policies',
    'Policies:Read': 'View policy rules and configurations',
    'Policies:Update': 'Modify policy rules and settings',
    'Policies:Delete': 'Remove policies permanently',
    'Policies:Attach': 'Attach policies to wallets',
    'Policies:Approve': 'Approve transactions pending policy review',
    'Roles:Create': 'Create custom roles with permissions',
    'Roles:Read': 'View roles and their permissions',
    'Roles:Update': 'Modify role permissions',
    'Roles:Delete': 'Remove custom roles',
    'Roles:Assign': 'Assign or revoke roles from users',
    'Users:Create': 'Create new user accounts',
    'Users:Read': 'View user profiles and assignments',
    'Users:Update': 'Modify user details',
    'Users:Deactivate': 'Deactivate user accounts',
    'AuditLogs:Read': 'View security and activity audit logs',
  };
  return map[perm] || '';
}
