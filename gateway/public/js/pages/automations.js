/**
 * Automations — Orchestration Builder
 *
 * Fireblocks-style When → If → Then automation rules.
 * Create policies that react to wallet events (deposits, transfers, thresholds).
 */

import { api } from '../api.js';
import { staggerFadeIn } from '../animations.js';

// ── Sample Automations (fetched from API in production) ─────────────────

function getMockAutomations() {
  return [
    {
      id: 'auto-1', name: 'Sweep deposits to treasury', active: true,
      trigger: { type: 'transaction', direction: 'inbound', sourceWallets: ['All wallets'], asset: 'ETH', amountGte: '0' },
      condition: { type: 'unconditional' },
      action: { type: 'transfer', from: 'Deposit Vault', to: 'Treasury Vault', amountType: 'full', asset: 'inherited' },
    },
    {
      id: 'auto-2', name: 'Liquidate non-USDC stables', active: false,
      trigger: { type: 'transaction', direction: 'inbound', sourceWallets: ['Issuer Settlement'], asset: 'USDT', amountGte: '0.99' },
      condition: { type: 'unconditional' },
      action: { type: 'transfer', from: 'Issuer Deposit Vault', to: 'Test Main Account', amountType: 'full', asset: 'inherited' },
    },
    {
      id: 'auto-3', name: 'Daily cold storage sweep', active: true,
      trigger: { type: 'time', schedule: 'daily', time: '02:00 UTC' },
      condition: { type: 'balance_above', asset: 'ETH', threshold: '10' },
      action: { type: 'transfer', from: 'Hot Wallet', to: 'Cold Storage', amountType: 'partial', amount: '90%', asset: 'ETH' },
    },
  ];
}

function triggerLabel(t) {
  if (t.type === 'time') return `${t.schedule === 'daily' ? 'Daily' : t.schedule} at ${t.time || '—'}`;
  const dir = t.direction === 'inbound' ? 'incoming' : 'outgoing';
  const wallets = (t.sourceWallets || []).join(', ') || 'Any wallet';
  const amt = t.amountGte ? ` >= ${t.amountGte}` : '';
  return `All ${t.asset || 'any'} ${dir} transactions${amt} from ${wallets}`;
}

function conditionLabel(c) {
  if (!c || c.type === 'unconditional') return 'Unconditional';
  if (c.type === 'balance_above') return `Balance > ${c.threshold} ${c.asset || ''}`;
  if (c.type === 'balance_below') return `Balance < ${c.threshold} ${c.asset || ''}`;
  if (c.type === 'whitelist') return `Destination in whitelist`;
  return c.type;
}

function actionLabel(a) {
  const amtStr = a.amountType === 'full' ? 'All' : a.amountType === 'partial' ? a.amount : a.amount || '—';
  const assetStr = a.asset === 'inherited' ? 'Inherited asset' : (a.asset || '—');
  return `Transfer ${amtStr} ${assetStr} from ${a.from || '—'} to ${a.to || '—'}`;
}

