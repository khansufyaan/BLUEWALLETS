/* Users Management Page */

import { api } from '../api.js';

let _users = [];
let _showForm = false;
let _formError = null;
let _creating = false;

export function renderUsers() {
  return `<div class="users-root" id="users-root"></div>`;
}

function renderUsersInner() {
  const roleColors = {
    admin:   'var(--blue-400)',
    officer: 'var(--emerald)',
    auditor: '#F59E0B',
  };

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-5)">
      <div>
        <h2 style="font-size:18px;font-weight:600;margin:0">Users</h2>
        <p style="font-size:13px;color:var(--text-tertiary);margin:4px 0 0">Manage operator accounts and roles</p>
      </div>
      <button class="btn btn-primary" id="add-user-btn" style="font-size:13px">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Add User
      </button>
    </div>

    ${_showForm ? renderCreateForm() : ''}

    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:12px 16px;font-weight:500;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">User</th>
            <th style="text-align:left;padding:12px 16px;font-weight:500;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Role</th>
            <th style="text-align:left;padding:12px 16px;font-weight:500;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Created</th>
          </tr>
        </thead>
        <tbody>
          ${_users.length === 0
            ? `<tr><td colspan="3" style="padding:40px;text-align:center;color:var(--text-tertiary)">Loading...</td></tr>`
            : _users.map(u => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:12px 16px">
                  <div style="display:flex;align-items:center;gap:10px">
                    <div style="width:32px;height:32px;border-radius:50%;background:rgba(37,99,235,0.12);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;color:var(--blue-400)">${(u.displayName || u.username)[0].toUpperCase()}</div>
                    <div>
                      <div style="font-weight:500">${u.displayName}</div>
                      <div style="font-size:11px;color:var(--text-tertiary)">${u.username}</div>
                    </div>
                  </div>
                </td>
                <td style="padding:12px 16px">
                  <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;background:${roleColors[u.role] || 'var(--text-tertiary)'}20;color:${roleColors[u.role] || 'var(--text-tertiary)'}">${u.role}</span>
                </td>
                <td style="padding:12px 16px;color:var(--text-tertiary);font-size:12px">${new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderCreateForm() {
  return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:var(--sp-5);margin-bottom:var(--sp-5)">
      <div style="font-size:14px;font-weight:600;margin-bottom:var(--sp-4)">New User</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-3)">
        <div>
          <label style="display:block;font-size:11px;color:var(--text-tertiary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Username</label>
          <input class="cer-connect-input" id="new-username" type="text" placeholder="jsmith" autocomplete="off">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--text-tertiary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Display Name</label>
          <input class="cer-connect-input" id="new-displayname" type="text" placeholder="Jane Smith" autocomplete="off">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin-bottom:var(--sp-4)">
        <div>
          <label style="display:block;font-size:11px;color:var(--text-tertiary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Role</label>
          <select class="cer-connect-input" id="new-role" style="appearance:auto">
            <option value="officer">Officer</option>
            <option value="admin">Admin</option>
            <option value="auditor">Auditor</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--text-tertiary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Temporary Password</label>
          <input class="cer-connect-input" id="new-password" type="password" placeholder="Min 8 characters" autocomplete="new-password">
        </div>
      </div>
      ${_formError ? `<div style="color:var(--red);font-size:12px;margin-bottom:var(--sp-3)">${_formError}</div>` : ''}
      <div style="display:flex;gap:var(--sp-2)">
        <button class="btn btn-primary" id="save-user-btn" ${_creating ? 'disabled' : ''} style="font-size:13px">
          ${_creating ? 'Creating...' : 'Create User'}
        </button>
        <button class="btn btn-ghost" id="cancel-user-btn" style="font-size:13px">Cancel</button>
      </div>
    </div>`;
}

function rebuild() {
  const root = document.getElementById('users-root');
  if (root) {
    root.innerHTML = renderUsersInner();
    attachHandlers();
  }
}

function attachHandlers() {
  document.getElementById('add-user-btn')?.addEventListener('click', () => {
    _showForm = true;
    _formError = null;
    rebuild();
  });

  document.getElementById('cancel-user-btn')?.addEventListener('click', () => {
    _showForm = false;
    _formError = null;
    rebuild();
  });

  document.getElementById('save-user-btn')?.addEventListener('click', async () => {
    const username    = document.getElementById('new-username')?.value?.trim();
    const displayName = document.getElementById('new-displayname')?.value?.trim();
    const role        = document.getElementById('new-role')?.value;
    const password    = document.getElementById('new-password')?.value;

    if (!username || !displayName || !password) {
      _formError = 'All fields are required';
      rebuild();
      return;
    }
    if (password.length < 8) {
      _formError = 'Password must be at least 8 characters';
      rebuild();
      return;
    }

    _creating = true;
    _formError = null;
    rebuild();

    try {
      await api.createUser({ username, displayName, role, password });
      _showForm = false;
      _creating = false;
      _users = await api.getUsers();
      rebuild();
    } catch (err) {
      _formError = err.message || 'Failed to create user';
      _creating = false;
      rebuild();
    }
  });
}

export async function initUsers() {
  try {
    _users = await api.getUsers();
  } catch {
    _users = [];
  }
  rebuild();
}
