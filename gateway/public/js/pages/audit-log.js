/**
 * Audit Log Viewer
 *
 * Searchable, filterable audit log with timeline view.
 * Shows all system events: logins, transactions, policy changes, etc.
 */

import { api } from '../api.js';
import { staggerFadeIn } from '../animations.js';

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const EVENT_ICONS = {
  'auth.login': '&#128274;', 'auth.logout': '&#128275;', 'auth.failed': '&#9888;',
  'wallet.create': '&#128179;', 'wallet.transfer': '&#8644;',
  'vault.create': '&#128274;', 'policy.create': '&#128737;', 'policy.update': '&#128737;',
  'key.generate': '&#128273;', 'key.ceremony': '&#127881;',
  'api_key.create': '&#128273;', 'api_key.revoke': '&#128683;',
  'webhook.create': '&#128268;', 'webhook.update': '&#128268;',
  'settings.update': '&#9881;', 'role.update': '&#128100;',
  'default': '&#128196;',
};

const EVENT_COLORS = {
  'auth': 'var(--blue-400)', 'wallet': 'var(--emerald)',
  'vault': '#8B5CF6', 'policy': 'var(--amber)',
  'key': '#06B6D4', 'api_key': '#EC4899',
  'webhook': '#F97316', 'settings': 'var(--text-secondary)',
  'role': '#8B5CF6', 'default': 'var(--text-tertiary)',
};

// Generate mock audit data (in production, fetched from API)
function generateMockAuditData() {
  const events = [
    { event: 'auth.login', actor: 'admin', detail: 'Logged in from 10.0.1.15', severity: 'info' },
    { event: 'wallet.create', actor: 'admin', detail: 'Created wallet "Hot Wallet ETH" in vault Production', severity: 'info' },
    { event: 'wallet.transfer', actor: 'operator', detail: 'Withdrawal 0.5 ETH to 0x742d...35Cc', severity: 'warning' },
    { event: 'policy.create', actor: 'admin', detail: 'Created policy "Daily Limit 10 ETH"', severity: 'info' },
    { event: 'api_key.create', actor: 'admin', detail: 'Generated API key for Bank Integration', severity: 'info' },
    { event: 'auth.failed', actor: 'unknown', detail: 'Failed login attempt from 192.168.1.100', severity: 'error' },
    { event: 'key.generate', actor: 'admin', detail: 'Generated new HD key in HSM slot 3', severity: 'warning' },
    { event: 'settings.update', actor: 'admin', detail: 'Updated compliance provider to TRM Labs', severity: 'info' },
    { event: 'vault.create', actor: 'admin', detail: 'Created vault "Cold Storage"', severity: 'info' },
    { event: 'policy.update', actor: 'admin', detail: 'Updated whitelist for policy "Approved Destinations"', severity: 'warning' },
    { event: 'auth.login', actor: 'auditor', detail: 'Logged in from 10.0.2.30', severity: 'info' },
    { event: 'wallet.transfer', actor: 'operator', detail: 'Withdrawal 1.2 ETH to 0x9a8b...12Dd', severity: 'warning' },
  ];

  const now = Date.now();
  return events.map((e, i) => ({
    id: `evt-${1000 - i}`,
    ...e,
    timestamp: new Date(now - i * 3600000 * (Math.random() * 2 + 0.5)).toISOString(),
    ip: e.event.startsWith('auth') ? (e.detail.match(/[\d.]+/) || ['—'])[0] : undefined,
  }));
}

