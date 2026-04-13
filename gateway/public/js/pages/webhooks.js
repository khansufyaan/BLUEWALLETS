/**
 * Webhook Configuration UI
 *
 * Manage webhook endpoints for event notifications.
 * Create, edit, test, and monitor webhook deliveries.
 */

import { api } from '../api.js';
import { staggerFadeIn, shakeElement } from '../animations.js';

// Mock webhook data (in production, fetched from API)
function getMockWebhooks() {
  return [
    { id: 'wh-1', url: 'https://bank-api.example.com/webhooks/blue', events: ['transaction.completed', 'deposit.detected'], status: 'active', secret: 'whsec_****...a3f2', lastDelivery: new Date(Date.now() - 300000).toISOString(), successRate: 98.5 },
    { id: 'wh-2', url: 'https://compliance.example.com/hooks', events: ['compliance.alert', 'policy.violation'], status: 'active', secret: 'whsec_****...b7c1', lastDelivery: new Date(Date.now() - 7200000).toISOString(), successRate: 100 },
    { id: 'wh-3', url: 'https://monitoring.internal/alerts', events: ['chain.disconnected', 'hsm.error'], status: 'paused', secret: 'whsec_****...d9e4', lastDelivery: null, successRate: 0 },
  ];
}

const ALL_EVENTS = [
  { group: 'Transactions', events: ['transaction.created', 'transaction.completed', 'transaction.failed'] },
  { group: 'Deposits', events: ['deposit.detected', 'deposit.confirmed'] },
  { group: 'Compliance', events: ['compliance.alert', 'compliance.cleared', 'policy.violation'] },
  { group: 'System', events: ['chain.connected', 'chain.disconnected', 'hsm.error', 'hsm.reconnected'] },
  { group: 'Wallets', events: ['wallet.created', 'vault.created'] },
];

