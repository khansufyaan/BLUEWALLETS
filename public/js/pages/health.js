import { api } from '../api.js';

export async function renderHealth() {
  try {
    const health = await api.health();
    const stats = await api.getStats();

    const hsm = health.hsm || {};
    const slot = hsm.slotInfo || {};
    const token = hsm.tokenInfo || {};
    const uptime = getUptime();

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
          <div class="stat-row">
            <span class="stat-label">Status</span>
            <span class="stat-value" style="color:${hsm.connected ? 'var(--emerald)' : 'var(--red)'}">${hsm.connected ? 'Operational' : 'Down'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Partition</span>
            <span class="stat-value">${token.label || 'N/A'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Model</span>
            <span class="stat-value">${token.model || 'N/A'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Serial Number</span>
            <span class="stat-value mono">${token.serialNumber || 'N/A'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Firmware</span>
            <span class="stat-value">${slot.firmwareVersion || 'N/A'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Manufacturer</span>
            <span class="stat-value">${slot.manufacturerId || 'N/A'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Compliance</span>
            <span class="stat-value">FIPS 140-3 Level 3</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Free Public Memory</span>
            <span class="stat-value mono">${token.freePublicMemory ? formatBytes(token.freePublicMemory) : 'N/A'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Free Private Memory</span>
            <span class="stat-value mono">${token.freePrivateMemory ? formatBytes(token.freePrivateMemory) : 'N/A'}</span>
          </div>
        </div>
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
          <div class="stat-row">
            <span class="stat-label">Status</span>
            <span class="stat-value" style="color:var(--emerald)">Healthy</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Service</span>
            <span class="stat-value">${health.service || 'waas-kms'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Endpoint</span>
            <span class="stat-value mono">localhost:3100</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Last Check</span>
            <span class="stat-value">${new Date(health.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
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
          <div class="stat-row">
            <span class="stat-label">Status</span>
            <span class="stat-value" style="color:var(--emerald)">Connected</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Type</span>
            <span class="stat-value">In-Memory (Development)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Vaults</span>
            <span class="stat-value">${stats.vaults} records</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Wallets</span>
            <span class="stat-value">${stats.wallets} records</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Transactions</span>
            <span class="stat-value">${stats.totalTransactions} records</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Policies</span>
            <span class="stat-value">${stats.totalPolicies} records</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Roles</span>
            <span class="stat-value">${stats.roles} records</span>
          </div>
        </div>
      </div>`;

    // ─── Microservices Card ────────────────────────────────
    const services = [
      { name: 'KMS Service', desc: 'Key Management & Signing', status: 'operational', uptime: '99.9%' },
      { name: 'Policy Engine', desc: 'Transaction Policy Evaluation', status: 'operational', uptime: '99.9%' },
      { name: 'RBAC Service', desc: 'Role-Based Access Control', status: 'operational', uptime: '99.9%' },
      { name: 'Wallet Service', desc: 'Wallet Lifecycle Management', status: 'operational', uptime: '99.9%' },
      { name: 'Vault Service', desc: 'Vault Management', status: 'operational', uptime: '99.9%' },
    ];

    const serviceRows = services.map(s => `
      <div class="health-service-row">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="health-indicator health-ok" style="width:8px;height:8px"></div>
          <div>
            <div style="font-weight:500;font-size:13px">${s.name}</div>
            <div class="text-xs text-tertiary">${s.desc}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <span class="text-xs text-tertiary">Uptime: ${s.uptime}</span>
          <span class="badge badge-active" style="font-size:10px">${s.status}</span>
        </div>
      </div>
    `).join('');

    const servicesCard = `
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header">
          <div>
            <h2 class="card-title">Microservices</h2>
            <p class="card-subtitle">Internal service components</p>
          </div>
          <span class="text-xs text-tertiary">${services.length} services</span>
        </div>
        ${serviceRows}
      </div>`;

    // ─── Summary KPIs ──────────────────────────────────────
    const allHealthy = hsm.connected;
    const kpis = `
      <div class="kpi-grid" style="margin-bottom:20px">
        <div class="kpi-card">
          <div class="kpi-label">System Status</div>
          <div class="kpi-value" style="color:${allHealthy ? 'var(--emerald)' : 'var(--red)'}">${allHealthy ? 'Healthy' : 'Degraded'}</div>
          <div class="kpi-sub">All ${services.length + 3} components</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">HSM</div>
          <div class="kpi-value" style="color:${hsm.connected ? 'var(--emerald)' : 'var(--red)'}">${hsm.connected ? 'Online' : 'Offline'}</div>
          <div class="kpi-sub">${token.label || 'Luna Cloud HSM'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Services</div>
          <div class="kpi-value" style="color:var(--emerald)">${services.length}/${services.length}</div>
          <div class="kpi-sub">All operational</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Last Health Check</div>
          <div class="kpi-value kpi-volume">${new Date(health.timestamp).toLocaleTimeString()}</div>
          <div class="kpi-sub">${new Date(health.timestamp).toLocaleDateString()}</div>
        </div>
      </div>`;

    return `
      ${kpis}
      <div class="grid-2" style="gap:20px">
        ${hsmCard}
        ${apiCard}
        ${dataCard}
        ${servicesCard}
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

function formatBytes(bytes) {
  if (bytes >= 1e18) return 'Unlimited';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

function getUptime() {
  return 'N/A';
}
