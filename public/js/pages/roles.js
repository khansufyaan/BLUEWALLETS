import { api } from '../api.js';

function getPermAction(perm) {
  return perm.split(':')[1].toLowerCase();
}

function permChip(perm) {
  const action = getPermAction(perm);
  return `<span class="perm-chip perm-chip-${action}">${perm}</span>`;
}

const ROLE_STYLES = {
  'Admin':      { css: 'role-card-admin',      color: '#EF4444', tag: 'Full Access',   tagClass: 'role-tag-admin',      icon: `<path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/>` },
  'Operator':   { css: 'role-card-operator',    color: '#3B82F6', tag: 'Maker',         tagClass: 'role-tag-operator',   icon: `<path d="M5 9l3 3 5-5"/><circle cx="9" cy="9" r="7"/>` },
  'Compliance': { css: 'role-card-compliance',  color: '#F59E0B', tag: 'Checker',       tagClass: 'role-tag-compliance', icon: `<path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/><path d="M6.5 9l2 2 3-3"/>` },
  'Auditor':    { css: 'role-card-auditor',     color: '#8B5CF6', tag: 'Read Only',     tagClass: 'role-tag-auditor',    icon: `<path d="M4 2h10a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M7 7h4M7 10h4M7 13h2"/>` },
};

function getRoleStyle(role) {
  return ROLE_STYLES[role.name] || { css: 'role-card-custom', color: '#10B981', tag: 'Custom', tagClass: 'role-tag-custom', icon: `<circle cx="9" cy="6" r="3"/><path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6"/>` };
}