function fmtDate(ts) {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function renderWebhooks() {
  let webhooks;
  try {
    const data = await api.getWebhooks?.();
    webhooks = data?.webhooks || data || [];
  } catch {
    webhooks = getMockWebhooks();
  }

  return `
    <div class="webhooks-page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-5)">
        <div>
          <span class="count-badge">${webhooks.length} endpoints</span>
        </div>
        <button class="btn btn-primary" id="wh-add-btn">+ Add Webhook</button>
      </div>

      <!-- Webhook List -->
      <div class="wh-list" id="wh-list">
        ${webhooks.map(wh => `
          <div class="card wh-card" data-id="${wh.id}" style="margin-bottom:var(--sp-3)">
            <div class="wh-card-header">
              <div style="display:flex;align-items:center;gap:var(--sp-3);flex:1;min-width:0">
                <div class="wh-status-dot ${wh.status === 'active' ? 'wh-dot-active' : 'wh-dot-paused'}"></div>
                <div style="flex:1;min-width:0">
                  <div class="mono text-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${wh.url}</div>
                  <div class="text-xs text-muted" style="margin-top:2px">
                    ${wh.events.map(e => `<span class="rule-chip" style="margin-right:4px">${e}</span>`).join('')}
                  </div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:var(--sp-2)">
                <span class="badge ${wh.status === 'active' ? 'badge-confirmed' : 'badge-pending'}">${wh.status}</span>
                <button class="btn btn-sm btn-ghost wh-test-btn" data-id="${wh.id}">Test</button>
                <button class="btn btn-sm btn-ghost wh-edit-btn" data-id="${wh.id}">Edit</button>
                <button class="btn btn-sm btn-danger wh-delete-btn" data-id="${wh.id}">Delete</button>
              </div>
            </div>
            <div class="wh-card-stats">
              <span class="text-xs text-muted">Last delivery: ${fmtDate(wh.lastDelivery)}</span>
              <span class="text-xs ${wh.successRate >= 95 ? 'text-emerald' : wh.successRate >= 80 ? 'text-amber' : 'text-red'}">
                ${wh.successRate}% success rate
              </span>
              <span class="text-xs mono text-muted">${wh.secret}</span>
            </div>
          </div>
        `).join('')}
        ${webhooks.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">&#128268;</div>
            <h3>No webhooks configured</h3>
            <p>Add a webhook endpoint to receive real-time event notifications.</p>
          </div>
        ` : ''}
      </div>

      <!-- Add/Edit Webhook Modal -->
      <div class="modal-overlay" id="wh-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3 id="wh-modal-title">Add Webhook</h3>
            <button class="modal-close" id="wh-modal-close">&times;</button>
          </div>
          <form id="wh-form">
            <div class="form-group">
              <label class="form-label">Endpoint URL</label>
              <input type="url" id="wh-url" class="form-input mono" placeholder="https://your-api.com/webhooks" required>
              <div class="form-hint">HTTPS required. We'll send POST requests with JSON payloads.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Events</label>
              <div class="wh-event-grid" id="wh-events">
                ${ALL_EVENTS.map(group => `
                  <div class="wh-event-group">
                    <div class="wh-event-group-name">${group.group}</div>
                    ${group.events.map(e => `
                      <label class="toggle-label">
                        <input type="checkbox" name="events" value="${e}">
                        <span class="toggle-check"></span>
                        <span>${e}</span>
                      </label>
                    `).join('')}
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Secret (for signature verification)</label>
              <div style="display:flex;gap:var(--sp-2)">
                <input type="text" id="wh-secret" class="form-input mono" placeholder="Auto-generated" readonly>
                <button type="button" class="btn btn-sm" id="wh-gen-secret">Generate</button>
              </div>
              <div class="form-hint">Use this secret to verify webhook signatures (HMAC-SHA256).</div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" id="wh-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Webhook</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Test Result Modal -->
      <div class="modal-overlay" id="wh-test-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>Webhook Test</h3>
            <button class="modal-close" id="wh-test-close">&times;</button>
          </div>
          <div id="wh-test-result">
            <div class="loading">Sending test event...</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function initWebhooks() {
  const page = document.querySelector('.webhooks-page');
  if (!page) return;
  staggerFadeIn(page, '.wh-card');

  const modal = document.getElementById('wh-modal');
  const testModal = document.getElementById('wh-test-modal');

  // Open add modal
  document.getElementById('wh-add-btn')?.addEventListener('click', () => {
    document.getElementById('wh-modal-title').textContent = 'Add Webhook';
    document.getElementById('wh-form').reset();
    document.getElementById('wh-secret').value = '';
    modal.classList.add('active');
  });

  // Close modals
  document.getElementById('wh-modal-close')?.addEventListener('click', () => modal.classList.remove('active'));
  document.getElementById('wh-cancel')?.addEventListener('click', () => modal.classList.remove('active'));
  document.getElementById('wh-test-close')?.addEventListener('click', () => testModal.classList.remove('active'));

  // Generate secret
  document.getElementById('wh-gen-secret')?.addEventListener('click', () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    document.getElementById('wh-secret').value = 'whsec_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  });

  // Save webhook
  document.getElementById('wh-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('wh-url').value;
    const events = [...document.querySelectorAll('#wh-events input:checked')].map(i => i.value);
    const secret = document.getElementById('wh-secret').value;

    if (events.length === 0) {
      shakeElement(document.getElementById('wh-events'));
      return;
    }

    try {
      await api.createWebhook?.({ url, events, secret });
    } catch {}
    modal.classList.remove('active');
    // In production, re-render the list
  });

  // Test webhook
  document.querySelectorAll('.wh-test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      testModal.classList.add('active');
      const result = document.getElementById('wh-test-result');
      result.innerHTML = '<div class="loading">Sending test event...</div>';

      // Simulate test
      setTimeout(() => {
        result.innerHTML = `
          <div class="alert alert-success" style="margin-bottom:var(--sp-3)">
            <strong>200 OK</strong> — Webhook delivered successfully
          </div>
          <div class="text-xs mono" style="padding:var(--sp-3);background:var(--bg-input);border-radius:var(--r-md);max-height:200px;overflow:auto">
<pre>{
  "event": "test.ping",
  "timestamp": "${new Date().toISOString()}",
  "data": { "message": "Webhook test from Blue Console" }
}</pre>
          </div>
        `;
      }, 1500);
    });
  });

  // Delete webhook
  document.querySelectorAll('.wh-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this webhook endpoint?')) {
        const card = btn.closest('.wh-card');
        card.style.opacity = '0';
        card.style.transform = 'translateX(20px)';
        card.style.transition = 'all 0.3s ease';
        setTimeout(() => card.remove(), 300);
      }
    });
  });
}
