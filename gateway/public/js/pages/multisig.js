/**
 * Multi-Sig Approval Workflow
 *
 * Manage multi-signature approval requests for high-value transactions.
 * Shows pending approvals, quorum status, and approval history.
 */

import { api } from '../api.js';
import { staggerFadeIn, confetti, pulseElement } from '../animations.js';

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAmount(val, currency) {
  if (val == null) return '—';
  return parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + (currency ? ` ${currency}` : '');
}

function getMockApprovals() {
  return {
    pending: [
      {
        id: 'ap-001', type: 'withdrawal', status: 'pending',
        amount: '5.0', currency: 'ETH', chain: 'ethereum',
        from: '0x742d...35Cc', to: '0x9a8b...1a0b',
        requiredApprovals: 3, currentApprovals: 1,
        approvers: [
          { name: 'Alice Chen', role: 'Operator', approved: true, timestamp: new Date(Date.now() - 3600000).toISOString() },
          { name: 'Bob Kumar', role: 'Compliance', approved: false },
          { name: 'Carol Davis', role: 'Admin', approved: false },
        ],
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      {
        id: 'ap-002', type: 'policy_change', status: 'pending',
        description: 'Increase daily withdrawal limit to 100 ETH',
        requiredApprovals: 2, currentApprovals: 1,
        approvers: [
          { name: 'Alice Chen', role: 'Admin', approved: true, timestamp: new Date(Date.now() - 1800000).toISOString() },
          { name: 'David Park', role: 'CTO', approved: false },
        ],
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        expiresAt: new Date(Date.now() + 172800000).toISOString(),
      },
    ],
    history: [
      {
        id: 'ap-100', type: 'withdrawal', status: 'approved',
        amount: '2.5', currency: 'ETH', chain: 'ethereum',
        requiredApprovals: 2, currentApprovals: 2,
        completedAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'ap-099', type: 'withdrawal', status: 'rejected',
        amount: '50.0', currency: 'ETH', chain: 'ethereum',
        requiredApprovals: 3, currentApprovals: 1,
        completedAt: new Date(Date.now() - 172800000).toISOString(),
      },
      {
        id: 'ap-098', type: 'key_rotation', status: 'approved',
        description: 'Rotate HSM slot 3 keys',
        requiredApprovals: 3, currentApprovals: 3,
        completedAt: new Date(Date.now() - 259200000).toISOString(),
      },
    ],
  };
}

export async function renderMultisig() {
  let data;
  try {
    data = await api.getApprovals?.();
    if (!data) throw new Error();
  } catch {
    data = getMockApprovals();
  }

  return `
    <div class="ms-page">
      <!-- Summary -->
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:var(--sp-5)">
        <div class="kpi-card" style="border-top:3px solid var(--amber)">
          <div class="kpi-label">Pending Approvals</div>
          <div class="kpi-value text-amber">${data.pending.length}</div>
          <div class="kpi-sub">Awaiting signatures</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Approved (30d)</div>
          <div class="kpi-value text-emerald">${data.history.filter(h => h.status === 'approved').length}</div>
          <div class="kpi-sub">Completed</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Rejected (30d)</div>
          <div class="kpi-value text-red">${data.history.filter(h => h.status === 'rejected').length}</div>
          <div class="kpi-sub">Denied</div>
        </div>
      </div>

      <!-- Pending Approvals -->
      <h3 style="font-size:15px;font-weight:600;margin-bottom:var(--sp-3)">Pending Approvals</h3>
      <div class="ms-pending" id="ms-pending">
        ${data.pending.length === 0 ? '<div class="empty-state"><h3>No pending approvals</h3><p>All clear!</p></div>' :
          data.pending.map(ap => `
            <div class="card ms-approval-card" data-id="${ap.id}" style="margin-bottom:var(--sp-4);border-left:3px solid var(--amber)">
              <div class="ms-approval-header">
                <div>
                  <div style="display:flex;align-items:center;gap:var(--sp-2)">
                    <span class="badge badge-pending">${ap.type.replace('_', ' ')}</span>
                    <span class="text-xs text-muted">${ap.id}</span>
                  </div>
                  ${ap.amount ? `
                    <div style="font-size:20px;font-weight:700;margin-top:var(--sp-2)">${fmtAmount(ap.amount, ap.currency)}</div>
                    <div class="text-xs text-muted">${ap.chain || ''} &middot; ${ap.from || ''} → ${ap.to || ''}</div>
                  ` : `<div style="font-size:14px;margin-top:var(--sp-2)">${ap.description || ''}</div>`}
                </div>
                <div style="text-align:right">
                  <div class="ms-quorum">
                    <span class="ms-quorum-count">${ap.currentApprovals}/${ap.requiredApprovals}</span>
                    <span class="text-xs text-muted">signatures</span>
                  </div>
                  <div class="text-xs text-muted" style="margin-top:4px">Expires ${fmtDate(ap.expiresAt)}</div>
                </div>
              </div>

              <!-- Quorum Progress -->
              <div class="ms-quorum-bar" style="margin:var(--sp-3) 0">
                <div class="ms-quorum-fill" style="width:${(ap.currentApprovals / ap.requiredApprovals) * 100}%"></div>
              </div>

              <!-- Approvers -->
              <div class="ms-approvers">
                ${ap.approvers.map(a => `
                  <div class="ms-approver">
                    <div style="display:flex;align-items:center;gap:var(--sp-2)">
                      <div class="ms-approver-icon ${a.approved ? 'ms-approved' : 'ms-waiting'}">${a.approved ? '&#10003;' : '&#9711;'}</div>
                      <div>
                        <div class="text-sm" style="font-weight:500">${a.name}</div>
                        <div class="text-xs text-muted">${a.role}</div>
                      </div>
                    </div>
                    ${a.approved ? `<span class="text-xs text-emerald">${fmtDate(a.timestamp)}</span>` :
                      `<button class="btn btn-sm btn-primary ms-approve-btn" data-ap="${ap.id}" data-name="${a.name}">Approve</button>`}
                  </div>
                `).join('')}
              </div>

              <div class="ms-approval-actions" style="margin-top:var(--sp-3);display:flex;gap:var(--sp-2)">
                <button class="btn btn-sm btn-danger ms-reject-btn" data-ap="${ap.id}">Reject</button>
              </div>
            </div>
          `).join('')}
      </div>

      <!-- History -->
      <h3 style="font-size:15px;font-weight:600;margin:var(--sp-5) 0 var(--sp-3)">Approval History</h3>
      <div class="card">
        <table class="data-table">
          <thead><tr><th>ID</th><th>Type</th><th>Detail</th><th>Quorum</th><th>Status</th><th>Completed</th></tr></thead>
          <tbody>
            ${data.history.map(h => `
              <tr>
                <td class="mono text-xs">${h.id}</td>
                <td>${h.type.replace('_', ' ')}</td>
                <td>${h.amount ? `${fmtAmount(h.amount, h.currency)}` : (h.description || '—')}</td>
                <td>${h.currentApprovals}/${h.requiredApprovals}</td>
                <td><span class="badge ${h.status === 'approved' ? 'badge-confirmed' : 'badge-failed'}">${h.status}</span></td>
                <td class="text-muted">${fmtDate(h.completedAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function initMultisig() {
  const page = document.querySelector('.ms-page');
  if (!page) return;
  staggerFadeIn(page, '.kpi-card, .ms-approval-card, .card');

  // Approve buttons
  document.querySelectorAll('.ms-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const icon = btn.parentElement.querySelector('.ms-approver-icon');
      if (icon) {
        icon.className = 'ms-approver-icon ms-approved';
        icon.innerHTML = '&#10003;';
      }
      btn.replaceWith(Object.assign(document.createElement('span'), {
        className: 'text-xs text-emerald',
        textContent: 'Just now',
      }));

      // Update quorum
      const card = btn.closest('.ms-approval-card');
      const quorumCount = card.querySelector('.ms-quorum-count');
      const quorumFill = card.querySelector('.ms-quorum-fill');
      if (quorumCount) {
        const [current, required] = quorumCount.textContent.split('/').map(Number);
        const newCount = current + 1;
        quorumCount.textContent = `${newCount}/${required}`;
        if (quorumFill) quorumFill.style.width = `${(newCount / required) * 100}%`;

        // If quorum met → confetti + update badge
        if (newCount >= required) {
          card.style.borderLeftColor = 'var(--emerald)';
          confetti();
          const rejectBtn = card.querySelector('.ms-reject-btn');
          if (rejectBtn) rejectBtn.remove();
        }
      }

      pulseElement(card);
    });
  });

  // Reject buttons
  document.querySelectorAll('.ms-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Reject this approval request?')) return;
      const card = btn.closest('.ms-approval-card');
      card.style.borderLeftColor = 'var(--red)';
      card.style.opacity = '0.5';
      card.querySelectorAll('.ms-approve-btn').forEach(b => { b.disabled = true; });
      btn.remove();
    });
  });
}
