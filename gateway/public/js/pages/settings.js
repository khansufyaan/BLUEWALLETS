/**
 * Settings Page — API key management for all integrations.
 *
 * Order:
 *   1. Signer Connection (Apple-style status checklist)
 *   2. RPC Node Providers
 *   3. Compliance APIs (TRM, Chainalysis, Notabene)
 */

const OPS = '/ops/settings';
const HEALTH = '/ops/health/full';

async function req(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

export async function renderSettings() {
  let settings = {}, health = {};
  try {
    settings = await req(OPS);
  } catch { settings = { signer: {}, rpc: [], compliance: {} }; }
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 6000);
    const r = await fetch(HEALTH, { signal: controller.signal });
    health = await r.json();
  } catch { health = {}; }

  const compliance = settings.compliance || {};
  const rpc = settings.rpc || [];

  return `
    ${renderSignerSection(settings.signer, health.signer)}
    ${renderRpcSection(rpc, health.rpcNodes || [])}
    ${renderComplianceSection(compliance, health.vendors || {})}
  `;
}

// ── Signer Connection (Apple-style) ─────────────────────────────────────────

function renderSignerSection(signer, signerHealth) {
  const checks = [
    {
      label: 'Internal network reachable',
      ok: signerHealth?.status === 'connected',
      detail: signer?.url || '—',
    },
    {
      label: 'Authentication verified',
      ok: signerHealth?.status === 'connected' && signer?.authKey,
      detail: signer?.authKey ? `Shared key (${signer.authKey})` : 'No auth configured',
    },
    {
      label: 'HSM signing service responding',
      ok: signerHealth?.status === 'connected',
      detail: signerHealth?.latencyMs ? `${signerHealth.latencyMs}ms round-trip` : '—',
    },
    {
      label: 'Wallet store accessible',
      ok: signerHealth?.walletCount !== undefined,
      detail: signerHealth?.walletCount !== undefined ? `${signerHealth.walletCount} wallets loaded` : '—',
    },
  ];

  const allOk = checks.every(c => c.ok);

  const checkIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#22C55E" opacity="0.15"/><circle cx="8" cy="8" r="7" stroke="#22C55E" stroke-width="1.2"/><path d="M5 8l2 2 4-4" stroke="#22C55E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const failIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#EF4444" opacity="0.15"/><circle cx="8" cy="8" r="7" stroke="#EF4444" stroke-width="1.2"/><path d="M6 6l4 4M10 6l-4 4" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">Signer Connection</h2>
          <p class="card-subtitle">Secure zone HSM signing server · Internal network only</p>
        </div>
        <span class="badge ${allOk ? 'badge-confirmed' : 'badge-error'}" style="font-size:11px;padding:4px 10px">
          ${allOk ? 'All Systems Connected' : 'Connection Issue'}
        </span>
      </div>

      <div class="settings-checklist">
        ${checks.map((c, i) => `
          <div class="settings-check-item" style="animation-delay:${i * 80}ms">
            <div class="settings-check-icon">${c.ok ? checkIcon : failIcon}</div>
            <div class="settings-check-content">
              <div class="settings-check-label">${c.label}</div>
              <div class="settings-check-detail">${c.detail}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top:var(--sp-4);padding:var(--sp-3) var(--sp-4);background:var(--bg-elevated);border-radius:var(--r-md);font-size:11px;color:var(--text-tertiary);line-height:1.6">
        <strong style="color:var(--text-secondary)">Connection details</strong><br>
        Endpoint: <code style="color:var(--text-secondary)">${signer?.url || '—'}</code> · Set via <code>SIGNER_URL</code> env var<br>
        Auth: <code style="color:var(--text-secondary)">${signer?.authKey ? 'INTERNAL_AUTH_KEY' : 'None'}</code> · Upgrade to mTLS for production
      </div>
    </div>`;
}

// ── RPC Node Providers ──────────────────────────────────────────────────────

function renderRpcSection(rpcList, rpcHealth) {
  // Merge health data into rpc list
  const healthMap = {};
  rpcHealth.forEach(h => { healthMap[h.chain] = h; });

  const rows = rpcList.map(r => {
    const h = healthMap[r.chain];
    const isConnected = h?.status === 'connected';
    const latency = h?.latencyMs;
    const block = h?.blockNumber;

    return `
      <tr>
        <td>
          <div style="font-weight:500">${r.name}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">Chain ID: ${r.chainId}</div>
        </td>
        <td>
          <input type="text" class="field-input rpc-url-input" data-chain="${r.chain}"
            placeholder="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
            value="${r.rpcUrl || ''}" style="font-size:11px;padding:6px 10px">
        </td>
        <td><span class="text-tertiary" style="font-size:12px">${r.provider || '—'}</span></td>
        <td>
          ${r.enabled
            ? `<span class="badge ${isConnected ? 'badge-confirmed' : 'badge-error'}">${isConnected ? 'Connected' : 'Error'}</span>`
            : '<span class="badge badge-pending">Off</span>'}
        </td>
        <td class="mono text-tertiary" style="font-size:11px">${isConnected && block ? block.toLocaleString() : '—'}</td>
        <td class="text-tertiary" style="font-size:11px">${isConnected && latency ? `${latency}ms` : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">RPC Node Providers</h2>
          <p class="card-subtitle">Blockchain RPC endpoints · Alchemy, Infura, QuickNode, or self-hosted</p>
        </div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>Chain</th><th>RPC URL</th><th>Provider</th><th>Status</th><th>Block</th><th>Latency</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:var(--sp-4);display:flex;gap:var(--sp-3)">
        <button class="btn-action" id="save-rpc-settings">Save RPC Endpoints</button>
        <span class="text-tertiary" id="rpc-save-status" style="align-self:center;font-size:12px"></span>
      </div>
    </div>`;
}

// ── Compliance APIs ─────────────────────────────────────────────────────────

function renderComplianceSection(c, vendors) {
  const checkIcon = (ok) => ok
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="#22C55E" opacity="0.15"/><circle cx="7" cy="7" r="6" stroke="#22C55E" stroke-width="1"/><path d="M4.5 7l1.5 1.5 3-3" stroke="#22C55E" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="var(--text-tertiary)" stroke-width="1" stroke-dasharray="2 2"/></svg>`;

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Compliance APIs</h2>
          <p class="card-subtitle">Transaction screening and Travel Rule providers</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-4)">
        <!-- TRM Labs -->
        <div class="provider-card">
          <div class="provider-header">
            <div style="display:flex;align-items:center;gap:var(--sp-2)">
              ${checkIcon(vendors.trm === 'connected')}
              <span class="provider-name">TRM Labs</span>
            </div>
            <span class="badge ${c.trm?.apiKey ? 'badge-confirmed' : 'badge-pending'}">
              ${vendors.trm === 'connected' ? 'Connected' : c.trm?.apiKey ? 'Configured' : 'Off'}
            </span>
          </div>
          <div class="provider-desc">Blockchain risk scoring · Entity classification</div>
          <div class="provider-field">
            <label class="field-label">API Key</label>
            <input type="password" class="field-input" id="set-trm-key" placeholder="Enter TRM Labs API key"
              value="${c.trm?.apiKey || ''}">
          </div>
          <div class="provider-field">
            <label class="field-label">API Secret</label>
            <input type="password" class="field-input" id="set-trm-secret" placeholder="Enter TRM Labs API secret"
              value="${c.trm?.apiSecret || ''}">
          </div>
        </div>

        <!-- Chainalysis -->
        <div class="provider-card">
          <div class="provider-header">
            <div style="display:flex;align-items:center;gap:var(--sp-2)">
              ${checkIcon(vendors.chainalysis === 'connected')}
              <span class="provider-name">Chainalysis</span>
            </div>
            <span class="badge ${c.chainalysis?.apiKey ? 'badge-confirmed' : 'badge-pending'}">
              ${vendors.chainalysis === 'connected' ? 'Connected' : c.chainalysis?.apiKey ? 'Configured' : 'Off'}
            </span>
          </div>
          <div class="provider-desc">KYT screening · Sanctions detection · Market Intel</div>
          <div class="provider-field">
            <label class="field-label">API Key</label>
            <input type="password" class="field-input" id="set-ca-key" placeholder="Enter Chainalysis API key"
              value="${c.chainalysis?.apiKey || ''}">
          </div>
          <div class="provider-field">
            <label class="field-label">Risk Threshold (0-10)</label>
            <input type="number" class="field-input" id="set-ca-threshold" min="1" max="10"
              value="${c.chainalysis?.riskThreshold || 7}" style="width:80px">
          </div>
        </div>

        <!-- Notabene -->
        <div class="provider-card">
          <div class="provider-header">
            <div style="display:flex;align-items:center;gap:var(--sp-2)">
              ${checkIcon(vendors.notabene === 'connected')}
              <span class="provider-name">Notabene</span>
            </div>
            <span class="badge ${c.notabene?.token ? 'badge-confirmed' : 'badge-pending'}">
              ${vendors.notabene === 'connected' ? 'Connected' : c.notabene?.token ? 'Configured' : 'Off'}
            </span>
          </div>
          <div class="provider-desc">FATF Travel Rule · VASP-to-VASP messaging</div>
          <div class="provider-field">
            <label class="field-label">Bearer Token</label>
            <input type="password" class="field-input" id="set-nb-token" placeholder="Enter Notabene token"
              value="${c.notabene?.token || ''}">
          </div>
          <div class="provider-field">
            <label class="field-label">VASP DID</label>
            <input type="text" class="field-input" id="set-nb-vasp" placeholder="did:ethr:0x..."
              value="${c.notabene?.vaspDID || ''}">
          </div>
        </div>
      </div>
      <div style="margin-top:var(--sp-4);display:flex;gap:var(--sp-3)">
        <button class="btn-action" id="save-compliance-settings">Save Compliance Keys</button>
        <span class="text-tertiary" id="compliance-save-status" style="align-self:center;font-size:12px"></span>
      </div>
    </div>`;
}

// ── Event handlers ──────────────────────────────────────────────────────────

setTimeout(() => {
  // Save compliance
  document.getElementById('save-compliance-settings')?.addEventListener('click', async () => {
    const st = document.getElementById('compliance-save-status');
    try {
      await fetch(`${OPS}/compliance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trm: { apiKey: gv('set-trm-key'), apiSecret: gv('set-trm-secret') },
          chainalysis: { apiKey: gv('set-ca-key'), riskThreshold: parseInt(gv('set-ca-threshold') || '7') },
          notabene: { token: gv('set-nb-token'), vaspDID: gv('set-nb-vasp') },
        }),
      });
      showSaved(st);
    } catch { showFailed(st); }
  });

  // Save RPC
  document.getElementById('save-rpc-settings')?.addEventListener('click', async () => {
    const st = document.getElementById('rpc-save-status');
    const inputs = document.querySelectorAll('.rpc-url-input');
    try {
      for (const input of inputs) {
        const chain = input.dataset.chain;
        const rpcUrl = input.value.trim();
        if (rpcUrl) {
          await fetch(`${OPS}/rpc`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chain, rpcUrl }),
          });
        }
      }
      showSaved(st);
    } catch { showFailed(st); }
  });
}, 100);

function gv(id) { return document.getElementById(id)?.value || ''; }
function showSaved(el) { if (el) { el.textContent = '✓ Saved'; el.style.color = 'var(--emerald)'; setTimeout(() => { el.textContent = ''; }, 3000); } }
function showFailed(el) { if (el) { el.textContent = 'Save failed'; el.style.color = 'var(--red)'; } }
