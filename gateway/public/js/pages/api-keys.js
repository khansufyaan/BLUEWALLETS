/**
 * API Keys Page — manage bank integration API keys.
 *
 * Create, list, and revoke API keys from the ops dashboard.
 * Keys are shown once on creation and never again.
 */

const API_KEYS_URL = '/ops/api-keys';

async function req(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

export async function renderApiKeys() {
  let data = { keys: [], availablePermissions: [] };
  try {
    data = await req(API_KEYS_URL);
  } catch { /* empty state */ }

  const keys = data.keys || [];
  const activeKeys = keys.filter(k => k.active);
  const revokedKeys = keys.filter(k => !k.active);

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">API Keys</h2>
          <p class="card-subtitle">Authentication keys for bank application integration via the Console API (:3300)</p>
        </div>
        <button class="btn-action" id="btn-create-api-key">Create API Key</button>
      </div>

      <!-- Create key form (hidden by default) -->
      <div id="create-key-form" style="display:none;margin-bottom:var(--sp-4);padding:var(--sp-4);background:var(--bg-elevated);border-radius:var(--r-md)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4);margin-bottom:var(--sp-4)">
          <div>
            <label class="field-label">Key Name</label>
            <input type="text" class="field-input" id="new-key-name" placeholder="e.g. Production, Staging, CI/CD">
          </div>
          <div>
            <label class="field-label">Expiry (optional)</label>
            <input type="date" class="field-input" id="new-key-expiry">
          </div>
        </div>
        <div style="margin-bottom:var(--sp-4)">
          <label class="field-label">Permissions</label>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-2)">
            ${(data.availablePermissions || []).map(p => `
              <label style="display:flex;align-items:center;gap:var(--sp-2);font-size:12px;color:var(--text-secondary);cursor:pointer">
                <input type="checkbox" class="perm-checkbox" value="${p}" checked>
                <code style="font-size:11px">${p}</code>
              </label>
            `).join('')}
          </div>
        </div>
        <div style="display:flex;gap:var(--sp-3)">
          <button class="btn-action" id="btn-confirm-create">Generate Key</button>
          <button class="btn-ghost" id="btn-cancel-create">Cancel</button>
        </div>
      </div>

      <!-- Secret reveal panel (shown once after creation) -->
      <div id="key-reveal" style="display:none;margin-bottom:var(--sp-4);padding:var(--sp-4);background:var(--bg-elevated);border:1px solid var(--amber);border-radius:var(--r-md)">
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l7 14H1L8 1z" fill="var(--amber)" opacity="0.2"/><path d="M8 1l7 14H1L8 1z" stroke="var(--amber)" stroke-width="1.2"/><path d="M8 6v3M8 11h.01" stroke="var(--amber)" stroke-width="1.5" stroke-linecap="round"/></svg>
          <strong style="color:var(--amber);font-size:13px">Copy this key now. It will not be shown again.</strong>
        </div>
        <div style="display:flex;gap:var(--sp-2)">
          <code id="revealed-key" style="flex:1;padding:var(--sp-3);background:var(--bg-primary);border-radius:var(--r-sm);font-size:12px;word-break:break-all;color:var(--text-primary)"></code>
          <button class="btn-ghost" id="btn-copy-key" style="white-space:nowrap">Copy</button>
        </div>
        <button class="btn-ghost" id="btn-dismiss-reveal" style="margin-top:var(--sp-3);font-size:12px">Done</button>
      </div>

      <!-- Active keys table -->
      ${activeKeys.length > 0 ? `
        <table class="data-table">
          <thead><tr>
            <th>Name</th><th>Prefix</th><th>Permissions</th><th>Created</th><th>Last Used</th><th>Expires</th><th></th>
          </tr></thead>
          <tbody>
            ${activeKeys.map(k => `
              <tr>
                <td><strong>${esc(k.name)}</strong></td>
                <td><code style="font-size:11px;color:var(--text-tertiary)">${esc(k.prefix)}...</code></td>
                <td style="font-size:11px;color:var(--text-tertiary)">${k.permissions.length} scopes</td>
                <td class="text-tertiary" style="font-size:11px">${fmtDate(k.createdAt)}</td>
                <td class="text-tertiary" style="font-size:11px">${k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'Never'}</td>
                <td class="text-tertiary" style="font-size:11px">${k.expiresAt ? fmtDate(k.expiresAt) : 'Never'}</td>
                <td><button class="btn-ghost btn-revoke" data-id="${k.id}" data-name="${esc(k.name)}" style="color:var(--red);font-size:11px">Revoke</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : `
        <div style="text-align:center;padding:var(--sp-6);color:var(--text-tertiary)">
          <p style="margin-bottom:var(--sp-2)">No active API keys</p>
          <p style="font-size:12px">Create an API key to allow bank applications to authenticate with the Console API.</p>
        </div>
      `}

      ${revokedKeys.length > 0 ? `
        <details style="margin-top:var(--sp-4)">
          <summary style="cursor:pointer;font-size:12px;color:var(--text-tertiary)">
            ${revokedKeys.length} revoked key${revokedKeys.length > 1 ? 's' : ''}
          </summary>
          <table class="data-table" style="margin-top:var(--sp-2);opacity:0.6">
            <tbody>
              ${revokedKeys.map(k => `
                <tr>
                  <td style="text-decoration:line-through">${esc(k.name)}</td>
                  <td><code style="font-size:11px">${esc(k.prefix)}...</code></td>
                  <td class="text-tertiary" style="font-size:11px">Revoked ${fmtDate(k.revokedAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </details>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Usage</h2>
          <p class="card-subtitle">How to authenticate with the bank-facing API</p>
        </div>
      </div>
      <div style="padding:var(--sp-3) var(--sp-4);background:var(--bg-elevated);border-radius:var(--r-md);font-size:12px;line-height:1.8">
        <strong style="color:var(--text-secondary)">Option A — X-Api-Key header</strong><br>
        <code style="color:var(--text-secondary)">curl -H "X-Api-Key: blue_..." https://console:3300/api/v1/wallets</code><br><br>
        <strong style="color:var(--text-secondary)">Option B — Authorization header</strong><br>
        <code style="color:var(--text-secondary)">curl -H "Authorization: Bearer blue_..." https://console:3300/api/v1/wallets</code>
      </div>
    </div>
  `;
}

export function initApiKeys() {
  setTimeout(() => {
    // Show/hide create form
    document.getElementById('btn-create-api-key')?.addEventListener('click', () => {
      document.getElementById('create-key-form').style.display = 'block';
      document.getElementById('btn-create-api-key').style.display = 'none';
    });
    document.getElementById('btn-cancel-create')?.addEventListener('click', () => {
      document.getElementById('create-key-form').style.display = 'none';
      document.getElementById('btn-create-api-key').style.display = '';
    });

    // Create key
    document.getElementById('btn-confirm-create')?.addEventListener('click', async () => {
      const name = document.getElementById('new-key-name').value.trim();
      if (!name) { alert('Name is required'); return; }

      const permissions = [...document.querySelectorAll('.perm-checkbox:checked')].map(c => c.value);
      const expiryVal = document.getElementById('new-key-expiry').value;
      const expiresAt = expiryVal ? new Date(expiryVal).toISOString() : undefined;

      try {
        const result = await req(API_KEYS_URL, {
          method: 'POST',
          body: JSON.stringify({ name, permissions, expiresAt }),
        });

        // Show the key
        document.getElementById('create-key-form').style.display = 'none';
        document.getElementById('key-reveal').style.display = 'block';
        document.getElementById('revealed-key').textContent = result.key;
      } catch (e) {
        alert('Failed to create API key');
      }
    });

    // Copy key
    document.getElementById('btn-copy-key')?.addEventListener('click', () => {
      const key = document.getElementById('revealed-key').textContent;
      navigator.clipboard.writeText(key).then(() => {
        document.getElementById('btn-copy-key').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('btn-copy-key').textContent = 'Copy'; }, 2000);
      });
    });

    // Dismiss reveal → re-render in place (no full page reload)
    document.getElementById('btn-dismiss-reveal')?.addEventListener('click', async () => {
      try {
        const container = document.getElementById('page-content');
        if (container) {
          container.innerHTML = await renderApiKeys();
          initApiKeys();
        }
      } catch {
        document.getElementById('key-reveal').style.display = 'none';
        document.getElementById('btn-create-api-key').style.display = '';
      }
    });

    // Revoke buttons
    document.querySelectorAll('.btn-revoke').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (!confirm(`Revoke API key "${name}"? Any applications using this key will lose access immediately.`)) return;
        try {
          await req(`${API_KEYS_URL}/${id}`, { method: 'DELETE' });
          const container = document.getElementById('page-content');
          if (container) {
            container.innerHTML = await renderApiKeys();
            initApiKeys();
          }
        } catch {
          alert('Failed to revoke key');
        }
      });
    });
  }, 50);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
