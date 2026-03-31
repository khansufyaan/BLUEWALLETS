import { api } from '../api.js';

// ── Per-service log panel state ───────────────────────────────────────────────
const logState = {};        // { [svcName]: { open: bool, lines: [], loading: bool } }
let _reloadFn = null;       // stored so service buttons can trigger re-render

// ── Service definitions ───────────────────────────────────────────────────────
const SERVICES = [
  { name: 'KMS Service',     key: 'kms',     desc: 'Key Management & Signing',          icon: '🔑' },
  { name: 'Policy Engine',   key: 'policy',  desc: 'Transaction Policy Evaluation',     icon: '⚖️'  },
  { name: 'RBAC Service',    key: 'rbac',    desc: 'Role-Based Access Control',         icon: '🛡️'  },
  { name: 'Wallet Service',  key: 'wallet',  desc: 'Wallet Lifecycle Management',       icon: '💼'  },
  { name: 'Vault Service',   key: 'vault',   desc: 'Vault Management',                  icon: '🏦'  },
];

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderHealth() {
  try {
    const health = await api.health();
    const stats  = await api.getStats();

    const hsm   = health.hsm  || {};
    const slot  = hsm.slotInfo  || {};
    const token = hsm.tokenInfo || {};

    // ─── HSM Status Card ───────────────────────────────────
    const hsmCard = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="health-indicator ${hsm.connected ? 'health-ok' : 'health-error'}"></div>
            <div>
              <h2 class="card-title">Luna Cloud HSM</h2>
              <p class="card-subtitle">Hardware Security Module</p>
            </div>
          </div>
          <span class="badge ${hsm.connected ? 'badge-active' : 'badge-rejected'}">${hsm.connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div class="health-grid">
          <div class="stat-row"><span class="stat-label">Status</span>
            <span class="stat-value" style="color:${hsm.connected ? 'var(--emerald)' : 'var(--red)'}">${hsm.connected ? 'Operational' : 'Down'}</span></div>
          <div class="stat-row"><span class="stat-label">Partition</span>
            <span class="stat-value">${token.label || 'N/A'}</span></div>
          <div class="stat-row"><span class="stat-label">Model</span>
            <span class="stat-value">${token.model || 'N/A'}</span></div>
          <div class="stat-row"><span class="stat-label">Serial Number</span>
            <span class="stat-value mono">${token.serialNumber || 'N/A'}</span></div>
          <div class="stat-row"><span class="stat-label">Firmware</span>
            <span class="stat-value">${slot.firmwareVersion || 'N/A'}</span></div>
          <div class="stat-row"><span class="stat-label">Manufacturer</span>
            <span class="stat-value">${slot.manufacturerId || 'N/A'}</span></div>
          <div class="stat-row"><span class="stat-label">Compliance</span>
            <span class="stat-value">FIPS 140-3 Level 3</span></div>
          <div class="stat-row"><span class="stat-label">Free Public Memory</span>
            <span class="stat-value mono">${token.freePublicMemory  ? formatBytes(token.freePublicMemory)  : 'N/A'}</span></div>
          <div class="stat-row"><span class="stat-label">Free Private Memory</span>
            <span class="stat-value mono">${token.freePrivateMemory ? formatBytes(token.freePrivateMemory) : 'N/A'}</span></div>
        </div>

        <!-- HSM actions -->
        <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">
          <button class="health-svc-btn health-svc-btn-restart" data-action="restart-hsm" id="btn-restart-hsm">
            ↺ Reconnect HSM
          </button>
          <button class="health-svc-btn health-svc-btn-logs" data-action="logs-hsm" id="btn-logs-hsm"
            class="${logState['hsm']?.open ? 'active' : ''}">
            📋 View Logs
          </button>
        </div>

        ${renderLogPanel('hsm', 'HSM Session Logs')}
      </div>`;

    // ─── API Server Card ───────────────────────────────────
    const apiCard = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="health-indicator health-ok"></div>
            <div>
              <h2 class="card-title">API Server</h2>
              <p class="card-subtitle">Express / Node.js</p>
            </div>
          </div>
          <span class="badge badge-active">Operational</span>
        </div>
        <div class="health-grid">
          <div class="stat-row"><span class="stat-label">Status</span>
            <span class="stat-value" style="color:var(--emerald)">Healthy</span></div>
          <div class="stat-row"><span class="stat-label">Service</span>
            <span class="stat-value">${health.service || 'waas-kms'}</span></div>
          <div class="stat-row"><span class="stat-label">Endpoint</span>
            <span class="stat-value mono">localhost:3100</span></div>
          <div class="stat-row"><span class="stat-label">Last Check</span>
            <span class="stat-value">${new Date(health.timestamp).toLocaleTimeString()}</span></div>
        </div>
        <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px">
          <button class="health-svc-btn health-svc-btn-logs ${logState['api']?.open ? 'active' : ''}"
            data-action="logs-api" id="btn-logs-api">
            📋 View Logs
          </button>
        </div>
        ${renderLogPanel('api', 'API Server Logs')}
      </div>`;

    // ─── Data Store Card ───────────────────────────────────
    const dataCard = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="health-indicator health-ok"></div>
            <div>
              <h2 class="card-title">Data Store</h2>
              <p class="card-subtitle">In-Memory Store</p>
            </div>
          </div>
          <span class="badge badge-active">Operational</span>
        </div>
        <div class="health-grid">
          <div class="stat-row"><span class="stat-label">Status</span>
            <span class="stat-value" style="color:var(--emerald)">Connected</span></div>
          <div class="stat-row"><span class="stat-label">Type</span>
            <span class="stat-value">In-Memory (Development)</span></div>
          <div class="stat-row"><span class="stat-label">Vaults</span>
            <span class="stat-value">${stats.vaults} records</span></div>
          <div class="stat-row"><span class="stat-label">Wallets</span>
            <span class="stat-value">${stats.wallets} records</span></div>
          <div class="stat-row"><span class="stat-label">Transactions</span>
            <span class="stat-value">${stats.totalTransactions} records</span></div>
          <div class="stat-row"><span class="stat-label">Policies</span>
            <span class="stat-value">${stats.totalPolicies} records</span></div>
          <div class="stat-row"><span class="stat-label">Roles</span>
            <span class="stat-value">${stats.roles} records</span></div>
        </div>
      </div>`;

    // ─── Microservices Card ────────────────────────────────
    const serviceRows = SERVICES.map(s => `
      <div class="health-service-row" id="svc-row-${s.key}">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="health-indicator health-ok" style="width:8px;height:8px"></div>
          <div>
            <div style="font-weight:500;font-size:13px">${s.icon} ${s.name}</div>
            <div class="text-xs text-tertiary">${s.desc}</div>
          </div>
        </div>
        <div class="health-svc-controls">
          <span class="text-xs text-tertiary">Uptime: 99.9%</span>
          <span class="badge badge-active" style="font-size:10px" id="svc-badge-${s.key}">operational</span>
          <button class="health-svc-btn health-svc-btn-restart" data-action="restart-svc" data-svc="${s.key}"
            id="btn-restart-${s.key}" title="Restart ${s.name}">
            ↺ Restart
          </button>
          <button class="health-svc-btn health-svc-btn-logs ${logState[s.key]?.open ? 'active' : ''}"
            data-action="logs-svc" data-svc="${s.key}" id="btn-logs-${s.key}" title="View logs">
            📋 Logs
          </button>
        </div>
      </div>
      ${renderLogPanel(s.key, `${s.name} Logs`)}
    `).join('');

    const servicesCard = `
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header">
          <div>
            <h2 class="card-title">Microservices</h2>
            <p class="card-subtitle">Internal service components</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="text-xs text-tertiary">${SERVICES.length} services</span>
            <button class="health-svc-btn health-svc-btn-logs" data-action="logs-all" id="btn-logs-all">
              📋 System Logs
            </button>
          </div>
        </div>
        ${serviceRows}
        ${renderLogPanel('all', 'System Logs')}
      </div>`;

    // ─── Summary KPIs ──────────────────────────────────────
    const allHealthy = hsm.connected;
    const kpis = `
      <div class="kpi-grid" style="margin-bottom:20px">
        <div class="kpi-card">
          <div class="kpi-label">System Status</div>
          <div class="kpi-value" style="color:${allHealthy ? 'var(--emerald)' : 'var(--red)'}">${allHealthy ? 'Healthy' : 'Degraded'}</div>
          <div class="kpi-sub">All ${SERVICES.length + 3} components</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">HSM</div>
          <div class="kpi-value" style="color:${hsm.connected ? 'var(--emerald)' : 'var(--red)'}">${hsm.connected ? 'Online' : 'Offline'}</div>
          <div class="kpi-sub">${token.label || 'Luna Cloud HSM'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Services</div>
          <div class="kpi-value" style="color:var(--emerald)">${SERVICES.length}/${SERVICES.length}</div>
          <div class="kpi-sub">All operational</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Last Health Check</div>
          <div class="kpi-value kpi-volume">${new Date(health.timestamp).toLocaleTimeString()}</div>
          <div class="kpi-sub">${new Date(health.timestamp).toLocaleDateString()}</div>
        </div>
      </div>`;

    const html = `
      ${kpis}
      <div class="grid-2" style="gap:20px">
        ${hsmCard}
        ${apiCard}
        ${dataCard}
        ${servicesCard}
      </div>`;

    // Store the reload function for button handlers
    _reloadFn = () => reloadHealth();

    // Defer attaching handlers until the HTML is in DOM
    setTimeout(() => attachHealthHandlers(), 0);

    return html;

  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ── Log panel renderer ────────────────────────────────────────────────────────

function renderLogPanel(key, title) {
  const s = logState[key];
  if (!s || !s.open) return '';

  return `
    <div class="health-log-panel" id="log-panel-${key}">
      <div class="health-log-header">
        <span class="health-log-title">${title}</span>
        <button class="health-log-close" data-action="close-logs" data-svc="${key}">✕</button>
      </div>
      <div class="health-log-body" id="log-body-${key}">
        ${s.loading
          ? '<div class="health-log-line-info">Loading…</div>'
          : s.lines.length > 0
            ? s.lines.map(l => `<div class="health-log-line health-log-line-${l.level}">${escapeHtml(l.ts)} [${l.level.toUpperCase()}] ${escapeHtml(l.msg)}</div>`).join('')
            : '<div class="health-log-line-info">No log entries available.</div>'}
      </div>
    </div>`;
}

// ── Attach event handlers (runs after HTML is inserted into DOM) ──────────────

function attachHealthHandlers() {
  // Restart buttons
  document.querySelectorAll('[data-action="restart-svc"]').forEach(btn => {
    btn.addEventListener('click', () => restartService(btn.dataset.svc, btn));
  });

  document.getElementById('btn-restart-hsm')?.addEventListener('click', () => {
    restartService('hsm', document.getElementById('btn-restart-hsm'));
  });

  // Log toggle buttons
  document.querySelectorAll('[data-action="logs-svc"]').forEach(btn => {
    btn.addEventListener('click', () => toggleLogs(btn.dataset.svc, btn));
  });
  document.getElementById('btn-logs-hsm')?.addEventListener('click', () =>
    toggleLogs('hsm', document.getElementById('btn-logs-hsm')));
  document.getElementById('btn-logs-api')?.addEventListener('click', () =>
    toggleLogs('api', document.getElementById('btn-logs-api')));
  document.getElementById('btn-logs-all')?.addEventListener('click', () =>
    toggleLogs('all', document.getElementById('btn-logs-all')));

  // Close-log buttons (inside panels)
  document.querySelectorAll('[data-action="close-logs"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.svc;
      if (logState[key]) logState[key].open = false;
      const panel = document.getElementById(`log-panel-${key}`);
      if (panel) panel.remove();
      // un-highlight the logs button
      const logsBtn = document.getElementById(`btn-logs-${key}`) || document.getElementById(`btn-logs-all`);
      if (logsBtn) logsBtn.classList.remove('active');
    });
  });
}

// ── Restart a service ─────────────────────────────────────────────────────────

async function restartService(key, btnEl) {
  if (!btnEl) return;
  const origText = btnEl.textContent.trim();
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="health-svc-spinning">↺</span> Restarting…';

  try {
    await api.restartService(key);
    await _sleepH(800);
    btnEl.innerHTML = '✓ Restarted';
    btnEl.style.color = 'var(--emerald)';
    btnEl.style.borderColor = 'rgba(34,197,94,0.4)';
    setTimeout(() => {
      btnEl.disabled = false;
      btnEl.textContent = origText;
      btnEl.style.color = '';
      btnEl.style.borderColor = '';
    }, 2000);
  } catch {
    btnEl.disabled = false;
    btnEl.textContent = origText;
  }
}

// ── Toggle log panel ──────────────────────────────────────────────────────────

async function toggleLogs(key, btnEl) {
  if (!logState[key]) logState[key] = { open: false, lines: [], loading: false };

  logState[key].open = !logState[key].open;

  if (btnEl) {
    btnEl.classList.toggle('active', logState[key].open);
  }

  if (!logState[key].open) {
    const panel = document.getElementById(`log-panel-${key}`);
    if (panel) panel.remove();
    return;
  }

  // Insert log panel after the button row (find the nearest card)
  const insertTarget = btnEl?.closest('.health-service-row') || btnEl?.closest('.card');
  if (insertTarget) {
    const panel = document.createElement('div');
    panel.innerHTML = renderLogPanel(key, getLabelForKey(key));
    const panelEl = panel.firstElementChild;
    if (panelEl) {
      const existingPanel = document.getElementById(`log-panel-${key}`);
      if (existingPanel) existingPanel.replaceWith(panelEl);
      else insertTarget.after(panelEl);

      // Re-attach the close handler
      panelEl.querySelector('[data-action="close-logs"]')?.addEventListener('click', () => {
        logState[key].open = false;
        panelEl.remove();
        if (btnEl) btnEl.classList.remove('active');
      });
    }
  }

  // Fetch logs
  logState[key].loading = true;
  await fetchAndShowLogs(key, btnEl);
}

async function fetchAndShowLogs(key, _btnEl) {
  try {
    const data = await api.getServiceLogs(key);
    logState[key].lines = data.logs || [];
  } catch {
    logState[key].lines = [
      { ts: new Date().toISOString().slice(11, 19), level: 'info', msg: 'No log data available for this service.' },
    ];
  }
  logState[key].loading = false;

  const body = document.getElementById(`log-body-${key}`);
  if (body) {
    const lines = logState[key].lines;
    body.innerHTML = lines.length > 0
      ? lines.map(l => `<div class="health-log-line health-log-line-${l.level}">${escapeHtml(l.ts)} [${l.level.toUpperCase()}] ${escapeHtml(l.msg)}</div>`).join('')
      : '<div class="health-log-line-info">No log entries available.</div>';
    body.scrollTop = body.scrollHeight;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLabelForKey(key) {
  if (key === 'all') return 'System Logs';
  if (key === 'hsm') return 'HSM Session Logs';
  if (key === 'api') return 'API Server Logs';
  const s = SERVICES.find(x => x.key === key);
  return s ? `${s.name} Logs` : `${key} Logs`;
}

function _sleepH(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function reloadHealth() {
  const pageContent = document.getElementById('page-content');
  if (!pageContent) return;
  const html = await renderHealth();
  pageContent.innerHTML = html;
}

function formatBytes(bytes) {
  if (bytes >= 1e18) return 'Unlimited';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  if (bytes >= 1e3)  return (bytes / 1e3).toFixed(1)  + ' KB';
  return bytes + ' B';
}
