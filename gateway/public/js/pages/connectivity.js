/**
 * Health & Connectivity Page — system-wide health view.
 *
 * Shows:
 *   1. Signer connection status (secure zone ↔ DMZ)
 *   2. Internet connectivity checks
 *   3. RPC node health per chain
 *   4. Compliance vendor API status
 */

async function req(path) {
  const r = await fetch(path);
  return r.json();
}

export async function renderConnectivity() {
  let health;
  try {
    health = await req('/ops/health/full');
  } catch (e) {
    return `
      <div style="text-align:center;padding:var(--sp-8);color:var(--text-tertiary)">
        <div style="font-size:32px;margin-bottom:var(--sp-4)">&#9888;</div>
        <h3 style="color:var(--text-primary);margin-bottom:var(--sp-2)">Health check failed</h3>
        <p style="font-size:13px">${e.message || 'Could not reach health endpoint. The backend may be restarting.'}</p>
      </div>`;
  }

  return `
    ${renderOverallBanner(health)}
    ${renderSignerCard(health.signer)}
    ${renderInternetCard(health.internet)}
    ${renderRpcCards(health.rpcNodes || [])}
    ${renderVendorCard(health.vendors || {})}
  `;
}

function renderOverallBanner(h) {
  const isHealthy = h.overall === 'healthy';
  const color = isHealthy ? 'var(--emerald)' : 'var(--amber)';
  const bg = isHealthy ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)';
  const border = isHealthy ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)';
  const icon = isHealthy ? '✓' : '⚠';

  return `
    <div style="padding:var(--sp-4);background:${bg};border:1px solid ${border};border-radius:var(--r-lg);margin-bottom:var(--sp-6);display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:var(--sp-3)">
        <span style="font-size:20px">${icon}</span>
        <div>
          <div style="font-size:14px;font-weight:600;color:${color}">System ${h.overall === 'healthy' ? 'Healthy' : 'Degraded'}</div>
          <div style="font-size:12px;color:var(--text-tertiary)">Full health check completed in ${h.latencyMs}ms</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-tertiary)">${h.timestamp ? new Date(h.timestamp).toLocaleString() : ''}</div>
    </div>`;
}

function renderSignerCard(signer) {
  const ok = signer?.status === 'connected';
  const isMtls = signer?.mtls === true;
  const transportColor = isMtls ? 'var(--emerald)' : 'var(--amber)';
  const transportBg = isMtls ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)';
  const transportBorder = isMtls ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)';
  const lockIcon = isMtls
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="2" stroke="${transportColor}" stroke-width="1.2"/><path d="M4 6V4a3 3 0 016 0v2" stroke="${transportColor}" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="9.5" r="1" fill="${transportColor}"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="2" stroke="${transportColor}" stroke-width="1.2"/><path d="M10 6V4a3 3 0 00-6 0" stroke="${transportColor}" stroke-width="1.2" stroke-linecap="round"/></svg>`;

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">Signer Connection</h2>
          <p class="card-subtitle">Internal network link to HSM signing server (secure zone — no internet)</p>
        </div>
        <span class="badge ${ok ? 'badge-confirmed' : 'badge-error'}">${ok ? 'Connected' : 'Error'}</span>
      </div>

      <!-- Transport Security Banner -->
      <div style="margin-bottom:var(--sp-4);padding:var(--sp-3) var(--sp-4);background:${transportBg};border:1px solid ${transportBorder};border-radius:var(--r-md);display:flex;align-items:center;gap:var(--sp-3)">
        ${lockIcon}
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:${transportColor}">
            Transport: ${signer?.transport || 'HTTP'}
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">
            ${isMtls
              ? `Mutual TLS active — client cert: <code style="color:var(--text-secondary)">${signer?.certFile || 'console-cert.pem'}</code> · CA: <code style="color:var(--text-secondary)">${signer?.caFile || 'ca.pem'}</code>`
              : `Plaintext HTTP over internal network. Mount certificates and set <code style="color:var(--text-secondary)">MTLS_ENABLED=true</code> to enable mutual TLS.`}
          </div>
        </div>
        <span class="badge" style="background:${transportBg};color:${transportColor};border:1px solid ${transportBorder};font-size:11px">
          ${isMtls ? 'Encrypted' : 'Unencrypted'}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-4)">
        <div>
          <div class="field-label">Endpoint</div>
          <div style="font-size:13px;font-weight:500" class="mono">${signer?.url || '—'}</div>
        </div>
        <div>
          <div class="field-label">Latency</div>
          <div style="font-size:13px;font-weight:500">${signer?.latencyMs ?? '—'}ms</div>
        </div>
        <div>
          <div class="field-label">Auth Method</div>
          <div style="font-size:13px;font-weight:500">${signer?.authMethod || '—'}</div>
        </div>
        <div>
          <div class="field-label">Wallets on Signer</div>
          <div style="font-size:13px;font-weight:500">${signer?.walletCount ?? '—'}</div>
        </div>
      </div>
      ${!ok && signer?.error ? `<div style="margin-top:var(--sp-3);padding:var(--sp-3);background:var(--red-bg);border-radius:var(--r-md);font-size:12px;color:var(--red)">${signer.error}</div>` : ''}
      <div style="margin-top:var(--sp-3);font-size:11px;color:var(--text-tertiary)">
        ${signer?.note || 'Console connects to Driver via internal Docker network (or bank LAN). The Driver has NO internet access.'}
      </div>
    </div>`;
}

