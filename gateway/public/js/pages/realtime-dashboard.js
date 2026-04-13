/**
 * Real-time WebSocket Dashboard
 *
 * Live-updating dashboard with WebSocket connection for real-time
 * transaction feeds, deposit alerts, and chain status updates.
 */

import { api } from '../api.js';
import { animateKPIs, staggerFadeIn, addHoverLift, morphNumber } from '../animations.js';

let _ws = null;
let _pollInterval = null;
let _reconnectTimeout = null;
let _reconnectAttempts = 0;

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtAmount(val, currency = '') {
  if (val == null) return '—';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + (currency ? ` ${currency}` : '');
}

export async function renderRealtimeDashboard() {
  let stats = {}, transactions = [], deposits = [], chains = [];
  try {
    [stats, transactions, deposits, chains] = await Promise.all([
      api.getOpsStats().catch(() => ({})),
      api.getOpsTransactions().then(d => (d.transactions || d || []).slice(0, 10)).catch(() => []),
      api.getOpsDeposits().then(d => (d.deposits || d || []).slice(0, 10)).catch(() => []),
      api.getOpsChains().then(d => d.chains || d || []).catch(() => []),
    ]);
  } catch {}

  const txCount = stats.totalTransactions || transactions.length || 0;
  const depCount = stats.totalDeposits || deposits.length || 0;
  const activeChains = chains.filter(c => c.status === 'connected').length;

  return `
    <div class="rt-dashboard">
      <!-- Connection Status -->
      <div class="rt-status-bar">
        <div class="rt-status-indicator" id="rt-status">
          <div class="rt-status-dot rt-dot-connecting"></div>
          <span id="rt-status-text">Connecting...</span>
        </div>
        <div class="rt-status-actions">
          <span class="text-xs text-muted" id="rt-last-update">—</span>
          <button class="btn btn-sm btn-ghost" id="rt-reconnect">Reconnect</button>
        </div>
      </div>

      <!-- Live KPIs -->
      <div class="kpi-grid" id="rt-kpis">
        <div class="kpi-card">
          <div class="kpi-label">Withdrawals</div>
          <div class="kpi-value" id="rt-kpi-tx" data-animate-to="${txCount}">${txCount}</div>
          <div class="kpi-sub" id="rt-kpi-tx-sub">All time</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Deposits</div>
          <div class="kpi-value" id="rt-kpi-dep" data-animate-to="${depCount}">${depCount}</div>
          <div class="kpi-sub" id="rt-kpi-dep-sub">Detected</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Active Chains</div>
          <div class="kpi-value" id="rt-kpi-chains" data-animate-to="${activeChains}">${activeChains}</div>
          <div class="kpi-sub">${chains.length} configured</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Uptime</div>
          <div class="kpi-value" id="rt-kpi-uptime">—</div>
          <div class="kpi-sub">Since last restart</div>
        </div>
      </div>

      <!-- Two-column live feeds -->
      <div class="rt-feeds">
        <!-- Live Transaction Feed -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Live Withdrawals</h2>
            <span class="badge badge-pending" id="rt-tx-count">${transactions.length}</span>
          </div>
          <div class="rt-feed" id="rt-tx-feed">
            ${transactions.length === 0 ? '<div class="empty-state"><p>No withdrawals yet</p></div>' :
              transactions.map(tx => `
                <div class="activity-row rt-feed-item" data-id="${tx.txHash || tx.id}">
                  <div class="activity-left">
                    <div class="activity-icon activity-icon-out">&#8593;</div>
                    <div>
                      <div class="activity-title">${tx.chain || 'Unknown'}</div>
                      <div class="activity-detail mono truncate">${tx.txHash || tx.id || '—'}</div>
                    </div>
                  </div>
                  <div class="activity-right">
                    <div class="activity-amount">${fmtAmount(tx.amount, tx.currency)}</div>
                    <div class="activity-time">${fmtTime(tx.createdAt || tx.timestamp)}</div>
                  </div>
                </div>
              `).join('')}
          </div>
        </div>

        <!-- Live Deposit Feed -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Live Deposits</h2>
            <span class="badge badge-confirmed" id="rt-dep-count">${deposits.length}</span>
          </div>
          <div class="rt-feed" id="rt-dep-feed">
            ${deposits.length === 0 ? '<div class="empty-state"><p>No deposits detected</p></div>' :
              deposits.map(d => `
                <div class="activity-row rt-feed-item" data-id="${d.txHash || d.id}">
                  <div class="activity-left">
                    <div class="activity-icon activity-icon-in">&#8595;</div>
                    <div>
                      <div class="activity-title">${d.chain || 'Unknown'}</div>
                      <div class="activity-detail mono truncate">${d.txHash || d.id || '—'}</div>
                    </div>
                  </div>
                  <div class="activity-right">
                    <div class="activity-amount">${fmtAmount(d.amount, d.currency)}</div>
                    <div class="activity-time">${fmtTime(d.detectedAt || d.timestamp)}</div>
                  </div>
                </div>
              `).join('')}
          </div>
        </div>
      </div>

      <!-- Chain Status Strip -->
      <div class="card" style="margin-top:var(--sp-4)">
        <div class="card-header">
          <h2 class="card-title">Chain Status</h2>
        </div>
        <div class="rt-chain-strip" id="rt-chain-strip">
          ${chains.map(c => `
            <div class="rt-chain-pill ${c.status === 'connected' ? 'rt-chain-ok' : 'rt-chain-err'}" data-chain="${c.chainKey || c.name}">
              <div class="rt-chain-dot"></div>
              <span>${c.name || c.chainKey}</span>
              <span class="mono text-xs">#${(c.blockNumber || 0).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

export function initRealtimeDashboard() {
  const container = document.querySelector('.rt-dashboard');
  if (!container) return;

  // Animate KPIs on load
  animateKPIs(document.getElementById('rt-kpis'));
  staggerFadeIn(container, '.kpi-card, .card');
  addHoverLift(container, '.kpi-card');

  // Try WebSocket, fallback to polling
  connectWebSocket();

  document.getElementById('rt-reconnect')?.addEventListener('click', () => {
    _reconnectAttempts = 0;
    connectWebSocket();
  });
}

function connectWebSocket() {
  const statusDot = document.querySelector('.rt-status-dot');
  const statusText = document.getElementById('rt-status-text');

  // Check if WebSocket endpoint exists
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}/ws`;

  if (statusDot) statusDot.className = 'rt-status-dot rt-dot-connecting';
  if (statusText) statusText.textContent = 'Connecting...';

  try {
    _ws = new WebSocket(wsUrl);

    _ws.onopen = () => {
      _reconnectAttempts = 0;
      if (statusDot) statusDot.className = 'rt-status-dot rt-dot-connected';
      if (statusText) statusText.textContent = 'Live';
      clearInterval(_pollInterval);
    };

    _ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleWsMessage(msg);
      } catch {}
    };

    _ws.onclose = () => {
      if (statusDot) statusDot.className = 'rt-status-dot rt-dot-disconnected';
      if (statusText) statusText.textContent = 'Disconnected — polling';
      startPolling();
      scheduleReconnect();
    };

    _ws.onerror = () => {
      _ws?.close();
      startPolling();
    };
  } catch {
    // WebSocket not available, use polling
    if (statusDot) statusDot.className = 'rt-status-dot rt-dot-polling';
    if (statusText) statusText.textContent = 'Polling (5s)';
    startPolling();
  }
}

function scheduleReconnect() {
  if (_reconnectAttempts >= 5) return;
  const delay = Math.min(2000 * Math.pow(2, _reconnectAttempts), 30000);
  _reconnectAttempts++;
  clearTimeout(_reconnectTimeout);
  _reconnectTimeout = setTimeout(connectWebSocket, delay);
}

function startPolling() {
  clearInterval(_pollInterval);
  _pollInterval = setInterval(pollUpdates, 5000);
  pollUpdates();
}

async function pollUpdates() {
  const updateEl = document.getElementById('rt-last-update');
  try {
    const [stats, txs, deps] = await Promise.all([
      api.getOpsStats().catch(() => null),
      api.getOpsTransactions().then(d => (d.transactions || d || []).slice(0, 10)).catch(() => null),
      api.getOpsDeposits().then(d => (d.deposits || d || []).slice(0, 10)).catch(() => null),
    ]);

    if (stats) {
      const txEl = document.getElementById('rt-kpi-tx');
      const depEl = document.getElementById('rt-kpi-dep');
      if (txEl) {
        const old = parseInt(txEl.textContent.replace(/,/g, '')) || 0;
        const nv = stats.totalTransactions || 0;
        if (nv !== old) morphNumber(txEl, old, nv);
      }
      if (depEl) {
        const old = parseInt(depEl.textContent.replace(/,/g, '')) || 0;
        const nv = stats.totalDeposits || 0;
        if (nv !== old) morphNumber(depEl, old, nv);
      }
    }

    if (updateEl) updateEl.textContent = `Updated ${fmtTime(new Date())}`;
  } catch {}
}

function handleWsMessage(msg) {
  if (msg.type === 'transaction') prependFeedItem('rt-tx-feed', msg.data, 'out');
  else if (msg.type === 'deposit') prependFeedItem('rt-dep-feed', msg.data, 'in');
  else if (msg.type === 'chain_status') updateChainPill(msg.data);
  const updateEl = document.getElementById('rt-last-update');
  if (updateEl) updateEl.textContent = `Live — ${fmtTime(new Date())}`;
}

function prependFeedItem(feedId, data, dir) {
  const feed = document.getElementById(feedId);
  if (!feed) return;
  const empty = feed.querySelector('.empty-state');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'activity-row rt-feed-item rt-feed-new';
  row.dataset.id = data.txHash || data.id;
  row.innerHTML = `
    <div class="activity-left">
      <div class="activity-icon activity-icon-${dir}">${dir === 'out' ? '&#8593;' : '&#8595;'}</div>
      <div>
        <div class="activity-title">${data.chain || 'Unknown'}</div>
        <div class="activity-detail mono truncate">${data.txHash || data.id || '—'}</div>
      </div>
    </div>
    <div class="activity-right">
      <div class="activity-amount">${fmtAmount(data.amount, data.currency)}</div>
      <div class="activity-time">${fmtTime(new Date())}</div>
    </div>
  `;
  feed.prepend(row);

  // Keep max 15 items
  const items = feed.querySelectorAll('.rt-feed-item');
  if (items.length > 15) items[items.length - 1].remove();
}

function updateChainPill(data) {
  const pill = document.querySelector(`.rt-chain-pill[data-chain="${data.chainKey}"]`);
  if (pill) {
    pill.className = `rt-chain-pill ${data.status === 'connected' ? 'rt-chain-ok' : 'rt-chain-err'}`;
    const block = pill.querySelector('.mono');
    if (block) block.textContent = `#${(data.blockNumber || 0).toLocaleString()}`;
  }
}

// Cleanup on page leave
export function destroyRealtimeDashboard() {
  if (_ws) { _ws.close(); _ws = null; }
  clearInterval(_pollInterval);
  clearTimeout(_reconnectTimeout);
}