export async function renderAuditLog() {
  // Try real API, fallback to mock
  let events;
  try {
    const data = await api.getAuditLog?.();
    events = data?.events || data || [];
  } catch {
    events = generateMockAuditData();
  }

  const categories = [...new Set(events.map(e => e.event.split('.')[0]))];

  return `
    <div class="audit-page">
      <!-- Filters -->
      <div class="audit-toolbar">
        <div class="search-bar">
          <input type="text" id="audit-search" placeholder="Search events, actors, details..." class="form-input" style="max-width:320px">
        </div>
        <div class="audit-filters">
          <div class="filter-tabs" id="audit-category-filter">
            <button class="filter-tab active" data-cat="all">All</button>
            ${categories.map(c => `<button class="filter-tab" data-cat="${c}">${c}</button>`).join('')}
          </div>
          <div class="filter-tabs" id="audit-severity-filter">
            <button class="filter-tab active" data-sev="all">All</button>
            <button class="filter-tab" data-sev="info">Info</button>
            <button class="filter-tab" data-sev="warning">Warning</button>
            <button class="filter-tab" data-sev="error">Error</button>
          </div>
        </div>
      </div>

      <!-- Event Count -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-4)">
        <span class="text-sm text-muted" id="audit-count">${events.length} events</span>
        <button class="btn btn-sm" id="audit-export">Export CSV</button>
      </div>

      <!-- Timeline -->
      <div class="audit-timeline" id="audit-timeline">
        ${events.map(e => {
          const category = e.event.split('.')[0];
          const icon = EVENT_ICONS[e.event] || EVENT_ICONS.default;
          const color = EVENT_COLORS[category] || EVENT_COLORS.default;
          return `
            <div class="audit-entry" data-cat="${category}" data-sev="${e.severity || 'info'}" data-search="${(e.event + ' ' + e.actor + ' ' + e.detail).toLowerCase()}">
              <div class="audit-entry-marker" style="border-color:${color}">
                <span class="audit-entry-icon">${icon}</span>
              </div>
              <div class="audit-entry-content">
                <div class="audit-entry-header">
                  <span class="audit-entry-event" style="color:${color}">${e.event}</span>
                  <span class="badge badge-${e.severity === 'error' ? 'failed' : e.severity === 'warning' ? 'pending' : 'confirmed'}">${e.severity || 'info'}</span>
                </div>
                <div class="audit-entry-detail">${e.detail}</div>
                <div class="audit-entry-meta">
                  <span>Actor: <strong>${e.actor}</strong></span>
                  ${e.ip ? `<span>IP: <code>${e.ip}</code></span>` : ''}
                  <span>${fmtDate(e.timestamp)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function initAuditLog() {
  const page = document.querySelector('.audit-page');
  if (!page) return;

  staggerFadeIn(page, '.audit-entry');

  // Search filter
  document.getElementById('audit-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    filterEntries();
  });

  // Category filter
  document.querySelectorAll('#audit-category-filter .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#audit-category-filter .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterEntries();
    });
  });

  // Severity filter
  document.querySelectorAll('#audit-severity-filter .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#audit-severity-filter .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterEntries();
    });
  });

  // Export
  document.getElementById('audit-export')?.addEventListener('click', () => {
    const entries = document.querySelectorAll('.audit-entry:not([style*="display: none"])');
    let csv = 'Event,Actor,Detail,Severity,Timestamp\n';
    entries.forEach(e => {
      const event = e.querySelector('.audit-entry-event')?.textContent || '';
      const detail = e.querySelector('.audit-entry-detail')?.textContent || '';
      const actor = e.dataset.search || '';
      const sev = e.dataset.sev || '';
      csv += `"${event}","${actor}","${detail}","${sev}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audit-log.csv';
    a.click();
  });
}

function filterEntries() {
  const search = (document.getElementById('audit-search')?.value || '').toLowerCase();
  const cat = document.querySelector('#audit-category-filter .filter-tab.active')?.dataset.cat || 'all';
  const sev = document.querySelector('#audit-severity-filter .filter-tab.active')?.dataset.sev || 'all';

  let count = 0;
  document.querySelectorAll('.audit-entry').forEach(entry => {
    const matchCat = cat === 'all' || entry.dataset.cat === cat;
    const matchSev = sev === 'all' || entry.dataset.sev === sev;
    const matchSearch = !search || entry.dataset.search.includes(search);
    const show = matchCat && matchSev && matchSearch;
    entry.style.display = show ? '' : 'none';
    if (show) count++;
  });

  const countEl = document.getElementById('audit-count');
  if (countEl) countEl.textContent = `${count} events`;
}
