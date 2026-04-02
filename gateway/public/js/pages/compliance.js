/**
 * Compliance Intelligence Dashboard
 *
 * Aggregates data from TRM Labs, Chainalysis, and Notabene into a
 * unified compliance view with:
 *   - API configuration panel
 *   - Vendor health status bar
 *   - Stat cards (screened, high-risk, TR pending, sanctions)
 *   - Requires Action alerts
 *   - Screening history table
 *   - Travel Rule overview (status donut)
 *   - Risk by entity category (TRM)
 *   - Exchange net flows (Chainalysis Market Intel)
 */

const OPS = '/ops/compliance';
async function req(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

// ── Vendor badge helper ─────────────────────────────────────────────────────

function vendorBadge(vendor) {
  const colors = {
    trm:         'background:rgba(212,144,10,0.1);color:#D4900A;border:1px solid rgba(212,144,10,0.2)',
    chainalysis: 'background:rgba(74,158,232,0.1);color:#4A9EE8;border:1px solid rgba(74,158,232,0.2)',
    notabene:    'background:rgba(47,184,138,0.1);color:#2FB88A;border:1px solid rgba(47,184,138,0.2)',
    TRM:         'background:rgba(212,144,10,0.1);color:#D4900A;border:1px solid rgba(212,144,10,0.2)',
    Chainalysis: 'background:rgba(74,158,232,0.1);color:#4A9EE8;border:1px solid rgba(74,158,232,0.2)',
    Notabene:    'background:rgba(47,184,138,0.1);color:#2FB88A;border:1px solid rgba(47,184,138,0.2)',
  };
  const style = colors[vendor] || colors.trm;
  return `<span class="badge" style="${style};font-size:10px;padding:2px 6px">${vendor.toUpperCase()}</span>`;
}

function riskBadge(level) {
  const styles = {
    critical: 'background:rgba(248,113,113,0.1);color:#F87171;border:1px solid rgba(248,113,113,0.2)',
    high:     'background:rgba(251,146,60,0.1);color:#FB923C;border:1px solid rgba(251,146,60,0.2)',
    medium:   'background:rgba(251,191,36,0.1);color:#FBBF24;border:1px solid rgba(251,191,36,0.2)',
    low:      'background:rgba(74,222,128,0.1);color:#4ADE80;border:1px solid rgba(74,222,128,0.2)',
    unknown:  'background:var(--bg-elevated);color:var(--text-tertiary)',
  };
  return `<span class="badge" style="${styles[level] || styles.unknown};font-size:10px;padding:2px 8px">${level}</span>`;
}

function severityBadge(sev) {
  const styles = {
    critical: 'border-left:3px solid #F87171;background:rgba(248,113,113,0.06)',
    high:     'border-left:3px solid #FB923C;background:rgba(251,146,60,0.06)',
    warning:  'border-left:3px solid #FBBF24;background:rgba(251,191,36,0.06)',
    info:     'border-left:3px solid var(--blue-400);background:rgba(74,158,232,0.06)',
  };
  return styles[sev] || styles.info;
}

// ── Main render ─────────────────────────────────────────────────────────────

export async function renderCompliance() {
  // Fetch all data in parallel
  const [config, summary, screenings, travelRule, market, health] = await Promise.all([
    req(`${OPS}/config`),
    req(`${OPS}/summary`).catch(() => ({})),
    req(`${OPS}/screenings`).catch(() => ({ decisions: [] })),
    req(`${OPS}/travel-rule`).catch(() => ({ transactions: [], metrics: null, available: false })),
    req(`${OPS}/market`).catch(() => ({ exchangeFlows: [], whaleActivity: null, available: false })),
    req(`${OPS}/health`).catch(() => ({ vendors: {} })),
  ]);

  return `
    ${renderStatCards(summary)}
    ${renderRequiresAction(summary.requiresAction || [])}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4);margin-bottom:var(--sp-6)">
      ${renderTravelRulePanel(travelRule)}
      ${renderMarketPanel(market)}
    </div>
    ${renderScreeningHistory(screenings.decisions || [])}
  `;
}

// ── Health Bar ───────────────────────────────────────────────────────────────

function renderHealthBar(health) {
  const vendors = health.vendors || {};
  const statusDot = (s) => {
    if (s === 'connected') return '<span style="color:#4ADE80">●</span>';
    if (s === 'error') return '<span style="color:#F87171">●</span>';
    return '<span style="color:var(--text-tertiary)">○</span>';
  };
  const statusText = (s) => {
    if (s === 'connected') return 'Connected';
    if (s === 'error') return 'Error';
    return 'Not configured';
  };

  return `
    <div style="display:flex;gap:var(--sp-6);margin-bottom:var(--sp-6);padding:var(--sp-3) var(--sp-4);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);font-size:12px;align-items:center">
      <span style="color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;font-size:10px">API STATUS</span>
      <span>${statusDot(vendors.trm)} ${vendorBadge('TRM')} ${statusText(vendors.trm)}</span>
      <span>${statusDot(vendors.chainalysis)} ${vendorBadge('Chainalysis')} ${statusText(vendors.chainalysis)}</span>
      <span>${statusDot(vendors.notabene)} ${vendorBadge('Notabene')} ${statusText(vendors.notabene)}</span>
      <span style="margin-left:auto;color:var(--text-tertiary)">Last sync: ${new Date().toLocaleTimeString()}</span>
    </div>`;
}

// ── Config Panel ─────────────────────────────────────────────────────────────

function renderConfigPanel(config) {
  return `
    <details style="margin-bottom:var(--sp-6)">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-secondary);padding:var(--sp-3) 0">
        ⚙ Configure API Keys
      </summary>
      <div class="card" style="margin-top:var(--sp-2)">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-4)">
          <div class="provider-card">
            <div class="provider-header">
              <span class="provider-name">TRM Labs</span>
              ${vendorBadge('TRM')}
            </div>
            <div class="provider-field">
              <label class="field-label">API Key</label>
              <input type="password" class="field-input" id="cha-trm-key" placeholder="TRM API key"
                value="${config.trm?.apiKey || ''}">
            </div>
            <div class="provider-field">
              <label class="field-label">API Secret</label>
              <input type="password" class="field-input" id="cha-trm-secret" placeholder="TRM API secret"
                value="${config.trm?.apiSecret || ''}">
            </div>
          </div>
          <div class="provider-card">
            <div class="provider-header">
              <span class="provider-name">Chainalysis KYT</span>
              ${vendorBadge('Chainalysis')}
            </div>
            <div class="provider-field">
              <label class="field-label">API Key</label>
              <input type="password" class="field-input" id="cha-ca-key" placeholder="Chainalysis API key"
                value="${config.chainalysis?.apiKey || ''}">
            </div>
            <div class="provider-field">
              <label class="field-label">Risk Threshold (0-10)</label>
              <input type="number" class="field-input" id="cha-ca-threshold" min="1" max="10"
                value="${config.chainalysis?.riskThreshold || 7}" style="width:80px">
            </div>
          </div>
          <div class="provider-card">
            <div class="provider-header">
              <span class="provider-name">Notabene</span>
              ${vendorBadge('Notabene')}
            </div>
            <div class="provider-field">
              <label class="field-label">Bearer Token</label>
              <input type="password" class="field-input" id="cha-nb-token" placeholder="Notabene token"
                value="${config.notabene?.token || ''}">
            </div>
            <div class="provider-field">
              <label class="field-label">VASP DID</label>
              <input type="text" class="field-input" id="cha-nb-vasp" placeholder="did:ethr:0x..."
                value="${config.notabene?.vaspDID || ''}">
            </div>
          </div>
        </div>
        <div style="margin-top:var(--sp-4);display:flex;gap:var(--sp-3)">
          <button class="btn-action" id="save-compliance-config">Save Configuration</button>
          <span class="text-tertiary" id="save-status" style="align-self:center;font-size:12px"></span>
        </div>
      </div>
    </details>`;
}

// ── Stat Cards ───────────────────────────────────────────────────────────────

function renderStatCards(summary) {
  return `
    <div class="kpi-grid" style="margin-bottom:var(--sp-6)">
      <div class="kpi-card">
        <div class="kpi-label">Screened Today ${vendorBadge('TRM')}</div>
        <div class="kpi-value">${summary.screenedToday || 0}</div>
        <div class="kpi-sub">${summary.allowed || 0} allowed · ${summary.blocked || 0} blocked</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">High Risk Alerts ${vendorBadge('TRM')}</div>
        <div class="kpi-value" style="${(summary.highRiskCount || 0) > 0 ? 'color:#FB923C' : ''}">${summary.highRiskCount || 0}</div>
        <div class="kpi-sub">Score ≥ 70/100</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">TR Pending ${vendorBadge('Notabene')}</div>
        <div class="kpi-value" style="${(summary.trPending || 0) > 0 ? 'color:#FBBF24' : ''}">${summary.trPending || 0}</div>
        <div class="kpi-sub">${summary.oldestPendingMinutes > 0 ? `Oldest: ${summary.oldestPendingMinutes}min` : 'None pending'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sanctions Hits ${vendorBadge('Chainalysis')}</div>
        <div class="kpi-value" style="${(summary.sanctionsHits || 0) > 0 ? 'color:#F87171' : ''}">${summary.sanctionsHits || 0}</div>
        <div class="kpi-sub">OFAC / SDN matches</div>
      </div>
    </div>`;
}

// ── Requires Action Panel ────────────────────────────────────────────────────

function renderRequiresAction(actions) {
  if (actions.length === 0) {
    return `
      <div style="padding:var(--sp-4);background:rgba(74,222,128,0.06);border:1px solid rgba(74,222,128,0.15);border-radius:var(--r-lg);margin-bottom:var(--sp-6);text-align:center;color:#4ADE80;font-size:13px;font-weight:500">
        ✓ No issues detected — all screenings passed
      </div>`;
  }

  const items = actions.map(a => `
    <div style="padding:var(--sp-3) var(--sp-4);${severityBadge(a.severity)};border-radius:var(--r-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3)">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${a.title}</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">${a.description}</div>
      </div>
      <div style="display:flex;gap:var(--sp-2);align-items:center">
        ${vendorBadge(a.source)}
        ${riskBadge(a.severity)}
      </div>
    </div>
  `).join('');

  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">Requires Action</h2>
          <p class="card-subtitle">${actions.length} alert${actions.length !== 1 ? 's' : ''} across all providers</p>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--sp-2)">${items}</div>
    </div>`;
}

// ── Travel Rule Panel (Notabene) ─────────────────────────────────────────────

function renderTravelRulePanel(travelRule) {
  if (!travelRule.available) {
    return `
      <div class="card">
        <div class="card-header">
          <div><h2 class="card-title">Travel Rule</h2><p class="card-subtitle">${vendorBadge('Notabene')}</p></div>
        </div>
        <div class="empty-state"><p><a href="#/settings" style="color:var(--blue-400)">Configure Notabene API key in Settings</a> to enable Travel Rule monitoring.</p></div>
      </div>`;
  }

  const m = travelRule.metrics || {};
  const txs = travelRule.transactions || [];
  const accepted = m.acceptedCount || 0;
  const pending = m.pendingCount || 0;
  const rejected = m.rejectedCount || 0;
  const saved = m.savedCount || 0;
  const total = accepted + pending + rejected + saved || 1;

  // Simple CSS bar chart instead of a charting library
  const pctA = Math.round((accepted / total) * 100);
  const pctP = Math.round((pending / total) * 100);
  const pctR = Math.round((rejected / total) * 100);
  const pctS = Math.round((saved / total) * 100);

  return `
    <div class="card">
      <div class="card-header">
        <div><h2 class="card-title">Travel Rule Overview</h2><p class="card-subtitle">${vendorBadge('Notabene')} FATF Compliance</p></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-3);margin-bottom:var(--sp-4)">
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:700">${m.totalSentToday || 0}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">Sent Today</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:700">${Math.round((m.responseRate || 0) * 100)}%</div>
          <div style="font-size:11px;color:var(--text-tertiary)">Response Rate</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:700;color:${(m.rejectionRate || 0) > 0.1 ? '#F87171' : ''}">${Math.round((m.rejectionRate || 0) * 100)}%</div>
          <div style="font-size:11px;color:var(--text-tertiary)">Rejection Rate</div>
        </div>
      </div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg-elevated);margin-bottom:var(--sp-3)">
        <div style="width:${pctA}%;background:#4ADE80"></div>
        <div style="width:${pctP}%;background:#FBBF24"></div>
        <div style="width:${pctR}%;background:#F87171"></div>
        <div style="width:${pctS}%;background:#6B7280"></div>
      </div>
      <div style="display:flex;gap:var(--sp-4);font-size:11px">
        <span><span style="color:#4ADE80">●</span> Accepted ${accepted}</span>
        <span><span style="color:#FBBF24">●</span> Pending ${pending}</span>
        <span><span style="color:#F87171">●</span> Rejected ${rejected}</span>
        <span><span style="color:#6B7280">●</span> Saved ${saved}</span>
      </div>
    </div>`;
}

// ── Exchange Flows (Chainalysis Market Intel) ────────────────────────────────

function renderMarketPanel(market) {
  if (!market.available) {
    return `
      <div class="card">
        <div class="card-header">
          <div><h2 class="card-title">Exchange Net Flows</h2><p class="card-subtitle">${vendorBadge('Chainalysis')}</p></div>
        </div>
        <div class="empty-state"><p><a href="#/settings" style="color:var(--blue-400)">Configure Chainalysis API key in Settings</a> to enable Market Intel.</p></div>
      </div>`;
  }

  const flows = market.exchangeFlows || [];
  const whale = market.whaleActivity;

  const flowRows = flows.length === 0
    ? '<div class="empty-state"><p>No exchange flow data available.</p></div>'
    : flows.map(f => {
        const isInflow = f.direction === 'inflow';
        const color = isInflow ? '#4ADE80' : '#F87171';
        const arrow = isInflow ? '↑' : '↓';
        const usd = Math.abs(f.netFlow7dUSD);
        const formatted = usd >= 1e9 ? `$${(usd/1e9).toFixed(1)}B`
          : usd >= 1e6 ? `$${(usd/1e6).toFixed(1)}M`
          : `$${usd.toLocaleString()}`;
        return `
          <div style="display:flex;justify-content:space-between;padding:var(--sp-2) 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${f.exchange}</span>
            <span style="color:${color};font-weight:500">${arrow} ${formatted}</span>
          </div>`;
      }).join('');

  const whaleCard = whale ? `
    <div style="margin-top:var(--sp-4);padding:var(--sp-3);background:var(--bg-elevated);border-radius:var(--r-md)">
      <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:var(--sp-1)">WHALE ACTIVITY (BTC ≥1000)</div>
      <div style="font-size:15px;font-weight:600;color:${whale.signal === 'accumulating' ? '#4ADE80' : '#F87171'}">
        ${whale.signal === 'accumulating' ? '📈 Accumulating' : '📉 Distributing'}
      </div>
      <div style="font-size:12px;color:var(--text-tertiary)">${whale.btc7dChange >= 0 ? '+' : ''}${whale.btc7dChange.toLocaleString()} BTC (7d)</div>
    </div>` : '';

  return `
    <div class="card">
      <div class="card-header">
        <div><h2 class="card-title">Exchange Net Flows (7d)</h2><p class="card-subtitle">${vendorBadge('Chainalysis')} Market Intel</p></div>
      </div>
      ${flowRows}
      ${whaleCard}
    </div>`;
}

// ── Screening History Table ──────────────────────────────────────────────────

function renderScreeningHistory(decisions) {
  if (decisions.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <div><h2 class="card-title">Screening History</h2><p class="card-subtitle">All compliance screening decisions</p></div>
        </div>
        <div class="empty-state"><h3>No screenings yet</h3><p>Execute transfers to see compliance screening results.</p></div>
      </div>`;
  }

  const rows = decisions.slice(0, 50).map(d => {
    const sources = d.results?.map(r => vendorBadge(r.provider)).join(' ') || '';
    const bestRisk = d.results?.reduce((best, r) => {
      if (r.riskScore !== null && (best === null || r.riskScore > best)) return r.riskScore;
      return best;
    }, null);
    const bestLevel = d.results?.reduce((best, r) => {
      const order = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
      return (order[r.riskLevel] || 0) > (order[best] || 0) ? r.riskLevel : best;
    }, 'unknown');

    return `
      <tr>
        <td><span class="badge badge-${d.allowed ? 'confirmed' : 'failed'}">${d.allowed ? 'Allowed' : 'Blocked'}</span></td>
        <td><span class="mono truncate" title="${d.address}">${d.address?.slice(0, 10)}...${d.address?.slice(-6)}</span></td>
        <td>${d.chain}</td>
        <td>${sources}</td>
        <td>${bestRisk !== null ? `${riskBadge(bestLevel)} <span class="mono" style="font-size:11px;margin-left:4px">${bestRisk}</span>` : '—'}</td>
        <td>${d.results?.some(r => r.sanctioned) ? '<span style="color:#F87171;font-weight:600">SANCTIONS</span>' : '—'}</td>
        <td class="text-tertiary" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.reason || '—'}</td>
        <td class="text-tertiary">${d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Screening History</h2>
          <p class="card-subtitle">${decisions.length} total decisions</p>
        </div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>Decision</th><th>Address</th><th>Chain</th><th>Sources</th>
          <th>Risk</th><th>Sanctions</th><th>Reason</th><th>Time</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Event handlers (attached after render) ───────────────────────────────────

// Auto-attach save handler
setTimeout(() => {
  document.getElementById('save-compliance-config')?.addEventListener('click', async () => {
    const status = document.getElementById('save-status');
    try {
      await fetch(`${OPS}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trm: {
            apiKey: document.getElementById('cha-trm-key')?.value,
            apiSecret: document.getElementById('cha-trm-secret')?.value,
          },
          chainalysis: {
            apiKey: document.getElementById('cha-ca-key')?.value,
            riskThreshold: parseInt(document.getElementById('cha-ca-threshold')?.value || '7'),
          },
          notabene: {
            token: document.getElementById('cha-nb-token')?.value,
            vaspDID: document.getElementById('cha-nb-vasp')?.value,
          },
        }),
      });
      if (status) { status.textContent = 'Saved!'; status.style.color = 'var(--emerald)'; }
      setTimeout(() => location.reload(), 1000);
    } catch (e) {
      if (status) { status.textContent = 'Save failed'; status.style.color = 'var(--red)'; }
    }
  });
}, 100);