function getRoleIcon(role) {
  const s = getRoleStyle(role);
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="${s.color}" stroke-width="1.5">${s.icon}</svg>`;
}

function summarizeAccess(perms) {
  const actions = perms.map(p => getPermAction(p));
  const canCreate = actions.some(a => ['create', 'transfer', 'sign'].includes(a));
  const canApprove = actions.includes('approve');
  const canDelete = actions.some(a => ['delete', 'archive', 'deactivate'].includes(a));
  const canAssign = actions.includes('assign');
  const parts = [];
  if (canCreate) parts.push('Initiate');
  if (canApprove) parts.push('Approve');
  if (canDelete) parts.push('Delete');
  if (canAssign) parts.push('Assign');
  if (parts.length === 0) parts.push('Read');
  return parts.join(' / ');
}

export async function renderRoles() {
  try {
    const [roles, permData] = await Promise.all([
      api.getRoles(),
      api.getPermissions(),
    ]);

    const groups = permData.groups;

    const roleCards = roles.map(r => {
      const permCount = r.permissions.length;
      const style = getRoleStyle(r);
      const resources = [...new Set(r.permissions.map(p => p.split(':')[0]))];
      const resourcePills = resources.map(res =>
        `<span class="role-scope-pill">${res}</span>`
      ).join('');

      return `
        <div class="role-card ${style.css}" data-role-id="${r.id}">
          <div class="role-card-top">
            <div class="role-card-identity">
              <div class="role-card-icon-wrap" style="--role-color: ${style.color}">
                ${getRoleIcon(r)}
              </div>
              <div>
                <div class="role-card-name-row">
                  <h3>${r.name}</h3>
                  <span class="role-tag ${style.tagClass}">${style.tag}</span>
                  ${r.isManaged ? '<span class="badge badge-managed">Managed</span>' : ''}
                </div>
                <p class="role-card-desc">${r.description}</p>
              </div>
            </div>
            ${r.status !== 'active' ? `<span class="badge badge-${r.status}">${r.status}</span>` : ''}
          </div>

          <div class="role-card-summary">
            <div class="role-summary-item">
              <span class="role-summary-label">Access</span>
              <span class="role-summary-value">${summarizeAccess(r.permissions)}</span>
            </div>
            <div class="role-summary-item">
              <span class="role-summary-label">Scope</span>
              <div class="role-scope-pills">${resourcePills}</div>
            </div>
            <div class="role-summary-item">
              <span class="role-summary-label">Permissions</span>
              <span class="role-summary-value">${permCount}</span>
            </div>
          </div>

          <div class="role-card-expand-row">
            <button class="role-toggle-btn" data-target="chips-${r.id}">
              <svg class="role-toggle-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg>
              View permissions
            </button>
            ${!r.isManaged ? `<button class="btn btn-ghost btn-sm delete-role-btn" data-id="${r.id}" style="color:var(--red)">Delete</button>` : ''}
          </div>

          <div class="role-card-chips" id="chips-${r.id}">
            ${r.permissions.map(p => permChip(p)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Build accordion permission groups for create form
    const accordions = Object.entries(groups).map(([group, perms]) => {
      const toggles = perms.map(p => {
        const action = getPermAction(p);
        return `
          <label class="toggle-label toggle-${action}">
            <input type="checkbox" class="perm-checkbox" value="${p}">
            <span class="toggle-check"></span>
            <span>${p.split(':')[1]}</span>
          </label>`;
      }).join('');

      return `
        <div class="perm-accordion" data-group="${group}">
          <div class="perm-accordion-header">
            <div class="group-name">
              ${group}
              <span class="group-count">${perms.length}</span>
            </div>
            <span class="chevron">&#9660;</span>
          </div>
          <div class="perm-accordion-body">
            <div class="perm-accordion-actions">
              <button type="button" class="select-all-btn" data-group="${group}">Select all</button>
            </div>
            <div class="perm-accordion-content">
              ${toggles}
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="roles-page">
        <div class="page-header">
          <div class="page-header-left">
            <h2>Roles</h2>
            <span class="count-badge">${roles.length}</span>
          </div>
          <button class="btn btn-primary" id="open-create-role">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:6px">
              <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Create Role
          </button>
        </div>
        ${roles.length >= 6 ? `<div class="search-wrapper">
          <span class="search-icon">&#128269;</span>
          <input type="text" class="search-input" id="role-search" placeholder="Search roles...">
        </div>` : ''}
        <div id="role-list" class="role-grid">
          ${roleCards}
        </div>
      </div>

      <!-- Create Role Modal -->
      <div class="modal-overlay" id="create-role-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <div>
              <h3>Create Role</h3>
              <p class="text-sm text-muted" style="margin-top:2px">Define custom access levels by combining permissions.</p>
            </div>
            <button class="modal-close" id="close-create-role" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div id="role-result"></div>
          <form id="create-role-form">
            <div class="form-group">
              <label class="form-label">Role Name</label>
              <input type="text" class="form-input" id="r-name" placeholder="e.g. Treasury Manager" required>
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input type="text" class="form-input" id="r-desc" placeholder="What this role is for">
            </div>
            <div class="form-group">
              <label class="form-label" style="margin-bottom:8px">Permissions</label>
              <div class="form-help" style="margin-bottom:12px">Click a group to expand. Color-coded: <span style="color:var(--blue-400)">create</span> <span style="color:var(--emerald)">read</span> <span style="color:var(--amber)">update</span> <span style="color:var(--red)">delete</span></div>
              ${accordions}
            </div>
            <div class="modal-actions">
              <span class="text-xs text-tertiary" id="selected-count" style="margin-right:auto">0 permissions selected</span>
              <button type="button" class="btn btn-secondary" id="cancel-create-role">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Role</button>
            </div>
          </form>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initRoles() {
  const modal = document.getElementById('create-role-modal');

  // Open modal
  document.getElementById('open-create-role')?.addEventListener('click', () => {
    modal.classList.add('active');
    setTimeout(() => document.getElementById('r-name')?.focus(), 100);
  });

  // Close modal
  const closeModal = () => {
    modal.classList.remove('active');
    document.getElementById('create-role-form')?.reset();
    document.querySelectorAll('.perm-checkbox').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('.perm-accordion').forEach(a => a.classList.remove('open'));
    updateSelectedCount();
    const r = document.getElementById('role-result');
    if (r) r.innerHTML = '';
  };
  document.getElementById('close-create-role')?.addEventListener('click', closeModal);
  document.getElementById('cancel-create-role')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeModal();
  });

  // Accordion toggle
  document.querySelectorAll('.perm-accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });

  // Select all
  document.querySelectorAll('.select-all-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.dataset.group;
      const accordion = document.querySelector(`.perm-accordion[data-group="${group}"]`);
      const checkboxes = accordion.querySelectorAll('.perm-checkbox');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
      btn.textContent = allChecked ? 'Select all' : 'Deselect all';
      updateSelectedCount();
    });
  });

  // Update permission count on change
  function updateSelectedCount() {
    const count = document.querySelectorAll('.perm-checkbox:checked').length;
    const el = document.getElementById('selected-count');
    if (el) el.textContent = `${count} permission${count !== 1 ? 's' : ''} selected`;
  }

  document.querySelectorAll('.perm-checkbox').forEach(cb => {
    cb.addEventListener('change', updateSelectedCount);
  });

  // Toggle permission chips visibility
  document.querySelectorAll('.role-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const isOpen = target.classList.toggle('expanded');
      btn.querySelector('.role-toggle-chevron').style.transform = isOpen ? 'rotate(180deg)' : '';
      btn.childNodes[btn.childNodes.length - 1].textContent = isOpen ? ' Hide permissions' : ' View permissions';
    });
  });

  // Search roles
  document.getElementById('role-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.role-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Create role
  document.getElementById('create-role-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultDiv = document.getElementById('role-result');
    const perms = Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(cb => cb.value);
    if (perms.length === 0) {
      resultDiv.innerHTML = '<div class="alert alert-warning">Select at least one permission</div>';
      return;
    }

    try {
      await api.createRole({
        name: document.getElementById('r-name').value,
        description: document.getElementById('r-desc').value || undefined,
        permissions: perms,
      });
      resultDiv.innerHTML = '<div class="alert alert-success">Role created!</div>';
      setTimeout(() => { closeModal(); window.dispatchEvent(new HashChangeEvent('hashchange')); }, 600);
    } catch (err) {
      resultDiv.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  // Delete role
  document.querySelectorAll('.delete-role-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.deleteRole(btn.dataset.id);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) { alert(err.message); }
    });
  });
}
