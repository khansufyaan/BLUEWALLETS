import { api } from '../api.js';

export async function renderWalletDetail(walletId) {
  try {
    const [wallet, txs, policies] = await Promise.all([
      api.getWallet(walletId),
      api.getTransactions(walletId),
      api.getPolicies(),
    ]);

    const attachedPolicies = policies.filter(p => wallet.policyIds.includes(p.id));
    const availablePolicies = policies.filter(p => !wallet.policyIds.includes(p.id));

    const txRows = txs.length === 0
      ? '<tr><td colspan="6" class="text-sm text-muted" style="text-align:center;padding:32px">No transactions yet</td></tr>'
      : txs.map(tx => {
          const dir = tx.fromWalletId === walletId ? 'Sent' : 'Received';
          const dirColor = dir === 'Sent' ? 'var(--red)' : 'var(--emerald)';
          return `<tr>
            <td class="mono text-xs">${new Date(tx.createdAt).toLocaleString()}</td>
            <td style="color:${dirColor};font-weight:500">${dir}</td>
            <td class="mono">${BigInt(tx.amount).toLocaleString()} ${tx.currency}</td>
            <td><span class="badge badge-${tx.status}">${tx.status}</span></td>
            <td class="mono text-xs">${tx.signature ? tx.signature.substring(0, 20) + '...' : '-'}</td>
            <td class="text-xs text-muted">${tx.failureReason || tx.memo || ''}</td>
          </tr>`;
        }).join('');

    const policyCards = attachedPolicies.map(p => `
      <div class="policy-card">
        <div class="policy-card-header">
          <span class="policy-card-name">${p.name}</span>
          <button class="btn btn-ghost btn-sm detach-policy-btn" data-policy-id="${p.id}" style="color:var(--red)">Detach</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${p.rules.map(r => `<span class="rule-chip rule-chip-${r.type}">${r.type}</span>`).join('')}
        </div>
      </div>
    `).join('');

    const attachOptions = availablePolicies.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    return `
      <div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <a href="#/wallets" class="text-sm text-muted" style="text-decoration:none">&larr; Wallets</a>
          <span class="text-tertiary">/</span>
          <h2>${wallet.name}</h2>
          <span class="chain-dot chain-dot-${wallet.chain}"></span>
          <span class="badge badge-${wallet.status}">${wallet.status}</span>
        </div>
      </div>

      <div class="hsm-badge" style="margin-bottom:24px">
        <span class="shield-icon">&#128737;</span>
        Private key secured in Luna HSM &middot; FIPS 140-3 Level 3 &middot; Key ID: <span class="mono">${wallet.keyId.substring(0, 8)}...</span>
      </div>

      <div class="grid-2" style="margin-bottom:24px">
        <div class="card">
          <div class="stat-row">
            <span class="stat-label">Address</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="mono text-sm">${wallet.address}</span>
              <button class="copy-btn" onclick="navigator.clipboard.writeText('${wallet.address}').then(()=>{this.textContent='Copied';setTimeout(()=>{this.textContent='Copy'},1000)})">Copy</button>
            </div>
          </div>
          <div class="stat-row">
            <span class="stat-label">Balance</span>
            <span class="stat-value" style="font-size:18px">${BigInt(wallet.balance).toLocaleString()} ${wallet.currency}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Chain</span>
            <span class="stat-value" style="text-transform:capitalize">${wallet.chain}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Algorithm</span>
            <span class="stat-value mono">${wallet.algorithm}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Created</span>
            <span class="stat-value">${new Date(wallet.createdAt).toLocaleDateString()}</span>
          </div>
          <div style="margin-top:16px">
            <a href="#/wallets/${wallet.id}/transfer" class="btn btn-primary btn-sm">Transfer Funds</a>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title" style="margin-bottom:16px">Policies</h3>
          ${policyCards || '<p class="text-sm text-muted">No policies attached</p>'}
          ${availablePolicies.length > 0 ? `
            <div style="margin-top:16px;display:flex;gap:8px">
              <select class="form-select" id="attach-policy-select" style="flex:1">${attachOptions}</select>
              <button class="btn btn-secondary btn-sm" id="attach-policy-btn">Attach</button>
            </div>` : ''}
        </div>
      </div>

      <div class="card">
        <h3 class="card-title" style="margin-bottom:16px">Transactions</h3>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Signature</th><th>Details</th></tr></thead>
            <tbody>${txRows}</tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initWalletDetail(walletId) {
  document.getElementById('attach-policy-btn')?.addEventListener('click', async () => {
    const select = document.getElementById('attach-policy-select');
    if (!select) return;
    try {
      await api.attachPolicy(walletId, select.value);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { alert(err.message); }
  });

  document.querySelectorAll('.detach-policy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.detachPolicy(walletId, btn.dataset.policyId);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) { alert(err.message); }
    });
  });
}
