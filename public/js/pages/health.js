import { api } from '../api.js';

// ── Per-service log panel state ────────────────────────────────────────────────
const logState = {};  // { [key]: { open: bool, lines: [], loading: bool } }

// ── Service definitions ────────────────────────────────────────────────────────
const SERVICES = [
  { name: 'KMS Service',     key: 'kms',     desc: 'Key Management & Signing',        icon: '🔑' },
  { name: 'Policy Engine',   key: 'policy',  desc: 'Transaction Policy Evaluation',   icon: '⚖️'  },
  { name: 'RBAC Service',    key: 'rbac',    desc: 'Role-Based Access Control',       icon: '🛡️'  },
  { name: 'Wallet Service',  key: 'wallet',  desc: 'Wallet Lifecycle Management',     icon: '💼'  },
  { name: 'Vault Service',   key: 'vault',   desc: 'Vault Management',                icon: '🏦'  },
];

// ── Main render ────────────────────────────────────────────────────────────────
export async function renderHealth() {
  try {
    const [health, stats] = await Promise.all([api.health(), api.getStats()]);

    const hsm   = health.hsm  || {};
    const slot  = hsm.slotInfo  || {};
    const token = hsm.tokenInfo || {};
    const allHealthy = hsm.connected;
    const checkedAt  = new Date(health.timestamp);

    // ── Status Banner ──────────────────────────────────────
    const banner = `
      <div class="h-banner ${allHealthy ? 'h-banner-ok' : 'h-banner-warn'}">
        <div class="h-banner-left">
          <div class="h-status-dot ${allHealthy ? 'h-dot-ok' : 'h-dot-warn'}"></div>
          <span class="h-banner-title">${allHealthy ? 'All Systems Operational' : 'System Degraded'}</span>
          <span class="h-banner-sep">·</span>
          <span class="h-banner-sub">${SERVICES.length + 3} components monitored</span>
        </div>
        <div class="h-banner-right">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 4v2.5L7.5 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Last check: <strong>${checkedAt.toLocaleTimeString()}</strong>
        </div>
      </div>`;

    // ── HSM Card ───────────────────────────────────────────
    const hsmCard = `
      <div class="card h-card">
        <div class="h-card-header">
          <div class="h-card-icon-wrap ${hsm.connected ? 'h-icon-ok' : 'h-icon-err'}">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="8" width="14" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M6 8V6a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <div class="h-card-title-wrap">
            <div class="h-card-title">Luna Cloud HSM</div>
            <div class="h-card-sub">FIPS 140-3 Level 3 · PKCS#11</div>
          </div>
          <span class="h-pill ${hsm.connected ? 'h-pill-ok' : 'h-pill-err'}">${hsm.connected ? 'Connected' : 'Offline'}</span>
        </div>

        <div class="h-stat-grid">
          <div class="h-stat"><span class="h-stat-label">Partition</span><span class="h-stat-value">${token.label || '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Model</span><span class="h-stat-value">${token.model || '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Serial</span><span class="h-stat-value mono text-xs">${token.serialNumber || '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Firmware</span><span class="h-stat-value">${slot.firmwareVersion || '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Free (pub)</span><span class="h-stat-value mono">${token.freePublicMemory  ? formatBytes(token.freePublicMemory)  : '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Free (priv)</span><span class="h-stat-value mono">${token.freePrivateMemory ? formatBytes(token.freePrivateMemory) : '—'}</span></div>
        </div>

        <div class="h-card-actions">
          <button class="h-btn h-btn-primary" data-action="restart-svc" data-svc="hsm" id="btn-restart-hsm">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 6A4 4 0 112 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 3v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Reconnect
          </button>
          <button class="h-btn h-btn-ghost" id="btn-change-pin-toggle">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="5" width="10" height="6" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 5V3.5a2 2 0 014 0V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Change PIN
          </button>
          <button class="h-btn h-btn-ghost" data-action="logs-svc" data-svc="hsm" id="btn-logs-hsm">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 5h6M3 7h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Logs
          </button>
        </div>

        <!-- PIN Change Panel (hidden by default) -->
        <div class="h-pin-panel" id="hsm-pin-panel" style="display:none">
          <div class="h-pin-panel-header">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="6" width="12" height="7" rx="2" stroke="#F59E0B" stroke-width="1.2"/><path d="M4 6V4a3 3 0 016 0v2" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="9.5" r="1" fill="#F59E0B"/></svg>
            <span>Change HSM Partition User PIN</span>
          </div>
          <div class="h-pin-panel-hint">
            Use this if you see <code>CKR_PIN_EXPIRED</code> on the entropy step.
            Enter the current (expired) PIN and your new PIN below.
          </div>
          <div class="h-pin-fields">
            <div class="h-pin-field">
              <label class="h-pin-label">Current PIN</label>
              <input class="h-pin-input" id="hsm-current-pin" type="password" placeholder="Current or expired PIN" autocomplete="current-password">
            </div>
            <div class="h-pin-field">
              <label class="h-pin-label">New PIN</label>
              <input class="h-pin-input" id="hsm-new-pin" type="password" placeholder="New PIN (min 4 chars)" autocomplete="new-password">
            </div>
            <div class="h-pin-field">
              <label class="h-pin-label">Confirm New PIN</label>
              <input class="h-pin-input" id="hsm-confirm-pin" type="password" placeholder="Confirm new PIN" autocomplete="new-password">
            </div>
          </div>
          <div id="hsm-pin-error" class="h-pin-error" style="display:none"></div>
          <div id="hsm-pin-success" class="h-pin-success" style="display:none">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="#10B981" stroke-width="1.3"/><path d="M4.5 7l2 2 3-3" stroke="#10B981" stroke-width="1.3" stroke-linecap="round"/></svg>
            PIN changed successfully. HSM reconnected.
          </div>
          <div class="h-pin-actions">
            <button class="h-btn h-btn-ghost h-btn-sm" id="btn-cancel-pin">Cancel</button>
            <button class="h-btn h-btn-pin-submit" id="btn-submit-pin">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              Change PIN
            </button>
          </div>
        </div>

        ${renderLogPanel('hsm', 'HSM Session Logs')}
      </div>`;

    // ── API Server Card ────────────────────────────────────
    const apiCard = `
      <div class="card h-card">
        <div class="h-card-header">
          <div class="h-card-icon-wrap h-icon-ok">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M6 7l2 2-2 2M10 11h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="h-card-title-wrap">
            <div class="h-card-title">API Server</div>
            <div class="h-card-sub">Express · Node.js</div>
          </div>
          <span class="h-pill h-pill-ok">Healthy</span>
        </div>
        <div class="h-stat-grid">
          <div class="h-stat"><span class="h-stat-label">Service</span><span class="h-stat-value">${health.service || 'waas-kms'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Endpoint</span><span class="h-stat-value mono">:3100</span></div>
          <div class="h-stat"><span class="h-stat-label">Uptime</span><span class="h-stat-value">—</span></div>
          <div class="h-stat"><span class="h-stat-label">Requests</span><span class="h-stat-value">—</span></div>
        </div>
        <div class="h-card-actions">
          <button class="h-btn h-btn-ghost" data-action="logs-svc" data-svc="api" id="btn-logs-api">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 5h6M3 7h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            View Logs
          </button>
        </div>
        ${renderLogPanel('api', 'API Server Logs')}
      </div>`;

    // ── Data Store Card ────────────────────────────────────
    const dataCard = `
      <div class="card h-card">
        <div class="h-card-header">
          <div class="h-card-icon-wrap h-icon-ok">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <ellipse cx="9" cy="5" rx="6" ry="2.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M3 5v8c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M3 9c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" stroke-width="1.4"/>
            </svg>
          </div>
          <div class="h-card-title-wrap">
            <div class="h-card-title">Data Store</div>
            <div class="h-card-sub">In-Memory · Dev</div>
          </div>
          <span class="h-pill h-pill-ok">Live</span>
        </div>
        <div class="h-stat-grid">
          <div class="h-stat"><span class="h-stat-label">Vaults</span><span class="h-stat-value">${stats.vaults}</span></div>
          <div class="h-stat"><span class="h-stat-label">Wallets</span><span class="h-stat-value">${stats.wallets}</span></div>
          <div class="h-stat"><span class="h-stat-label">Transactions</span><span class="h-stat-value">${stats.totalTransactions}</span></div>
          <div class="h-stat"><span class="h-stat-label">Policies</span><span class="h-stat-value">${stats.totalPolicies}</span></div>
          <div class="h-stat"><span class="h-stat-label">Roles</span><span class="h-stat-value">${stats.roles}</span></div>
          <div class="h-stat"><span class="h-stat-label">Type</span><span class="h-stat-value">Volatile</span></div>
        </div>
      </div>`;

    // ── Microservices Table ────────────────────────────────
    const serviceRows = SERVICES.map(s => `
      <div class="h-svc-row" id="svc-row-${s.key}">
        <div class="h-svc-left">
          <div class="h-dot-ok h-svc-dot"></div>
          <span class="h-svc-icon">${s.icon}</span>
          <div>
            <div class="h-svc-name">${s.name}</div>
            <div class="h-svc-desc">${s.desc}</div>
          </div>
        </div>
        <div class="h-svc-right">
          <span class="h-pill h-pill-ok h-pill-sm">operational</span>
          <button class="h-btn h-btn-primary h-btn-sm" data-action="restart-svc" data-svc="${s.key}"
            id="btn-restart-${s.key}" title="Restart ${s.name}">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M10 6A4 4 0 112 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 3v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Restart
          </button>
          <button class="h-btn h-btn-ghost h-btn-sm" data-action="logs-svc" data-svc="${s.key}"
            id="btn-logs-${s.key}" title="View logs">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 5h6M3 7h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Logs
          </button>
        </div>
      </div>
      ${renderLogPanel(s.key, `${s.name} Logs`)}
    `).join('');

    const servicesCard = `
      <div class="card" style="grid-column: 1 / -1">
        <div class="h-table-header">
          <div>
            <div class="h-card-title">Microservices</div>
            <div class="h-card-sub" style="margin-top:2px">Internal service components — all stateless, in-process</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="h-pill h-pill-ok">${SERVICES.length}/${SERVICES.length} online</span>
            <button class="h-btn h-btn-ghost" data-action="logs-svc" data-svc="all" id="btn-logs-all">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 5h6M3 7h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              System Logs
            </button>
          </div>
        </div>
        <div class="h-svc-table">
          ${serviceRows}
        </div>
        ${renderLogPanel('all', 'System Logs')}
      </div>`;

    const html = `
      ${banner}
      <div class="h-infra-grid">
        ${hsmCard}
        ${apiCard}
        ${dataCard}
      </div>
      ${servicesCard}`;

    setTimeout(() => attachHealthHandlers(), 0);
    return html;

  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ── Log panel renderer ─────────────────────────────────────────────────────────
function renderLogPanel(key, title) {
  const s = logState[key];
  if (!s || !s.open) return '';
  return `
    <div class="h-log-panel" id="log-panel-${key}">
      <div class="h-log-header">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="h-dot-ok" style="width:6px;height:6px;flex-shrink:0"></div>
          <span class="h-log-title">${title}</span>
        </div>
        <button class="h-log-close" data-action="close-logs" data-svc="${key}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="h-log-body" id="log-body-${key}">
        ${s.loading
          ? '<div class="h-log-empty">Loading…</div>'
          : s.lines.length > 0
            ? s.lines.map(l => `<div class="h-log-line h-log-line-${l.level}"><span class="h-log-ts">${escapeHtml(l.ts)}</span><span class="h-log-lvl">${l.level.toUpperCase()}</span>${escapeHtml(l.msg)}</div>`).join('')
            : '<div class="h-log-empty">No log entries found.</div>'}
      </div>
    </div>`;
}

// ── Attach handlers ────────────────────────────────────────────────────────────
function attachHealthHandlers() {
  document.querySelectorAll('[data-action="restart-svc"]').forEach(btn => {
    btn.addEventListener('click', () => restartService(btn.dataset.svc, btn));
  });

  document.querySelectorAll('[data-action="logs-svc"]').forEach(btn => {
    btn.addEventListener('click', () => toggleLogs(btn.dataset.svc, btn));
  });

  // PIN change panel
  const pinToggle = document.getElementById('btn-change-pin-toggle');
  const pinPanel  = document.getElementById('hsm-pin-panel');
  const pinCancel = document.getElementById('btn-cancel-pin');
  const pinSubmit = document.getElementById('btn-submit-pin');

  pinToggle?.addEventListener('click', () => {
    if (pinPanel) pinPanel.style.display = pinPanel.style.display === 'none' ? 'block' : 'none';
  });
  pinCancel?.addEventListener('click', () => {
    if (pinPanel) pinPanel.style.display = 'none';
    ['hsm-current-pin','hsm-new-pin','hsm-confirm-pin'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const errEl = document.getElementById('hsm-pin-error');
    const okEl  = document.getElementById('hsm-pin-success');
    if (errEl) errEl.style.display = 'none';
    if (okEl)  okEl.style.display  = 'none';
  });
  pinSubmit?.addEventListener('click', async () => {
    const currentPin = document.getElementById('hsm-current-pin')?.value?.trim();
    const newPin     = document.getElementById('hsm-new-pin')?.value?.trim();
    const confirmPin = document.getElementById('hsm-confirm-pin')?.value?.trim();
    const errEl = document.getElementById('hsm-pin-error');
    const okEl  = document.getElementById('hsm-pin-success');

    if (errEl) errEl.style.display = 'none';
    if (okEl)  okEl.style.display  = 'none';

    if (!currentPin || !newPin || !confirmPin) {
      if (errEl) { errEl.textContent = 'All fields are required.'; errEl.style.display = 'flex'; }
      return;
    }
    if (newPin !== confirmPin) {
      if (errEl) { errEl.textContent = 'New PINs do not match.'; errEl.style.display = 'flex'; }
      return;
    }
    if (newPin.length < 4) {
      if (errEl) { errEl.textContent = 'New PIN must be at least 4 characters.'; errEl.style.display = 'flex'; }
      return;
    }

    const orig = pinSubmit.innerHTML;
    pinSubmit.disabled = true;
    pinSubmit.innerHTML = `<span style="display:inline-block;animation:spin 0.7s linear infinite">↺</span> Changing…`;

    try {
      await api.changeHsmPin(currentPin, newPin);
      pinSubmit.disabled = false;
      pinSubmit.innerHTML = orig;
      if (okEl) okEl.style.display = 'flex';
      ['hsm-current-pin','hsm-new-pin','hsm-confirm-pin'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    } catch (err) {
      pinSubmit.disabled = false;
      pinSubmit.innerHTML = orig;
      if (errEl) {
        errEl.textContent = err.message || 'PIN change failed.';
        errEl.style.display = 'flex';
      }
    }
  });

  document.querySelectorAll('[data-action="close-logs"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.svc;
      if (logState[key]) logState[key].open = false;
      document.getElementById(`log-panel-${key}`)?.remove();
      document.getElementById(`btn-logs-${key}`)?.classList.remove('active');
    });
  });
}

// ── Restart a service ──────────────────────────────────────────────────────────
async function restartService(key, btnEl) {
  if (!btnEl) return;
  const orig = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = `<span style="display:inline-block;animation:spin 0.7s linear infinite">↺</span> Restarting…`;
  try {
    await api.restartService(key);
    await _sleep(700);
    btnEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Done`;
    btnEl.style.color = 'var(--emerald)';
    btnEl.style.borderColor = 'rgba(16,185,129,0.3)';
    setTimeout(() => {
      btnEl.disabled = false;
      btnEl.innerHTML = orig;
      btnEl.style.color = '';
      btnEl.style.borderColor = '';
    }, 2000);
  } catch {
    btnEl.disabled = false;
    btnEl.innerHTML = orig;
  }
}

// ── Toggle log panel ───────────────────────────────────────────────────────────
async function toggleLogs(key, btnEl) {
  if (!logState[key]) logState[key] = { open: false, lines: [], loading: false };
  logState[key].open = !logState[key].open;
  btnEl?.classList.toggle('active', logState[key].open);

  if (!logState[key].open) {
    document.getElementById(`log-panel-${key}`)?.remove();
    return;
  }

  // Insert log panel after the button row
  const anchor = btnEl?.closest('.h-svc-row') || btnEl?.closest('.card');
  if (anchor) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderLogPanel(key, getLabelForKey(key));
    const panelEl = wrapper.firstElementChild;
    if (panelEl) {
      document.getElementById(`log-panel-${key}`)?.replaceWith(panelEl) || anchor.after(panelEl);
      // Re-attach close handler
      panelEl.querySelector('[data-action="close-logs"]')?.addEventListener('click', () => {
        logState[key].open = false;
        panelEl.remove();
        btnEl?.classList.remove('active');
      });
    }
  }

  logState[key].loading = true;
  await fetchLogs(key);
}

async function fetchLogs(key) {
  try {
    const data = await api.getServiceLogs(key);
    logState[key].lines = data.logs || [];
  } catch {
    logState[key].lines = [{ ts: new Date().toISOString().slice(11, 19), level: 'info', msg: 'No log data available.' }];
  }
  logState[key].loading = false;
  const body = document.getElementById(`log-body-${key}`);
  if (body) {
    const lines = logState[key].lines;
    body.innerHTML = lines.length > 0
      ? lines.map(l => `<div class="h-log-line h-log-line-${l.level}"><span class="h-log-ts">${escapeHtml(l.ts)}</span><span class="h-log-lvl">${l.level.toUpperCase()}</span>${escapeHtml(l.msg)}</div>`).join('')
      : '<div class="h-log-empty">No log entries found.</div>';
    body.scrollTop = body.scrollHeight;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getLabelForKey(key) {
  if (key === 'all') return 'System Logs';
  if (key === 'hsm') return 'HSM Session Logs';
  if (key === 'api') return 'API Server Logs';
  return (SERVICES.find(x => x.key === key)?.name || key) + ' Logs';
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes >= 1e18) return 'Unlimited';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  if (bytes >= 1e3)  return (bytes / 1e3).toFixed(1)  + ' KB';
  return bytes + ' B';
}
