/**
 * Risk Dashboard
 *
 * Risk scoring, threat indicators, transaction anomaly detection,
 * and compliance posture overview.
 */

import { api } from '../api.js';
import { animateKPIs, staggerFadeIn, addHoverLift, animateCounter } from '../animations.js';

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function riskColor(score) {
  if (score <= 30) return 'var(--emerald)';
  if (score <= 60) return 'var(--amber)';
  return 'var(--red)';
}

function riskLabel(score) {
  if (score <= 30) return 'Low';
  if (score <= 60) return 'Medium';
  return 'High';
}

// Mock risk data
function getMockRiskData() {
  return {
    overallScore: 23,
    complianceScore: 95,
    policyViolations: 2,
    flaggedTransactions: 1,
    alerts: [
      { id: 'a1', type: 'anomaly', severity: 'warning', message: 'Unusual withdrawal volume detected — 3x average', timestamp: new Date(Date.now() - 1800000).toISOString() },
      { id: 'a2', type: 'compliance', severity: 'info', message: 'Address 0x742d...35Cc cleared by TRM Labs', timestamp: new Date(Date.now() - 7200000).toISOString() },
      { id: 'a3', type: 'policy', severity: 'error', message: 'Transfer blocked — exceeds daily limit policy', timestamp: new Date(Date.now() - 14400000).toISOString() },
    ],
    riskBreakdown: [
      { category: 'Transaction Volume', score: 15, trend: 'stable' },
      { category: 'Counterparty Risk', score: 8, trend: 'down' },
      { category: 'Compliance Posture', score: 5, trend: 'stable' },
      { category: 'Operational Risk', score: 20, trend: 'up' },
      { category: 'Key Management', score: 10, trend: 'stable' },
    ],
    recentScreenings: [
      { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58', result: 'clear', provider: 'TRM Labs', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { address: '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', result: 'clear', provider: 'Chainalysis', timestamp: new Date(Date.now() - 7200000).toISOString() },
      { address: '0xDEAD000000000000000000000000000000000000', result: 'flagged', provider: 'TRM Labs', timestamp: new Date(Date.now() - 10800000).toISOString() },
    ],
  };
}

export async function renderRiskDashboard() {
  let data;
  try {
    data = await api.getRiskData?.();
    if (!data) throw new Error();
  } catch {
    data = getMockRiskData();
  }

  const scoreColor = riskColor(data.overallScore);
  const scoreLabel = riskLabel(data.overallScore);

  return `
    <div class="risk-page">
      <!-- Risk Score KPIs -->
      <div class="kpi-grid" id="risk-kpis">
        <div class="kpi-card" style="border-top:3px solid ${scoreColor}">
          <div class="kpi-label">Overall Risk Score</div>
          <div style="display:flex;align-items:center;gap:var(--sp-3)">
            <div class="risk-gauge" id="risk-gauge">
              <svg viewBox="0 0 100 50" width="100" height="50">
                <path d="M10 45 A35 35 0 0 1 90 45" fill="none" stroke="var(--bg-elevated)" stroke-width="8" stroke-linecap="round"/>
                <path d="M10 45 A35 35 0 0 1 90 45" fill="none" stroke="${scoreColor}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${data.overallScore * 1.1} 110" class="risk-gauge-fill"/>
              </svg>
            </div>
            <div>
              <div class="kpi-value" style="color:${scoreColor}" data-animate-to="${data.overallScore}">${data.overallScore}</div>
              <div class="kpi-sub">${scoreLabel} Risk</div>
            </div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Compliance Score</div>
          <div class="kpi-value text-emerald" data-animate-to="${data.complianceScore}" data-animate-suffix="%">${data.complianceScore}%</div>
          <div class="kpi-sub">Provider coverage</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Policy Violations</div>
          <div class="kpi-value ${data.policyViolations > 0 ? 'text-amber' : ''}" data-animate-to="${data.policyViolations}">${data.policyViolations}</div>
          <div class="kpi-sub">Last 24 hours</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Flagged Transactions</div>
          <div class="kpi-value ${data.flaggedTransactions > 0 ? 'text-red' : ''}" data-animate-to="${data.flaggedTransactions}">${data.flaggedTransactions}</div>
          <div class="kpi-sub">Requires review</div>
        </div>
      </div>

      <div class="risk-grid">
        <!-- Risk Breakdown -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Risk Breakdown</h2>
          </div>
          <div class="risk-bars">
            ${data.riskBreakdown.map(r => `
              <div class="risk-bar-row">
                <div class="risk-bar-label">
                  <span>${r.category}</span>
                  <span style="color:${riskColor(r.score)}">${r.score}/100</span>
                </div>
                <div class="risk-bar-track">
                  <div class="risk-bar-fill" style="width:${r.score}%;background:${riskColor(r.score)}"></div>
                </div>
                <span class="text-xs ${r.trend === 'up' ? 'text-red' : r.trend === 'down' ? 'text-emerald' : 'text-muted'}">
                  ${r.trend === 'up' ? '&#9650;' : r.trend === 'down' ? '&#9660;' : '&#8212;'}
                </span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Active Alerts -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Active Alerts</h2>
            <span class="count-badge">${data.alerts.length}</span>
          </div>
          <div class="risk-alerts">
            ${data.alerts.map(a => `
              <div class="risk-alert risk-alert-${a.severity}">
                <div class="risk-alert-icon">${a.severity === 'error' ? '&#9888;' : a.severity === 'warning' ? '&#9888;' : '&#8505;'}</div>
                <div style="flex:1">
                  <div class="risk-alert-msg">${a.message}</div>
                  <div class="text-xs text-muted">${fmtDate(a.timestamp)}</div>
                </div>
                <button class="btn btn-sm btn-ghost">Dismiss</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Recent Screenings -->
      <div class="card" style="margin-top:var(--sp-4)">
        <div class="card-header">
          <h2 class="card-title">Recent Screenings</h2>
        </div>
        <table class="data-table">
          <thead><tr><th>Address</th><th>Result</th><th>Provider</th><th>Time</th></tr></thead>
          <tbody>
            ${data.recentScreenings.map(s => `
              <tr>
                <td class="mono truncate" style="max-width:200px">${s.address}</td>
                <td><span class="badge ${s.result === 'clear' ? 'badge-confirmed' : 'badge-failed'}">${s.result}</span></td>
                <td>${s.provider}</td>
                <td class="text-muted">${fmtDate(s.timestamp)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function initRiskDashboard() {
  const page = document.querySelector('.risk-page');
  if (!page) return;
  animateKPIs(document.getElementById('risk-kpis'));
  staggerFadeIn(page, '.kpi-card, .card');
  addHoverLift(page, '.kpi-card');

  // Animate risk bars
  setTimeout(() => {
    document.querySelectorAll('.risk-bar-fill').forEach(bar => {
      const width = bar.style.width;
      bar.style.width = '0%';
      bar.style.transition = 'width 0.8s ease';
      setTimeout(() => { bar.style.width = width; }, 100);
    });
  }, 300);

  // Dismiss alerts
  document.querySelectorAll('.risk-alert .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const alert = btn.closest('.risk-alert');
      alert.style.opacity = '0';
      alert.style.transform = 'translateX(20px)';
      alert.style.transition = 'all 0.3s ease';
      setTimeout(() => alert.remove(), 300);
    });
  });
}
