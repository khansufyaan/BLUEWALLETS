import { api } from '../api.js';

export async function renderTransfer(fromWalletId) {
  try {
    const [sourceWallet, wallets] = await Promise.all([
      api.getWallet(fromWalletId),
      api.getWallets(),
    ]);
    const destinations = wallets.filter(w => w.id !== fromWalletId);
    const destOptions = destinations.map(w =>
      `<option value="${w.id}">${w.name} (${w.chain} - ${w.currency})</option>`
    ).join('');

    return `
      <div style="max-width:560px">
        <div style="margin-bottom:24px">
          <a href="#/wallets/${fromWalletId}" class="text-sm text-muted" style="text-decoration:none">&larr; Back to wallet</a>
          <h2 style="margin-top:8px">Transfer Funds</h2>
        </div>
        <div class="card">
          <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
            <div class="text-xs text-tertiary" style="text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">From</div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chain-dot chain-dot-${sourceWallet.chain}"></span>
              <strong>${sourceWallet.name}</strong>
              <span class="text-muted">&middot;</span>
              <span class="mono text-sm">${BigInt(sourceWallet.balance).toLocaleString()} ${sourceWallet.currency}</span>
            </div>
          </div>
          <div id="transfer-result"></div>
          <form id="transfer-form">
            <div class="form-group">
              <label class="form-label">Destination Wallet</label>
              <select class="form-select" id="t-dest" required>${destOptions}</select>
            </div>
            <div class="input-group">
              <div class="form-group">
                <label class="form-label">Amount</label>
                <input type="text" class="form-input" id="t-amount" placeholder="0" required pattern="\\d+">
              </div>
              <div class="form-group">
                <label class="form-label">Currency</label>
                <input type="text" class="form-input" id="t-currency" value="${sourceWallet.currency}" required>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Memo</label>
              <input type="text" class="form-input" id="t-memo" placeholder="Optional note">
            </div>
            <button type="submit" class="btn btn-primary" id="t-submit">Execute Transfer</button>
          </form>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initTransfer(fromWalletId) {
  document.getElementById('transfer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultDiv = document.getElementById('transfer-result');
    const submitBtn = document.getElementById('t-submit');

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="signing-spinner" style="width:14px;height:14px"></span> Signing with Luna HSM...';

    try {
      const tx = await api.transfer(fromWalletId, {
        toWalletId: document.getElementById('t-dest').value,
        amount: document.getElementById('t-amount').value,
        currency: document.getElementById('t-currency').value,
        memo: document.getElementById('t-memo').value || undefined,
      });

      if (tx.status === 'rejected') {
        const evals = (tx.policyEvaluations || [])
          .filter(ev => !ev.passed)
          .map(ev => {
            const name = (ev.policyName || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
            const reason = (ev.reason || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
            return `<div style="margin-top:4px">&bull; <strong>${name}</strong>: ${reason}</div>`;
          })
          .join('');
        resultDiv.innerHTML = `<div class="alert alert-error">Transfer rejected by policy${evals}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Execute Transfer';
      } else {
        const sig = (tx.signature || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
        resultDiv.innerHTML = `
          <div class="alert alert-success">
            Transfer completed<br>
            <div class="mono text-xs" style="margin-top:6px">Signature: ${sig.substring(0, 48)}...</div>
          </div>`;
        submitBtn.textContent = 'Transfer Complete';
      }
    } catch (err) {
      const msg = (err.message || 'Unknown error').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      resultDiv.innerHTML = `<div class="alert alert-error">${msg}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Execute Transfer';
    }
  });
}
