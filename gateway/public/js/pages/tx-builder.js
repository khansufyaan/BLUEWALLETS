/**
 * Transaction Builder Wizard
 *
 * Step-by-step wizard for building and executing real transfers.
 * Calls the actual transfer API — no simulated data.
 */

import { api } from '../api.js';
import { shakeElement } from '../animations.js';

let _currentStep = 0;
const STEPS = ['Select Wallet', 'Destination', 'Amount', 'Review & Submit'];

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
  let wallets = [];
  try {
    wallets = await api.getWallets().catch(() => []);
  } catch {}

  return `
    <div class="txb-page">
      ${renderStepIndicator(0)}

      <div class="txb-body">
        <!-- Step 0: Select Source Wallet -->
        <div class="txb-panel" id="txb-step-0">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Select Source Wallet</h3>
            <div class="form-group">
              <label class="form-label">Wallet</label>
              <select id="txb-wallet" class="form-input">
                <option value="">Choose a wallet...</option>
                ${wallets.map(w => `<option value="${w.id}" data-chain="${w.chain || ''}" data-balance="${w.balance || 0}" data-currency="${w.currency || ''}" data-address="${w.address || ''}" data-name="${w.name || w.id}">${w.name || w.id} (${w.chain || 'unknown'}) — ${parseFloat(w.balance || 0).toFixed(4)} ${w.currency || ''}</option>`).join('')}
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
            <h3 style="margin-bottom:var(--sp-4)">Destination</h3>
            <div class="form-group">
              <label class="form-label">Destination Wallet</label>
              <select id="txb-dest" class="form-input">
                <option value="">Choose destination wallet...</option>
                ${wallets.map(w => `<option value="${w.id}" data-address="${w.address || ''}" data-name="${w.name || w.id}">${w.name || w.id} (${w.chain || 'unknown'})</option>`).join('')}
              </select>
              <div class="form-hint">Select the wallet to receive funds.</div>
            </div>
            <div class="form-actions">
              <button class="btn" id="txb-back-1">Back</button>
              <button class="btn btn-primary" id="txb-next-1" disabled>Continue</button>
            </div>
          </div>
        </div>

        <!-- Step 2: Amount -->
        <div class="txb-panel" id="txb-step-2" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Transfer Amount</h3>
            <div class="form-group">
              <label class="form-label">Amount (smallest unit)</label>
              <input type="text" id="txb-amount" class="form-input mono" pattern="\\d+" placeholder="e.g. 1000000">
              <div class="form-hint">Enter amount in the smallest unit (wei, satoshi, lamport, etc.). Available: <span id="txb-avail">—</span></div>
            </div>
            <div class="form-group">
              <label class="form-label">Currency</label>
              <input type="text" id="txb-currency" class="form-input mono" readonly>
            </div>
            <div class="form-group">
              <label class="form-label">Memo (optional)</label>
              <input type="text" id="txb-memo" class="form-input" placeholder="Optional note for this transfer">
            </div>
            <div class="form-actions">
              <button class="btn" id="txb-back-2">Back</button>
              <button class="btn btn-primary" id="txb-next-2">Review</button>
            </div>
          </div>
        </div>

        <!-- Step 3: Review & Submit -->
        <div class="txb-panel" id="txb-step-3" style="display:none">
          <div class="card">
            <h3 style="margin-bottom:var(--sp-4)">Review Transfer</h3>
            <div class="txb-review">
              <div class="txb-review-row"><span class="text-muted">From</span><span id="txb-rev-from">—</span></div>
              <div class="txb-review-row"><span class="text-muted">From Address</span><span class="mono text-sm" id="txb-rev-from-addr">—</span></div>
              <div class="txb-review-row"><span class="text-muted">To</span><span id="txb-rev-to">—</span></div>
              <div class="txb-review-row"><span class="text-muted">To Address</span><span class="mono text-sm" id="txb-rev-to-addr">—</span></div>
              <div class="txb-review-row"><span class="text-muted">Amount</span><span class="mono" id="txb-rev-amount">—</span></div>
              <div class="txb-review-row"><span class="text-muted">Chain</span><span id="txb-rev-chain">—</span></div>
              ${'' /* no gas estimate — we don't know it */}
            </div>
            <div class="alert alert-info" style="margin-top:var(--sp-4)">
              This will execute a real transfer via the HSM signing pipeline. The transaction will be submitted to the Driver for policy checks, compliance screening, and HSM signing.
            </div>
            <div id="txb-submit-result" style="margin-top:var(--sp-3)"></div>
            <div class="form-actions">
              <button class="btn" id="txb-back-3">Back</button>
              <button class="btn btn-primary" id="txb-submit">Submit Transfer</button>
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
      document.getElementById('txb-wallet-bal').textContent = `${opt.dataset.balance} ${opt.dataset.currency}`;
      document.getElementById('txb-wallet-chain').textContent = opt.dataset.chain;
      document.getElementById('txb-wallet-addr').textContent = opt.dataset.address;
      document.getElementById('txb-avail').textContent = `${opt.dataset.balance} ${opt.dataset.currency}`;
      document.getElementById('txb-currency').value = opt.dataset.currency;
      info.style.display = '';
      nextBtn.disabled = false;
    } else {
      info.style.display = 'none';
      nextBtn.disabled = true;
    }
  });

  // Destination selection
  document.getElementById('txb-dest')?.addEventListener('change', (e) => {
    document.getElementById('txb-next-1').disabled = !e.target.value;
  });

  // Navigation
  function goStep(n) {
    _currentStep = n;
    for (let i = 0; i < STEPS.length; i++) {
      const panel = document.getElementById(`txb-step-${i}`);
      if (panel) panel.style.display = i === n ? '' : 'none';
    }
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
  document.getElementById('txb-next-1')?.addEventListener('click', () => goStep(2));
  document.getElementById('txb-back-2')?.addEventListener('click', () => goStep(1));
  document.getElementById('txb-next-2')?.addEventListener('click', () => {
    const srcOpt = document.getElementById('txb-wallet')?.selectedOptions[0];
    const dstOpt = document.getElementById('txb-dest')?.selectedOptions[0];
    document.getElementById('txb-rev-from').textContent = srcOpt?.dataset.name || '—';
    document.getElementById('txb-rev-from-addr').textContent = srcOpt?.dataset.address || '—';
    document.getElementById('txb-rev-to').textContent = dstOpt?.dataset.name || '—';
    document.getElementById('txb-rev-to-addr').textContent = dstOpt?.dataset.address || '—';
    document.getElementById('txb-rev-amount').textContent = `${document.getElementById('txb-amount')?.value || '0'} ${document.getElementById('txb-currency')?.value || ''}`;
    document.getElementById('txb-rev-chain').textContent = srcOpt?.dataset.chain || '—';
    goStep(3);
  });
  document.getElementById('txb-back-3')?.addEventListener('click', () => goStep(2));

  // Submit — calls the real API
  document.getElementById('txb-submit')?.addEventListener('click', async () => {
    const submitBtn = document.getElementById('txb-submit');
    const resultDiv = document.getElementById('txb-submit-result');
    const walletId = document.getElementById('txb-wallet')?.value;
    const toWalletId = document.getElementById('txb-dest')?.value;
    const amount = document.getElementById('txb-amount')?.value;
    const currency = document.getElementById('txb-currency')?.value;
    const memo = document.getElementById('txb-memo')?.value;

    if (!walletId || !toWalletId || !amount) {
      resultDiv.innerHTML = '<div class="alert alert-error">Missing required fields.</div>';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    resultDiv.innerHTML = '';

    try {
      const tx = await api.transfer(walletId, {
        toWalletId,
        amount: parseInt(amount, 10),
        currency,
        memo: memo || undefined,
      });

      const status = tx.status || 'submitted';
      const isOk = status === 'completed';
      const isRejected = status === 'rejected';

      resultDiv.innerHTML = `
        <div class="alert ${isOk ? 'alert-success' : isRejected ? 'alert-error' : 'alert-info'}">
          <strong>Transfer ${status}</strong>
          ${tx.id ? `<div class="mono text-xs" style="margin-top:4px">TX ID: ${tx.id}</div>` : ''}
          ${tx.signature ? `<div class="mono text-xs" style="margin-top:2px">Signature: ${tx.signature.substring(0, 32)}...</div>` : ''}
          ${tx.failureReason ? `<div style="margin-top:4px">${tx.failureReason}</div>` : ''}
        </div>
        <div class="form-actions" style="margin-top:var(--sp-3)">
          <button class="btn btn-primary" onclick="location.hash='#/transactions'">View Transactions</button>
          <button class="btn" onclick="location.reload()">New Transfer</button>
        </div>
      `;
      submitBtn.style.display = 'none';
      document.getElementById('txb-back-3').style.display = 'none';
    } catch (err) {
      resultDiv.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Transfer';
    }
  });
}