function renderInternetCard(internet) {
  const ok = internet?.status === 'connected';
  const targets = internet?.targets || [];

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">Internet Connectivity</h2>
          <p class="card-subtitle">Outbound access from DMZ to external services</p>
        </div>
        <span class="badge ${ok ? 'badge-confirmed' : 'badge-error'}">${ok ? 'Connected' : 'Disconnected'}</span>
      </div>
      <table class="data-table">
        <thead><tr><th>Target</th><th>Status</th><th>Latency</th><th>HTTP</th></tr></thead>
        <tbody>
          ${targets.map(t => `
            <tr>
              <td style="font-weight:500">${t.name}</td>
              <td><span class="badge ${t.status === 'reachable' ? 'badge-confirmed' : 'badge-error'}">${t.status}</span></td>
              <td>${t.latencyMs}ms</td>
              <td class="text-tertiary">${t.httpStatus || t.error || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderRpcCards(rpcNodes) {
  if (rpcNodes.length === 0) {
    return `
      <div class="card" style="margin-bottom:var(--sp-6)">
        <div class="card-header"><div><h2 class="card-title">RPC Nodes</h2></div></div>
        <div class="empty-state"><h3>No RPC nodes configured</h3><p>Add RPC URLs in Settings.</p></div>
      </div>`;
  }

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">RPC Node Health</h2>
          <p class="card-subtitle">Blockchain node connectivity per chain</p>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Chain</th><th>Chain ID</th><th>Status</th><th>Block Height</th><th>Latency</th><th>Endpoint</th></tr></thead>
        <tbody>
          ${rpcNodes.map(r => `
            <tr>
              <td style="font-weight:500">${r.name}</td>
              <td class="mono">${r.chainId}</td>
              <td><span class="badge ${r.status === 'connected' ? 'badge-confirmed' : 'badge-error'}">${r.status}</span></td>
              <td class="mono">${r.blockNumber?.toLocaleString() || '—'}</td>
              <td>${r.latencyMs}ms</td>
              <td class="mono text-tertiary" style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${r.rpcUrl || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderVendorCard(vendors) {
  const items = [
    { key: 'trm',         name: 'TRM Labs',     desc: 'Risk scoring & entity classification' },
    { key: 'chainalysis', name: 'Chainalysis',   desc: 'KYT screening & Market Intel' },
    { key: 'notabene',    name: 'Notabene',      desc: 'Travel Rule compliance' },
  ];

  const statusColor = (s) => s === 'connected' ? 'badge-confirmed' : s === 'error' ? 'badge-error' : 'badge-pending';
  const statusLabel = (s) => s === 'connected' ? 'Connected' : s === 'error' ? 'Error' : 'Not configured';

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Compliance Vendor APIs</h2>
          <p class="card-subtitle">API connectivity to compliance screening providers</p>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Provider</th><th>Description</th><th>Status</th></tr></thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td style="font-weight:500">${i.name}</td>
              <td class="text-tertiary">${i.desc}</td>
              <td><span class="badge ${statusColor(vendors[i.key])}">${statusLabel(vendors[i.key])}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:var(--sp-3);font-size:11px;color:var(--text-tertiary)">
        Configure API keys in <a href="#/settings" style="color:var(--blue-400)">Settings</a> to activate providers.
      </div>
    </div>`;
}
