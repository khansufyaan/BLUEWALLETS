const OPS = '/ops/gas-station';
async function req(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

export async function renderGasStation() {
  const [status, history] = await Promise.all([
    req(`${OPS}/status`),
    req(`${OPS}/history`),
  ]);

  const cfg = status.config || {};
  const treasuryEth = status.treasuryBalance
    ? (Number(BigInt(status.treasuryBalance)) / 1e18).toFixed(6) : '—';
  const dailySpendEth = (Number(BigInt(status.dailySpend || '0')) / 1e18).toFixed(6);
  const capEth = (Number(BigInt(cfg.maxDailyWei || '0')) / 1e18).toFixed(4);
  const thresholdEth = (Number(BigInt(cfg.thresholdWei || '0')) / 1e18).toFixed(4);
  const topUpEth = (Number(BigInt(cfg.topUpWei || '0')) / 1e18).toFixed(4);

  // ── Treasury Card ──────────────────────────────────────────
  const treasuryCard = `
    <div class="kpi-grid" style="margin-bottom:var(--sp-6)">
      <div class="kpi-card">
        <div class="kpi-label">Treasury Balance</div>
        <div class="kpi-value" style="font-size:20px">${treasuryEth} ETH</div>
        <div class="kpi-sub mono" style="font-size:10px">${cfg.treasuryAddress || 'Not configured'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Daily Spend</div>
        <div class="kpi-value" style="font-size:20px">${dailySpendEth}</div>
        <div class="kpi-sub">of ${capEth} ETH cap</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Auto-Fund Threshold</div>
        <div class="kpi-value" style="font-size:20px">${thresholdEth}</div>
        <div class="kpi-sub">ETH minimum per wallet</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Top-Up Amount</div>
        <div class="kpi-value" style="font-size:20px">${topUpEth}</div>
        <div class="kpi-sub">ETH per funding tx</div>
      </div>
    </div>`;

  // ── Config Panel ───────────────────────────────────────────
  const configPanel = `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div><h2 class="card-title">Gas Station Configuration</h2></div>
        <span class="badge ${cfg.enabled ? 'badge-confirmed' : 'badge-pending'}">${cfg.enabled ? 'Active' : 'Inactive'}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-4)">
        <div class="provider-field">
          <label class="field-label">Treasury Wallet ID</label>
          <input type="text" class="field-input" id="gas-treasury-id" placeholder="Wallet ID from signer"
            value="${cfg.treasuryWalletId || ''}">
        </div>
        <div class="provider-field">
          <label class="field-label">Threshold (wei)</label>
          <input type="text" class="field-input" id="gas-threshold" value="${cfg.thresholdWei || '10000000000000000'}">
        </div>
        <div class="provider-field">
          <label class="field-label">Top-Up Amount (wei)</label>
          <input type="text" class="field-input" id="gas-topup" value="${cfg.topUpWei || '50000000000000000'}">
        </div>
        <div class="provider-field">
          <label class="field-label">Daily Cap (wei)</label>
          <input type="text" class="field-input" id="gas-cap" value="${cfg.maxDailyWei || '1000000000000000000'}">
        </div>
      </div>
      <div style="margin-top:var(--sp-4);display:flex;gap:var(--sp-3)">
        <button class="btn-action" id="save-gas-config">Save & Restart Gas Station</button>
        <span class="text-tertiary" id="gas-save-status" style="align-self:center;font-size:12px"></span>
      </div>
    </div>`;

  // ── Wallet Gas Levels ──────────────────────────────────────
  const wallets = status.walletGasLevels || [];
  const walletRows = wallets.length === 0
    ? '<div class="empty-state"><h3>No wallets</h3></div>'
    : `<table class="data-table">
        <thead><tr><th>Wallet</th><th>Chain</th><th>Address</th><th>Gas Balance</th><th>Status</th></tr></thead>
        <tbody>${wallets.map(w => {
          const bal = w.gasBalance ? (Number(BigInt(w.gasBalance)) / 1e18).toFixed(6) : '—';
          return `<tr>
            <td style="font-weight:500">${w.name}</td>
            <td>${w.chain}</td>
            <td><span class="mono truncate">${w.address?.slice(0, 10)}...${w.address?.slice(-6)}</span></td>
            <td class="mono">${bal}</td>
            <td>${w.belowThreshold
              ? '<span class="badge badge-failed">Low Gas</span>'
              : '<span class="badge badge-confirmed">OK</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;

  // ── Funding History ────────────────────────────────────────
  const fundings = history.fundings || [];
  const fundingRows = fundings.length === 0
    ? '<div class="empty-state"><h3>No gas funding yet</h3></div>'
    : `<table class="data-table">
        <thead><tr><th>Status</th><th>Chain</th><th>Wallet</th><th>Amount</th><th>Tx Hash</th><th>Time</th></tr></thead>
        <tbody>${fundings.map(f => `
          <tr>
            <td><span class="badge badge-${f.status}">${f.status}</span></td>
            <td>${f.chain}</td>
            <td><span class="mono truncate">${f.address?.slice(0, 10)}...</span></td>
            <td class="mono">${(Number(BigInt(f.amount)) / 1e18).toFixed(6)}</td>
            <td><span class="mono truncate">${f.txHash?.slice(0, 10)}...</span></td>
            <td class="text-tertiary">${new Date(f.timestamp).toLocaleTimeString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

  // Attach save handler
  setTimeout(() => {
    document.getElementById('save-gas-config')?.addEventListener('click', async () => {
      const st = document.getElementById('gas-save-status');
      try {
        await fetch(`${OPS}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            treasuryWalletId: document.getElementById('gas-treasury-id')?.value,
            thresholdWei: document.getElementById('gas-threshold')?.value,
            topUpWei: document.getElementById('gas-topup')?.value,
            maxDailyWei: document.getElementById('gas-cap')?.value,
          }),
        });
        if (st) { st.textContent = 'Saved! Gas station restarting...'; st.style.color = 'var(--emerald)'; }
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        if (st) { st.textContent = 'Save failed'; st.style.color = 'var(--red)'; }
      }
    });
  }, 0);

  return `
    ${treasuryCard}
    ${configPanel}
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header"><div><h2 class="card-title">Wallet Gas Levels</h2></div></div>
      ${walletRows}
    </div>
    <div class="card">
      <div class="card-header"><div><h2 class="card-title">Funding History</h2></div></div>
      ${fundingRows}
    </div>`;
}
