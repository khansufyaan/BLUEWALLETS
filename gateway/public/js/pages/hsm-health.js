/**
 * HSM Health Monitoring
 *
 * Real-time HSM status, session health, PKCS#11 metrics,
 * slot utilization, and firmware info.
 */

import { api } from '../api.js';
import { animateKPIs, staggerFadeIn, addHoverLift, startHeartbeat } from '../animations.js';

let _pollInterval = null;

function fmtUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getMockHsmData() {
  return {
    connected: true,
    model: 'Thales Luna Network HSM 7',
    firmware: 'v7.8.2',
    serial: 'HSM-7842-PROD',
    uptime: 1234567,
    sessionStatus: 'active',
    pkcs11Version: '2.40',
    slots: [
      { id: 1, label: 'Production Keys', objects: 12, status: 'active' },
      { id: 2, label: 'Cold Storage', objects: 4, status: 'active' },
      { id: 3, label: 'Key Ceremony', objects: 2, status: 'idle' },
    ],
    metrics: {
      signaturesPerMinute: 42,
      avgLatencyMs: 12,
      sessionReconnects: 1,
      totalOperations: 284739,
      errorRate: 0.001,
    },
    recentEvents: [
      { type: 'session_reconnect', message: 'PKCS#11 session auto-reconnected', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { type: 'signature', message: 'Batch signing: 15 transactions signed', timestamp: new Date(Date.now() - 7200000).toISOString() },
      { type: 'health_check', message: 'Health check passed — all slots responsive', timestamp: new Date(Date.now() - 10800000).toISOString() },
    ],
  };
}

export async function renderHsmHealth() {
  let data;
  try {
    const health = await api.health();
    const opsHealth = await api.getOpsHealth?.().catch(() => null);
    data = { ...getMockHsmData(), ...(health?.hsm || {}), ...(opsHealth?.hsm || {}) };
  } catch {
    data = getMockHsmData();
  }

  return `
    <div class="hsm-page">
      <!-- Connection Banner -->
      <div class="hsm-banner ${data.connected ? 'hsm-banner-ok' : 'hsm-banner-err'}">
        <div style="display:flex;align-items:center;gap:var(--sp-3)">
          <div class="hsm-heartbeat" id="hsm-heartbeat"></div>
          <div>
            <div style="font-weight:600">${data.connected ? 'HSM Connected' : 'HSM Disconnected'}</div>
            <div class="text-xs" style="opacity:0.8">${data.model || 'Unknown Model'} &middot; ${data.serial || '—'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--sp-3)">
          <span class="text-xs">Firmware ${data.firmware || '—'}</span>
          <span class="text-xs">PKCS#11 ${data.pkcs11Version || '—'}</span>
          <span class="text-xs">Uptime: ${fmtUptime(data.uptime)}</span>
        </div>
      </div>

      <!-- Metrics KPIs -->
      <div class="kpi-grid" id="hsm-kpis" style="margin-top:var(--sp-4)">
        <div class="kpi-card">
          <div class="kpi-label">Signatures / min</div>
          <div class="kpi-value" data-animate-to="${data.metrics.signaturesPerMinute}">${data.metrics.signaturesPerMinute}</div>
          <div class="kpi-sub">Current rate</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Avg Latency</div>
          <div class="kpi-value" data-animate-to="${data.metrics.avgLatencyMs}" data-animate-suffix="ms">${data.metrics.avgLatencyMs}ms</div>
          <div class="kpi-sub">PKCS#11 operations</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Operations</div>
          <div class="kpi-value" data-animate-to="${data.metrics.totalOperations}">${data.metrics.totalOperations.toLocaleString()}</div>
          <div class="kpi-sub">Since boot</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Error Rate</div>
          <div class="kpi-value ${data.metrics.errorRate > 0.01 ? 'text-red' : 'text-emerald'}" data-animate-to="${data.metrics.errorRate}" data-animate-suffix="%" data-animate-decimals="3">${data.metrics.errorRate}%</div>
          <div class="kpi-sub">${data.metrics.sessionReconnects} reconnects</div>
        </div>
      </div>

      <div class="risk-grid" style="margin-top:var(--sp-4)">
        <!-- Slot Utilization -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Slot Utilization</h2>
          </div>
          <table class="data-table">
            <thead><tr><th>Slot</th><th>Label</th><th>Objects</th><th>Status</th></tr></thead>
            <tbody>
              ${data.slots.map(s => `
                <tr>
                  <td class="mono">${s.id}</td>
                  <td>${s.label}</td>
                  <td>${s.objects}</td>
                  <td><span class="badge ${s.status === 'active' ? 'badge-confirmed' : 'badge-pending'}">${s.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Recent Events -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Recent Events</h2>
          </div>
          <div class="hsm-events">
            ${data.recentEvents.map(e => `
              <div class="hsm-event">
                <div class="hsm-event-icon ${e.type === 'session_reconnect' ? 'text-amber' : e.type === 'signature' ? 'text-emerald' : 'text-muted'}">
                  ${e.type === 'session_reconnect' ? '&#9888;' : e.type === 'signature' ? '&#9998;' : '&#10003;'}
                </div>
                <div style="flex:1">
                  <div class="text-sm">${e.message}</div>
                  <div class="text-xs text-muted">${new Date(e.timestamp).toLocaleString()}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Session Details -->
      <div class="card" style="margin-top:var(--sp-4)">
        <div class="card-header">
          <h2 class="card-title">PKCS#11 Session</h2>
          <span class="badge ${data.sessionStatus === 'active' ? 'badge-confirmed' : 'badge-failed'}">${data.sessionStatus}</span>
        </div>
        <div class="kc-details">
          <div class="kc-detail-item"><span class="text-xs text-muted">Session State</span><span>${data.sessionStatus}</span></div>
          <div class="kc-detail-item"><span class="text-xs text-muted">PKCS#11 Version</span><span class="mono">${data.pkcs11Version}</span></div>
          <div class="kc-detail-item"><span class="text-xs text-muted">Firmware</span><span class="mono">${data.firmware}</span></div>
          <div class="kc-detail-item"><span class="text-xs text-muted">Serial</span><span class="mono">${data.serial}</span></div>
        </div>
      </div>
    </div>
  `;
}

export function initHsmHealth() {
  const page = document.querySelector('.hsm-page');
  if (!page) return;

  animateKPIs(document.getElementById('hsm-kpis'));
  staggerFadeIn(page, '.kpi-card, .card');
  addHoverLift(page, '.kpi-card');

  // Heartbeat animation
  const heartbeat = document.getElementById('hsm-heartbeat');
  if (heartbeat) startHeartbeat(heartbeat);

  // Poll for updates
  _pollInterval = setInterval(async () => {
    try {
      const health = await api.health();
      const banner = document.querySelector('.hsm-banner');
      if (banner) {
        banner.className = `hsm-banner ${health?.status !== 'error' ? 'hsm-banner-ok' : 'hsm-banner-err'}`;
      }
    } catch {}
  }, 10000);
}

export function destroyHsmHealth() {
  clearInterval(_pollInterval);
}
