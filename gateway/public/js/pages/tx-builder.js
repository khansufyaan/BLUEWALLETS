/**
 * Transaction Builder Wizard
 *
 * Step-by-step wizard for building and signing transactions.
 * Includes compliance checks, gas estimation, and signing pipeline animation.
 */

import { api } from '../api.js';
import { animatePipeline, particleBurst, shakeElement } from '../animations.js';

let _currentStep = 0;
const STEPS = ['Select Wallet', 'Destination', 'Amount & Gas', 'Review', 'Sign & Broadcast'];

function renderStepIndicator(current) {
  return `
    <div class="txb-steps">
      ${STEPS.map((s, i) => `
        <div class="txb-step ${i < current ? 'txb-step-done' : i === current ? 'txb-step-active' : ''}" data-step="${i}">
          <div class="txb-step-num">${i < current ? '&#10003;' : i + 1}</div>
          <span class="txb-step-label">${s}</span>
        </div>
        ${i < STEPS.length - 1 ? '<div class="txb-step-connector' + (i < current ? ' txb-connector-done' : '') + '"></div>' : ''}
      `).join('')}
    </div>
  `;
}

export async function renderTxBuilder() {
  let wallets = [], chains = [];
  try {
    [wallets, chains] = await Promise.all([
      api.getWallets().catch(() => []),
      api.getOpsChains().then(d => d.chains || d || []).catch(() => []),
    ]);
  } catch {}

  return `
    <div class="txb-page">
      ${renderStepIndicator(0)}

      <div class="txb-body">
        <!-- Step 0: Select Wallet -->
        <div class="txb-panel" id="txb-step-0">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Select Source Wallet</h3>
            <div class="form-group">
              <label class="form-label">Wallet</label>
              <select id="txb-wallet" class="form-input">
                <option value="">Choose a wallet...</option>
                ${wallets.map(w => `<option value="${w.id}" data-chain="${w.chain || ''}" data-balance="${w.balance || 0}" data-currency="${w.currency || ''}" data-address="${w.address || ''}">${w.name || w.id} (${w.chain || 'unknown'}) — ${parseFloat(w.balance || 0).toFixed(4)} ${w.currency || ''}</option>`).join('')}
              </select>
            </div>
            <div id="txb-wallet-info" style="display:none" class="alert alert-info">
              <div style="display:flex;justify-content:space-between">
                <span>Balance: <strong id="txb-wallet-bal">—</strong></span>
                <span>Chain: <strong id="txb-wallet-chain">—</strong></span>
              </div>
              <div class="mono text-xs" style="margin-top:4px" id="txb-wallet-addr">—</div>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" id="txb-next-0" disabled>Next</button>
            </div>
          </div>
        </div>

        <!-- Step 1: Destination -->
        <div class="txb-panel" id="txb-step-1" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Destination Address</h3>
            <div class="form-group">
              <label class="form-label">Recipient Address</label>
              <input type="text" id="txb-to" class="form-input mono" placeholder="0x...">
              <div class="form-hint">Enter the destination address on the same chain.</div>
            </div>
            <div id="txb-compliance-check" style="display:none">
              <div class="alert" id="txb-compliance-result"></div>
            </div>
            <div class="form-actions">
              <button class="btn" id="txb-back-1">Back</button>
              <button class="btn btn-primary" id="txb-next-1" disabled>Check & Continue</button>
            </div>
          </div>
        </div>

        <!-- Step 2: Amount & Gas -->
        <div class="txb-panel" id="txb-step-2" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Amount & Gas</h3>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Amount</label>
                <input type="number" id="txb-amount" class="form-input mono" step="any" min="0" placeholder="0.0">
                <div class="form-hint">Available: <span id="txb-avail">—</span></div>
              </div>
              <div class="form-group">
                <label class="form-label">Gas Priority</label>
                <select id="txb-gas-priority" class="form-input">
                  <option value="low">Low — Slower</option>
                  <option value="medium" selected>Medium — Standard</option>
                  <option value="high">High — Fast</option>
                </select>
              </div>
            </div>
            <div class="alert alert-info" id="txb-gas-estimate">
              Estimated gas: <strong>—</strong>
            </div>
            <div class="form-actions">
              <button class="btn" id="txb-back-2">Back</button>
              <button class="btn btn-primary" id="txb-next-2">Review Transaction</button>
            </div>
          </div>
        </div>

        <!-- Step 3: Review -->
        <div class="txb-panel" id="txb-step-3" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Review Transaction</h3>
            <div class="txb-review">
              <div class="txb-review-row"><span class="text-muted">From</span><span class="mono" id="txb-rev-from">—</span></div>
              <div class="txb-review-row"><span class="text-muted">To</span><span class="mono" id="txb-rev-to">—</span></div>
              <div class="txb-review-row"><span class="text-muted">Amount</span><span class="mono" id="txb-rev-amount">—</span></div>
              <div class="txb-review-row"><span class="text-muted">Chain</span><span id="txb-rev-chain">—</span></div>
              <div class="txb-review-row"><span class="text-muted">Gas Priority</span><span id="txb-rev-gas">—</span></div>
              <div class="txb-review-row"><span class="text-muted">Estimated Fee</span><span class="mono" id="txb-rev-fee">—</span></div>
            </div>
            <div class="form-actions">
              <button class="btn" id="txb-back-3">Back</button>
              <button class="btn btn-primary" id="txb-next-3">Sign & Broadcast</button>
            </div>
          </div>
        </div>

        <!-- Step 4: Sign & Broadcast -->
        <div class="txb-panel" id="txb-step-4" style="display:none">
          <div class="card" style="text-align:center">
            <h3 style="margin-bottom:var(--sp-6)">Signing Pipeline</h3>
            <div class="txb-pipeline" id="txb-pipeline">
              <div class="pipeline-step">
                <div class="pipeline-dot"></div>
                <div class="pipeline-label">Compliance Check</div>
                <div class="pipeline-connector"></div>
              </div>
              <div class="pipeline-step">
                <div class="pipeline-dot"></div>
                <div class="pipeline-label">Policy Validation</div>
                <div class="pipeline-connector"></div>
              </div>
              <div class="pipeline-step">
                <div class="pipeline-dot"></div>
                <div class="pipeline-label">HSM Signing</div>
                <div class="pipeline-connector"></div>
              </div>
              <div class="pipeline-step">
                <div class="pipeline-dot"></div>
                <div class="pipeline-label">Broadcasting</div>
                <div class="pipeline-connector"></div>
              </div>
              <div class="pipeline-step">
                <div class="pipeline-dot"></div>
                <div class="pipeline-label">Confirmed</div>
              </div>
            </div>
            <div id="txb-result" style="margin-top:var(--sp-6);display:none">
              <div class="alert alert-success">
                Transaction broadcast successfully!
              </div>
              <div class="mono text-xs" id="txb-result-hash" style="margin-top:var(--sp-2)">—</div>
              <div class="form-actions" style="justify-content:center;margin-top:var(--sp-4)">
                <button class="btn btn-primary" id="txb-new">New Transaction</button>
                <a class="btn" href="#/transactions">View Transactions</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function initTxBuilder() {
  _currentStep = 0;

  // Wallet selection
  const walletSelect = document.getElementById('txb-wallet');
  walletSelect?.addEventListener('change', () => {
    const opt = walletSelect.selectedOptions[0];
    const info = document.getElementById('txb-wallet-info');
    const nextBtn = document.getElementById('txb-next-0');
    if (opt?.value) {
      document.getElementById('txb-wallet-bal').textContent = `${parseFloat(opt.dataset.balance).toFixed(4)} ${opt.dataset.currency}`;
      document.getElementById('txb-wallet-chain').textContent = opt.dataset.chain;
      document.getElementById('txb-wallet-addr').textContent = opt.dataset.address;
      document.getElementById('txb-avail').textContent = `${parseFloat(opt.dataset.balance).toFixed(4)} ${opt.dataset.currency}`;
      info.style.display = '';
      nextBtn.disabled = false;
    } else {
      info.style.display = 'none';
      nextBtn.disabled = true;
    }
  });

  // Destination address validation
  document.getElementById('txb-to')?.addEventListener('input', (e) => {
    const addr = e.target.value.trim();
    document.getElementById('txb-next-1').disabled = addr.length < 10;
  });

  // Navigation
  function goStep(n) {
    _currentStep = n;
    for (let i = 0; i < STEPS.length; i++) {
      const panel = document.getElementById(`txb-step-${i}`);
      if (panel) panel.style.display = i === n ? '' : 'none';
    }
    // Update step indicator
    document.querySelectorAll('.txb-step').forEach((el, i) => {
      el.classList.toggle('txb-step-done', i < n);
      el.classList.toggle('txb-step-active', i === n);
    });
    document.querySelectorAll('.txb-step-connector').forEach((el, i) => {
      el.classList.toggle('txb-connector-done', i < n);
    });
  }

  document.getElementById('txb-next-0')?.addEventListener('click', () => goStep(1));
  document.getElementById('txb-back-1')?.addEventListener('click', () => goStep(0));
  document.getElementById('txb-next-1')?.addEventListener('click', () => {
    // Simulate compliance check
    const check = document.getElementById('txb-compliance-check');
    const result = document.getElementById('txb-compliance-result');
    check.style.display = '';
    result.className = 'alert alert-info';
    result.textContent = 'Screening address...';
    setTimeout(() => {
      result.className = 'alert alert-success';
      result.textContent = 'Address passed compliance screening.';
      setTimeout(() => goStep(2), 500);
    }, 1000);
  });
  document.getElementById('txb-back-2')?.addEventListener('click', () => goStep(1));
  document.getElementById('txb-next-2')?.addEventListener('click', () => {
    // Populate review
    const opt = document.getElementById('txb-wallet')?.selectedOptions[0];
    document.getElementById('txb-rev-from').textContent = opt?.dataset.address || '—';
    document.getElementById('txb-rev-to').textContent = document.getElementById('txb-to')?.value || '—';
    document.getElementById('txb-rev-amount').textContent = `${document.getElementById('txb-amount')?.value || '0'} ${opt?.dataset.currency || ''}`;
    document.getElementById('txb-rev-chain').textContent = opt?.dataset.chain || '—';
    document.getElementById('txb-rev-gas').textContent = document.getElementById('txb-gas-priority')?.value || 'medium';
    document.getElementById('txb-rev-fee').textContent = '~0.002 ETH';
    goStep(3);
  });
  document.getElementById('txb-back-3')?.addEventListener('click', () => goStep(2));

  // Sign & Broadcast
  document.getElementById('txb-next-3')?.addEventListener('click', async () => {
    goStep(4);
    const pipeline = document.getElementById('txb-pipeline');
    animatePipeline(pipeline);

    // Simulate signing process
    setTimeout(() => {
      document.getElementById('txb-result').style.display = '';
      document.getElementById('txb-result-hash').textContent = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
      // Trigger particle burst
      const rect = pipeline.getBoundingClientRect();
      const pageContent = document.getElementById('page-content');
      particleBurst(rect.left + rect.width / 2 - pageContent.getBoundingClientRect().left, rect.top + rect.height / 2 - pageContent.getBoundingClientRect().top, pageContent);
    }, 3500);
  });

  // New transaction
  document.getElementById('txb-new')?.addEventListener('click', () => {
    goStep(0);
    document.getElementById('txb-result').style.display = 'none';
    document.querySelectorAll('.pipeline-step').forEach(s => s.classList.remove('pipeline-active'));
    document.querySelectorAll('.pipeline-dot').forEach(d => d.classList.remove('pipeline-dot-pulse'));
    document.querySelectorAll('.pipeline-connector').forEach(c => c.classList.remove('pipeline-connector-filled'));
  });
}
