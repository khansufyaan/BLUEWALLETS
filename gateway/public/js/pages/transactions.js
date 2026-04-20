import { api } from '../api.js';

export async function renderTransactions() {
  const [txResult, wallets] = await Promise.all([
    api.getOpsTransactions(),
    api.getWallets().catch(() => []),
  ]);
  const transactions = txResult.transactions || [];

  const walletOptions = wallets.map(w =>
    `<option value="${w.id}" data-chain="${w.chain}" data-address="${w.address}" data-name="${w.name}">${w.name} (${w.address.slice(0,6)}...${w.address.slice(-4)}) — ${w.chain}</option>`
  ).join('');

  const rows = transactions.map(tx => {
    const amountWei = BigInt(tx.amount || '0');
    const eth = Number(amountWei) / 1e18;
    const statusIcon = tx.status === 'confirmed' ? '&#10003;' : tx.status === 'failed' ? '&#10007;' : '&#8943;';
    return `
      <tr>
        <td><span class="badge badge-${tx.status}">${statusIcon} ${tx.status}</span></td>
        <td><span class="chain-dot chain-dot-${tx.chain}"></span>${tx.chain}</td>
        <td><span class="mono wallet-addr" title="${tx.from}">${tx.from?.slice(0,8)}...${tx.from?.slice(-6)}</span></td>
        <td><span class="mono wallet-addr" title="${tx.to}">${tx.to?.slice(0,8)}...${tx.to?.slice(-6)}</span></td>
        <td class="mono">${eth.toFixed(6)} ETH</td>
        <td>${tx.txHash ? `<a href="https://sepolia.etherscan.io/tx/${tx.txHash}" target="_blank" class="mono wallet-addr">${tx.txHash.slice(0,10)}...</a>` : '—'}</td>
        <td class="text-tertiary">${new Date(tx.createdAt).toLocaleString()}</td>
        <td><button class="explain-tx-btn" data-tx-id="${tx.id || tx.txHash || ''}" title="Explain with AI">&#129302; Explain</button></td>
      </tr>`;
  }).join('');

  return `
    <div class="page-header">
      <div class="page-header-left">
        <h2>Withdrawals</h2>
        <span class="count-badge">${transactions.length}</span>
      </div>
      <button class="btn btn-primary" id="open-withdrawal">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:6px">
          <path d="M7 10V1M4 4l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M1 10v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        New Withdrawal
      </button>
    </div>

    ${transactions.length === 0
      ? `<div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="var(--border)" stroke-width="1.5"/>
                <path d="M20 28V14M14 18l6-6 6 6" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <h3>No withdrawals yet</h3>
            <p>Click "New Withdrawal" to send crypto from a wallet to an external address.</p>
          </div>
        </div>`
      : `<div class="card" style="padding:0;overflow:hidden">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Chain</th>
                <th>From</th>
                <th>To</th>
                <th>Amount</th>
                <th>Tx Hash</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`}

    <!-- Withdrawal Modal -->
    <div class="modal-overlay" id="withdrawal-modal">
      <div class="modal modal-lg">
        <div class="modal-header">
          <div>
            <h3>New Withdrawal</h3>
            <p class="text-sm text-muted" style="margin-top:2px">Send crypto from a Blue wallet to an external address</p>
          </div>
          <button class="modal-close" id="close-withdrawal" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div id="withdrawal-result"></div>

        <form id="withdrawal-form">
          <!-- Source Wallet -->
          <div class="form-group">
            <label class="form-label">Source Wallet</label>
            <select class="form-input" id="w-wallet" required>
              <option value="">Select a wallet...</option>
              ${walletOptions}
            </select>
          </div>

          <!-- Wallet Info (auto-populated) -->
          <div id="w-wallet-info" style="display:none;margin-bottom:16px">
            <div style="display:flex;gap:var(--sp-3)">
              <div style="flex:1;padding:10px 14px;background:var(--bg-elevated);border-radius:var(--r-md)">
                <div class="text-xs text-muted" style="margin-bottom:2px">Chain</div>
                <div id="w-chain-display" style="font-weight:500"></div>
              </div>
              <div style="flex:2;padding:10px 14px;background:var(--bg-elevated);border-radius:var(--r-md)">
                <div class="text-xs text-muted" style="margin-bottom:2px">Address</div>
                <div id="w-address-display" class="mono wallet-addr" style="font-size:12px"></div>
              </div>
            </div>
          </div>

          <!-- Destination -->
          <div class="form-group">
            <label class="form-label">Destination Address</label>
            <input type="text" class="form-input mono" id="w-to" placeholder="0x..." required style="font-size:13px">
            <div class="form-hint">The external wallet address to send to</div>
          </div>

          <!-- Amount -->
          <div class="form-group">
            <label class="form-label">Amount (Wei)</label>
            <input type="text" class="form-input mono" id="w-amount" placeholder="1000000000000000000" required>
            <div class="form-hint" id="w-amount-hint">1 ETH = 1,000,000,000,000,000,000 wei (18 decimals)</div>
          </div>

          <!-- Pipeline Preview -->
          <div style="padding:12px;background:var(--bg-elevated);border-radius:var(--r-md);margin-bottom:16px">
            <div class="text-xs text-muted" style="margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Execution Pipeline</div>
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);flex-wrap:wrap">
              <span style="padding:3px 8px;background:rgba(59,130,246,0.1);border-radius:4px;color:var(--blue-400)">Compliance Screen</span>
              <span style="color:var(--text-tertiary)">&#8594;</span>
              <span style="padding:3px 8px;background:rgba(59,130,246,0.1);border-radius:4px;color:var(--blue-400)">Build TX</span>
              <span style="color:var(--text-tertiary)">&#8594;</span>
              <span style="padding:3px 8px;background:rgba(16,185,129,0.1);border-radius:4px;color:var(--emerald)">HSM Sign</span>
              <span style="color:var(--text-tertiary)">&#8594;</span>
              <span style="padding:3px 8px;background:rgba(139,92,246,0.1);border-radius:4px;color:#8B5CF6">Broadcast</span>
            </div>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="cancel-withdrawal">Cancel</button>
            <button type="submit" class="btn btn-primary" id="submit-withdrawal">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:4px">
                <path d="M7 10V1M4 4l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Execute Withdrawal
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function initTransactions() {
  const modal = document.getElementById('withdrawal-modal');
  const walletSelect = document.getElementById('w-wallet');
  const walletInfo = document.getElementById('w-wallet-info');

  // Open modal
  document.getElementById('open-withdrawal')?.addEventListener('click', () => {
    modal?.classList.add('active');
    setTimeout(() => walletSelect?.focus(), 100);
  });

  // Close modal
  const closeModal = () => {
    modal?.classList.remove('active');
    document.getElementById('withdrawal-form')?.reset();
    if (walletInfo) walletInfo.style.display = 'none';
    const r = document.getElementById('withdrawal-result');
    if (r) r.innerHTML = '';
  };
  document.getElementById('close-withdrawal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-withdrawal')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeModal();
  });

  // Wallet selection — show chain + address
  walletSelect?.addEventListener('change', () => {
    const option = walletSelect.selectedOptions[0];
    if (option && option.value) {
      document.getElementById('w-chain-display').textContent = option.dataset.chain;
      document.getElementById('w-address-display').textContent = option.dataset.address;
      walletInfo.style.display = 'block';
    } else {
      walletInfo.style.display = 'none';
    }
  });

  // Submit withdrawal
  document.getElementById('withdrawal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultDiv = document.getElementById('withdrawal-result');
    const btn = document.getElementById('submit-withdrawal');
    const option = walletSelect?.selectedOptions[0];

    const walletId = walletSelect?.value;
    const toAddress = document.getElementById('w-to')?.value?.trim();
    const amount = document.getElementById('w-amount')?.value?.trim();
    const chain = option?.dataset?.chain;

    if (!walletId || !toAddress || !amount || !chain) {
      resultDiv.innerHTML = '<div class="alert alert-error">All fields are required</div>';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `
      <svg class="login-spinner" width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right:4px">
        <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
        <path d="M14 8a6 6 0 0 0-6-6" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Executing...
    `;
    resultDiv.innerHTML = '';

    try {
      const result = await api.executeWithdrawal({ walletId, toAddress, amount, chain });

      const esc = s => (s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      const txHash = esc(result.txHash || '');
      resultDiv.innerHTML = `
        <div class="alert alert-success" style="margin-bottom:16px">
          <div style="font-weight:600;margin-bottom:4px">Withdrawal Submitted</div>
          <div style="font-size:12px">
            ${txHash
              ? `Tx Hash: <span class="mono">${txHash.slice(0,16)}...</span>`
              : 'Transaction submitted to mempool'}
          </div>
        </div>
      `;
      btn.innerHTML = '&#10003; Submitted';

      // Refresh page after delay
      setTimeout(() => {
        closeModal();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }, 2000);
    } catch (err) {
      const msg = (err.message || 'Unknown error').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      resultDiv.innerHTML = `<div class="alert alert-error">${msg}</div>`;
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:4px">
          <path d="M7 10V1M4 4l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Execute Withdrawal
      `;
    }
  });
}