export async function renderAutomations() {
  let automations, wallets = [], vaults = [];
  try {
    automations = await api.getAutomations?.();
    if (!automations || !Array.isArray(automations)) throw new Error();
  } catch {
    automations = getMockAutomations();
  }
  try {
    [wallets, vaults] = await Promise.all([
      api.getWallets().catch(() => []),
      api.getVaults().catch(() => []),
    ]);
  } catch {}

  const allTargets = [
    ...vaults.map(v => ({ id: v.id, name: v.name, type: 'vault' })),
    ...wallets.map(w => ({ id: w.id, name: w.name, type: 'wallet' })),
  ];

  return `
    <div class="auto-page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-5)">
        <div style="display:flex;align-items:center;gap:var(--sp-3)">
          <span class="count-badge">${automations.length} automations</span>
          <span class="text-xs text-muted">${automations.filter(a => a.active).length} active</span>
        </div>
        <button class="btn btn-primary" id="auto-create-btn">+ Create Automation</button>
      </div>

      <!-- Automation List -->
      <div class="auto-list" id="auto-list">
        ${automations.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">&#9881;</div>
            <h3>No automations yet</h3>
            <p>Create an automation to trigger actions based on wallet events.</p>
          </div>
        ` : automations.map(a => `
          <div class="card auto-card ${a.active ? '' : 'auto-card-inactive'}" data-id="${a.id}" style="margin-bottom:var(--sp-4)">
            <div class="auto-card-header">
              <div style="display:flex;align-items:center;gap:var(--sp-3)">
                <h3 style="font-size:15px;font-weight:600">${a.name}</h3>
              </div>
              <div style="display:flex;align-items:center;gap:var(--sp-3)">
                <label class="auto-toggle">
                  <input type="checkbox" ${a.active ? 'checked' : ''} class="auto-toggle-input" data-id="${a.id}">
                  <span class="auto-toggle-slider"></span>
                </label>
                <button class="btn btn-sm btn-ghost auto-delete-btn" data-id="${a.id}" style="color:var(--red)">Delete</button>
              </div>
            </div>

            <div class="auto-flow">
              <div class="auto-flow-step">
                <div class="auto-flow-label">When</div>
                <div class="auto-flow-box auto-flow-when">
                  <div class="auto-flow-icon">${a.trigger.type === 'time' ? '&#9201;' : '&#8693;'}</div>
                  <div>
                    <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.05em">${a.trigger.type === 'time' ? 'Time' : 'Transaction'}</div>
                    <div class="text-sm">${triggerLabel(a.trigger)}</div>
                  </div>
                </div>
              </div>
              <div class="auto-flow-connector"></div>
              <div class="auto-flow-step">
                <div class="auto-flow-label">If</div>
                <div class="auto-flow-box auto-flow-if">
                  <div class="auto-flow-icon">&#9888;</div>
                  <div class="text-sm">${conditionLabel(a.condition)}</div>
                </div>
              </div>
              <div class="auto-flow-connector"></div>
              <div class="auto-flow-step">
                <div class="auto-flow-label">Then</div>
                <div class="auto-flow-box auto-flow-then">
                  <div class="auto-flow-icon">&#8599;</div>
                  <div class="text-sm">${actionLabel(a.action)}</div>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Create/Edit Automation Modal -->
      <div class="modal-overlay" id="auto-modal">
        <div class="modal" style="max-width:620px">
          <div class="modal-header">
            <h3>Create Automation</h3>
            <button class="modal-close" id="auto-modal-close">&times;</button>
          </div>
          <form id="auto-form">
            <!-- Name -->
            <div class="form-group">
              <label class="form-label">Automation Name</label>
              <input type="text" id="auto-name" class="form-input" placeholder="Name this automation" required>
            </div>

            <!-- WHEN: Trigger -->
            <div class="auto-section">
              <div class="auto-section-label">When</div>
              <div class="auto-section-desc">Choose how to trigger the automation.</div>

              <div class="form-group">
                <label class="form-label">Trigger Type</label>
                <div class="auto-trigger-select" id="auto-trigger-type">
                  <button type="button" class="auto-trigger-btn" data-type="time">
                    <span style="font-size:18px">&#9201;</span>
                    <span>Time</span>
                  </button>
                  <button type="button" class="auto-trigger-btn active" data-type="transaction">
                    <span style="font-size:18px">&#8693;</span>
                    <span>Transaction</span>
                  </button>
                </div>
              </div>

              <!-- Time trigger fields -->
              <div id="auto-trigger-time" style="display:none">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Schedule</label>
                    <select id="auto-time-schedule" class="form-input">
                      <option value="daily">Daily</option>
                      <option value="hourly">Hourly</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Time (UTC)</label>
                    <input type="time" id="auto-time-value" class="form-input" value="02:00">
                  </div>
                </div>
              </div>

              <!-- Transaction trigger fields -->
              <div id="auto-trigger-tx">
                <div class="form-group">
                  <label class="form-label">Direction</label>
                  <select id="auto-tx-direction" class="form-input">
                    <option value="inbound">Inbound (deposits)</option>
                    <option value="outbound">Outbound (withdrawals)</option>
                    <option value="any">Any</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Source Wallets / Vaults</label>
                  <select id="auto-tx-source" class="form-input" multiple style="min-height:60px">
                    <option value="*" selected>All wallets</option>
                    ${allTargets.map(t => `<option value="${t.id}">${t.name} (${t.type})</option>`).join('')}
                  </select>
                  <div class="form-hint">Hold Cmd/Ctrl to select multiple.</div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Asset</label>
                    <select id="auto-tx-asset" class="form-input">
                      <option value="">Any asset</option>
                      <option value="ETH">ETH</option>
                      <option value="BTC">BTC</option>
                      <option value="USDC">USDC</option>
                      <option value="USDT">USDT</option>
                      <option value="MATIC">MATIC</option>
                      <option value="SOL">SOL</option>
                      <option value="BNB">BNB</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Amount >=</label>
                    <input type="text" id="auto-tx-amount" class="form-input mono" placeholder="0" value="0">
                  </div>
                </div>
              </div>
            </div>

            <!-- IF: Condition -->
            <div class="auto-section">
              <div class="auto-section-label">If</div>
              <div class="form-group">
                <label class="form-label">Condition</label>
                <select id="auto-condition-type" class="form-input">
                  <option value="unconditional">Unconditional (always)</option>
                  <option value="balance_above">Balance above threshold</option>
                  <option value="balance_below">Balance below threshold</option>
                  <option value="whitelist">Destination in whitelist</option>
                </select>
              </div>
              <div id="auto-condition-threshold" style="display:none">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Asset</label>
                    <input type="text" id="auto-cond-asset" class="form-input" placeholder="ETH">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Threshold</label>
                    <input type="text" id="auto-cond-threshold" class="form-input mono" placeholder="10">
                  </div>
                </div>
              </div>
            </div>

            <!-- THEN: Action -->
            <div class="auto-section">
              <div class="auto-section-label">Then</div>

              <div class="form-group">
                <label class="form-label">Action Type</label>
                <select id="auto-action-type" class="form-input">
                  <option value="transfer">Transfer</option>
                </select>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">From</label>
                  <select id="auto-action-from" class="form-input">
                    <option value="">Select source...</option>
                    ${allTargets.map(t => `<option value="${t.name}">${t.name} (${t.type})</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">To</label>
                  <select id="auto-action-to" class="form-input">
                    <option value="">Select destination...</option>
                    ${allTargets.map(t => `<option value="${t.name}">${t.name} (${t.type})</option>`).join('')}
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Amount</label>
                <div class="auto-amount-tabs" id="auto-amount-tabs">
                  <button type="button" class="filter-tab" data-amt="specific">Specific amount</button>
                  <button type="button" class="filter-tab active" data-amt="full">Full amount</button>
                  <button type="button" class="filter-tab" data-amt="partial">Partial amount</button>
                  <button type="button" class="filter-tab" data-amt="inherited">Inherited</button>
                </div>
              </div>
              <div id="auto-amount-specific" style="display:none" class="form-group">
                <input type="text" id="auto-action-amount" class="form-input mono" placeholder="Amount">
              </div>
              <div id="auto-amount-partial" style="display:none" class="form-group">
                <input type="text" id="auto-action-pct" class="form-input mono" placeholder="e.g. 90%">
              </div>

              <div class="form-group">
                <label class="form-label">Asset</label>
                <select id="auto-action-asset" class="form-input">
                  <option value="inherited">Inherited from trigger</option>
                  <option value="ETH">ETH</option>
                  <option value="BTC">BTC</option>
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="MATIC">MATIC</option>
                </select>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn" id="auto-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Automation</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

export function initAutomations() {
  const page = document.querySelector('.auto-page');
  if (!page) return;
  staggerFadeIn(page, '.auto-card');

  const modal = document.getElementById('auto-modal');

  // Open/close modal
  document.getElementById('auto-create-btn')?.addEventListener('click', () => modal?.classList.add('active'));
  document.getElementById('auto-modal-close')?.addEventListener('click', () => modal?.classList.remove('active'));
  document.getElementById('auto-cancel')?.addEventListener('click', () => modal?.classList.remove('active'));

  // Trigger type toggle
  document.querySelectorAll('#auto-trigger-type .auto-trigger-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#auto-trigger-type .auto-trigger-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.type;
      document.getElementById('auto-trigger-time').style.display = type === 'time' ? '' : 'none';
      document.getElementById('auto-trigger-tx').style.display = type === 'transaction' ? '' : 'none';
    });
  });

  // Condition type toggle
  document.getElementById('auto-condition-type')?.addEventListener('change', (e) => {
    const showThreshold = e.target.value === 'balance_above' || e.target.value === 'balance_below';
    document.getElementById('auto-condition-threshold').style.display = showThreshold ? '' : 'none';
  });

  // Amount type toggle
  document.querySelectorAll('#auto-amount-tabs .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#auto-amount-tabs .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.dataset.amt;
      document.getElementById('auto-amount-specific').style.display = t === 'specific' ? '' : 'none';
      document.getElementById('auto-amount-partial').style.display = t === 'partial' ? '' : 'none';
    });
  });

  // Toggle active/inactive
  document.querySelectorAll('.auto-toggle-input').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const card = toggle.closest('.auto-card');
      card.classList.toggle('auto-card-inactive', !toggle.checked);
    });
  });

  // Delete automation
  document.querySelectorAll('.auto-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this automation?')) return;
      const card = btn.closest('.auto-card');
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      card.style.transition = 'all 0.3s ease';
      setTimeout(() => card.remove(), 300);
    });
  });

  // Create automation (form submit)
  document.getElementById('auto-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const triggerType = document.querySelector('#auto-trigger-type .auto-trigger-btn.active')?.dataset.type || 'transaction';
    const amountType = document.querySelector('#auto-amount-tabs .filter-tab.active')?.dataset.amt || 'full';

    const automation = {
      name: document.getElementById('auto-name').value,
      active: true,
      trigger: triggerType === 'time' ? {
        type: 'time',
        schedule: document.getElementById('auto-time-schedule').value,
        time: document.getElementById('auto-time-value').value + ' UTC',
      } : {
        type: 'transaction',
        direction: document.getElementById('auto-tx-direction').value,
        sourceWallets: [...document.getElementById('auto-tx-source').selectedOptions].map(o => o.textContent),
        asset: document.getElementById('auto-tx-asset').value || undefined,
        amountGte: document.getElementById('auto-tx-amount').value || '0',
      },
      condition: (() => {
        const ct = document.getElementById('auto-condition-type').value;
        if (ct === 'unconditional') return { type: 'unconditional' };
        return { type: ct, asset: document.getElementById('auto-cond-asset')?.value, threshold: document.getElementById('auto-cond-threshold')?.value };
      })(),
      action: {
        type: document.getElementById('auto-action-type').value,
        from: document.getElementById('auto-action-from').value,
        to: document.getElementById('auto-action-to').value,
        amountType,
        amount: amountType === 'specific' ? document.getElementById('auto-action-amount')?.value : amountType === 'partial' ? document.getElementById('auto-action-pct')?.value : undefined,
        asset: document.getElementById('auto-action-asset').value,
      },
    };

    try {
      await api.createAutomation?.(automation);
    } catch {}

    modal.classList.remove('active');

    // Add the card to the list visually
    const list = document.getElementById('auto-list');
    const empty = list.querySelector('.empty-state');
    if (empty) empty.remove();

    const card = document.createElement('div');
    card.className = 'card auto-card';
    card.style.marginBottom = 'var(--sp-4)';
    card.innerHTML = `
      <div class="auto-card-header">
        <h3 style="font-size:15px;font-weight:600">${automation.name}</h3>
        <span class="badge badge-confirmed">active</span>
      </div>
      <div class="auto-flow">
        <div class="auto-flow-step">
          <div class="auto-flow-label">When</div>
          <div class="auto-flow-box auto-flow-when">
            <div class="auto-flow-icon">${automation.trigger.type === 'time' ? '&#9201;' : '&#8693;'}</div>
            <div class="text-sm">${triggerLabel(automation.trigger)}</div>
          </div>
        </div>
        <div class="auto-flow-connector"></div>
        <div class="auto-flow-step">
          <div class="auto-flow-label">If</div>
          <div class="auto-flow-box auto-flow-if">
            <div class="text-sm">${conditionLabel(automation.condition)}</div>
          </div>
        </div>
        <div class="auto-flow-connector"></div>
        <div class="auto-flow-step">
          <div class="auto-flow-label">Then</div>
          <div class="auto-flow-box auto-flow-then">
            <div class="text-sm">${actionLabel(automation.action)}</div>
          </div>
        </div>
      </div>
    `;
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px)';
    list.prepend(card);
    requestAnimationFrame(() => {
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  });
}
