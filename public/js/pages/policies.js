import { api } from '../api.js';

const RULE_TYPES = [
  { value: 'spending_limit', label: 'Spending Limit', paramLabel: 'Max Amount', paramKey: 'maxAmount' },
  { value: 'daily_limit', label: 'Daily Limit', paramLabel: 'Max Daily Amount', paramKey: 'maxDailyAmount' },
  { value: 'velocity', label: 'Velocity', paramLabel: 'Max Transactions', paramKey: 'maxTransactions', extraKey: 'windowMinutes', extraLabel: 'Window (min)' },
  { value: 'approval_threshold', label: 'Approval Threshold', paramLabel: 'Threshold', paramKey: 'threshold' },
  { value: 'whitelist', label: 'Whitelist', paramLabel: 'Wallet IDs (comma-sep)', paramKey: 'walletIds' },
  { value: 'blacklist', label: 'Blacklist', paramLabel: 'Wallet IDs (comma-sep)', paramKey: 'walletIds' },
  { value: 'time_window', label: 'Time Window', paramLabel: 'Start Hour (0-23)', paramKey: 'allowedHoursStart', extraKey: 'allowedHoursEnd', extraLabel: 'End Hour' },
];

export async function renderPolicies() {
  try {
    const policies = await api.getPolicies();

    const policyCards = policies.map(p => `
      <div class="policy-card">
        <div class="policy-card-header">
          <div>
            <span class="policy-card-name">${p.name}</span>
            <span class="badge badge-${p.enabled ? 'active' : 'rejected'}" style="margin-left:8px">${p.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <button class="btn btn-ghost btn-sm delete-policy-btn" data-id="${p.id}" style="color:var(--red)">Delete</button>
        </div>
        ${p.description ? `<p class="text-sm text-muted" style="margin-bottom:10px">${p.description}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${p.rules.map(r => `<span class="rule-chip rule-chip-${r.type}">${r.type}</span>`).join('')}
        </div>
      </div>
    `).join('');

    return `
      <div class="policies-page">
        <div class="page-header">
          <div class="page-header-left">
            <h2>Policies</h2>
            <span class="count-badge">${policies.length}</span>
          </div>
          <button class="btn btn-primary" id="open-create-policy">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:6px">
              <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Create Policy
          </button>
        </div>
        ${policies.length === 0
          ? `<div class="card"><div class="empty-state">
              <div class="empty-state-icon">&#128737;</div>
              <h3>No policies yet</h3>
              <p>Policies enforce rules on wallet transactions. Create one to add governance.</p>
            </div></div>`
          : `<div class="policy-grid">${policyCards}</div>`}
      </div>

      <!-- Create Policy Modal -->
      <div class="modal-overlay" id="create-policy-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>Create Policy</h3>
            <button class="modal-close" id="close-create-policy" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div id="policy-result"></div>
          <form id="create-policy-form">
            <div class="form-group">
              <label class="form-label">Policy Name</label>
              <input type="text" class="form-input" id="p-name" placeholder="e.g. Standard Limits" required>
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input type="text" class="form-input" id="p-desc" placeholder="What this policy enforces">
            </div>
            <div class="form-group">
              <label class="form-label">Rules</label>
              <div id="rules-container"></div>
              <button type="button" class="btn btn-secondary btn-sm" id="add-rule-btn" style="margin-top:8px">+ Add Rule</button>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="cancel-create-policy">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Policy</button>
            </div>
          </form>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initPolicies() {
  const modal = document.getElementById('create-policy-modal');
  const container = document.getElementById('rules-container');
  const typeOptions = RULE_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');

  // Open modal
  document.getElementById('open-create-policy')?.addEventListener('click', () => {
    modal.classList.add('active');
    setTimeout(() => document.getElementById('p-name')?.focus(), 100);
  });

  // Close modal
  const closeModal = () => {
    modal.classList.remove('active');
    document.getElementById('create-policy-form')?.reset();
    if (container) container.innerHTML = '';
    addRuleRow();
    const r = document.getElementById('policy-result');
    if (r) r.innerHTML = '';
  };
  document.getElementById('close-create-policy')?.addEventListener('click', closeModal);
  document.getElementById('cancel-create-policy')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeModal();
  });

  function addRuleRow() {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `
      <select class="rule-type">${typeOptions}</select>
      <input class="rule-param" placeholder="Value">
      <input class="rule-extra" placeholder="" style="display:none">
      <button type="button" class="btn btn-ghost btn-sm rule-remove" style="color:var(--red);padding:6px">&#10005;</button>
    `;
    container?.appendChild(row);

    const typeSelect = row.querySelector('.rule-type');
    const paramInput = row.querySelector('.rule-param');
    const extraInput = row.querySelector('.rule-extra');

    function updatePlaceholders() {
      const rt = RULE_TYPES.find(t => t.value === typeSelect.value);
      paramInput.placeholder = rt?.paramLabel || 'Value';
      if (rt?.extraKey) { extraInput.style.display = ''; extraInput.placeholder = rt.extraLabel || ''; }
      else { extraInput.style.display = 'none'; }
    }
    typeSelect.addEventListener('change', updatePlaceholders);
    updatePlaceholders();
    row.querySelector('.rule-remove').addEventListener('click', () => row.remove());
  }

  document.getElementById('add-rule-btn')?.addEventListener('click', addRuleRow);
  addRuleRow();

  document.getElementById('create-policy-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultDiv = document.getElementById('policy-result');
    const ruleRows = container?.querySelectorAll('.rule-row') || [];
    const rules = [];

    for (const row of ruleRows) {
      const type = row.querySelector('.rule-type').value;
      const paramValue = row.querySelector('.rule-param').value;
      const extraValue = row.querySelector('.rule-extra').value;
      const rt = RULE_TYPES.find(t => t.value === type);
      if (!rt || !paramValue) continue;

      const params = {};
      if (rt.paramKey === 'walletIds') params[rt.paramKey] = paramValue.split(',').map(s => s.trim());
      else if (['maxTransactions', 'allowedHoursStart'].includes(rt.paramKey)) params[rt.paramKey] = parseInt(paramValue);
      else params[rt.paramKey] = paramValue;
      if (rt.extraKey && extraValue) params[rt.extraKey] = parseInt(extraValue);
      rules.push({ type, params });
    }

    if (rules.length === 0) { resultDiv.innerHTML = '<div class="alert alert-warning">Add at least one rule</div>'; return; }

    try {
      await api.createPolicy({ name: document.getElementById('p-name').value, description: document.getElementById('p-desc').value || undefined, rules });
      resultDiv.innerHTML = '<div class="alert alert-success">Policy created!</div>';
      setTimeout(() => { closeModal(); window.dispatchEvent(new HashChangeEvent('hashchange')); }, 600);
    } catch (err) {
      resultDiv.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  document.querySelectorAll('.delete-policy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await api.deletePolicy(btn.dataset.id); window.dispatchEvent(new HashChangeEvent('hashchange')); }
      catch (err) { alert(err.message); }
    });
  });
}
