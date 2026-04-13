/**
 * Multi-Chain Wallet View
 *
 * Aggregated view of all wallets across chains with balance summaries,
 * chain-grouped layouts, and cross-chain portfolio overview.
 */

import { api } from '../api.js';
import { animateKPIs, staggerFadeIn, addHoverLift } from '../animations.js';

const CHAIN_COLORS = {
  ethereum: '#627EEA', polygon: '#8247E5', bsc: '#F3BA2F', 'binance-smart-chain': '#F3BA2F',
  arbitrum: '#28A0F0', avalanche: '#E84142', optimism: '#FF0420', base: '#0052FF',
  solana: '#9945FF', bitcoin: '#F7931A', tron: '#FF0013',
};

function fmtBalance(val, currency = '') {
  if (val == null) return '—';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + (currency ? ` ${currency}` : '');
}

function chainColor(chain) {
  return CHAIN_COLORS[chain?.toLowerCase()] || 'var(--blue-400)';
}

export async function renderMultiChain() {
  let wallets = [];
  try {
    wallets = await api.getOpsWallets().then(d => d.wallets || d || []);
  } catch {
    try { wallets = await api.getWallets(); } catch { wallets = []; }
  }

  // Group by chain
  const byChain = {};
  let totalWallets = 0;
  for (const w of wallets) {
    const chain = w.chain || w.blockchain || 'unknown';
    if (!byChain[chain]) byChain[chain] = { wallets: [], totalBalance: 0 };
    byChain[chain].wallets.push(w);
    byChain[chain].totalBalance += parseFloat(w.balance || 0);
    totalWallets++;
  }

  const chainKeys = Object.keys(byChain).sort();
  const totalBalance = Object.values(byChain).reduce((s, c) => s + c.totalBalance, 0);

  return `
    <div class="mc-page">
      <!-- Portfolio Summary -->
      <div class="kpi-grid" id="mc-kpis">
        <div class="kpi-card">
          <div class="kpi-label">Total Wallets</div>
          <div class="kpi-value" data-animate-to="${totalWallets}">${totalWallets}</div>
          <div class="kpi-sub">${chainKeys.length} chains</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Active Chains</div>
          <div class="kpi-value" data-animate-to="${chainKeys.length}">${chainKeys.length}</div>
          <div class="kpi-sub">Connected</div>
        </div>
        <div class="kpi-card" style="grid-column: span 2">
          <div class="kpi-label">Portfolio Distribution</div>
          <div class="mc-distribution-bar">
            ${chainKeys.map(chain => {
              const pct = totalBalance > 0 ? (byChain[chain].totalBalance / totalBalance * 100) : 0;
              return pct > 0 ? `<div class="mc-dist-segment" style="width:${Math.max(pct, 2)}%;background:${chainColor(chain)}" title="${chain}: ${pct.toFixed(1)}%"></div>` : '';
            }).join('')}
          </div>
          <div class="mc-distribution-legend">
            ${chainKeys.map(chain => `
              <span class="mc-legend-item">
                <span class="mc-legend-dot" style="background:${chainColor(chain)}"></span>
                ${chain}
              </span>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- View Toggle -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-4)">
        <div class="filter-tabs" id="mc-view-toggle">
          <button class="filter-tab active" data-view="grouped">By Chain</button>
          <button class="filter-tab" data-view="list">All Wallets</button>
        </div>
        <div class="search-bar" style="margin:0">
          <input type="text" id="mc-search" placeholder="Search wallets..." class="form-input" style="max-width:240px">
        </div>
      </div>

      <!-- Grouped View -->
      <div id="mc-grouped-view">
        ${chainKeys.map(chain => {
          const data = byChain[chain];
          const color = chainColor(chain);
          return `
            <div class="mc-chain-group card" data-chain="${chain}" style="margin-bottom:var(--sp-4);border-left:3px solid ${color}">
              <div class="mc-chain-header">
                <div style="display:flex;align-items:center;gap:var(--sp-3)">
                  <div class="chain-dot" style="background:${color}"></div>
                  <h3 style="font-size:15px;font-weight:600">${chain.charAt(0).toUpperCase() + chain.slice(1)}</h3>
                  <span class="count-badge">${data.wallets.length}</span>
                </div>
                <span class="mono" style="color:${color}">${fmtBalance(data.totalBalance)}</span>
              </div>
              <table class="data-table" style="margin-top:var(--sp-3)">
                <thead><tr><th>Name</th><th>Address</th><th>Balance</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${data.wallets.map(w => `
                    <tr class="mc-wallet-row" data-name="${(w.name || '').toLowerCase()}" data-chain="${chain}">
                      <td><a href="#/wallets/${w.id}">${w.name || w.id}</a></td>
                      <td class="mono truncate" style="max-width:180px">${w.address || '—'}</td>
                      <td class="mono">${fmtBalance(w.balance, w.currency)}</td>
                      <td><span class="badge badge-${w.status === 'active' ? 'confirmed' : 'pending'}">${w.status || 'active'}</span></td>
                      <td><a href="#/wallets/${w.id}/transfer" class="btn btn-sm btn-primary">Transfer</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        }).join('')}
      </div>

      <!-- List View (hidden by default) -->
      <div id="mc-list-view" style="display:none">
        <div class="card">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Chain</th><th>Address</th><th>Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${wallets.map(w => {
                const chain = w.chain || w.blockchain || 'unknown';
                return `
                  <tr class="mc-wallet-row" data-name="${(w.name || '').toLowerCase()}" data-chain="${chain}">
                    <td><a href="#/wallets/${w.id}">${w.name || w.id}</a></td>
                    <td><span class="chain-dot" style="background:${chainColor(chain)}"></span>${chain}</td>
                    <td class="mono truncate" style="max-width:180px">${w.address || '—'}</td>
                    <td class="mono">${fmtBalance(w.balance, w.currency)}</td>
                    <td><span class="badge badge-${w.status === 'active' ? 'confirmed' : 'pending'}">${w.status || 'active'}</span></td>
                    <td><a href="#/wallets/${w.id}/transfer" class="btn btn-sm btn-primary">Transfer</a></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

export function initMultiChain() {
  const page = document.querySelector('.mc-page');
  if (!page) return;

  animateKPIs(document.getElementById('mc-kpis'));
  staggerFadeIn(page, '.kpi-card, .mc-chain-group');
  addHoverLift(page, '.kpi-card');

  // View toggle
  document.querySelectorAll('#mc-view-toggle .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mc-view-toggle .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('mc-grouped-view').style.display = view === 'grouped' ? '' : 'none';
      document.getElementById('mc-list-view').style.display = view === 'list' ? '' : 'none';
    });
  });

  // Search
  document.getElementById('mc-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.mc-wallet-row').forEach(row => {
      const match = !q || row.dataset.name.includes(q) || row.dataset.chain.includes(q);
      row.style.display = match ? '' : 'none';
    });
  });
}
