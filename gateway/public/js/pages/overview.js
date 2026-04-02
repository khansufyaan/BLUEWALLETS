import { api } from '../api.js';

export async function renderOverview() {
  const [stats, txData, depositData] = await Promise.all([
    api.getOpsStats(),
    api.getOpsTransactions(),
    api.getOpsDeposits(),
  ]);

  const kpis = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Pending Transactions</div>
        <div class="kpi-value" style="${stats.transactions.pending > 0 ? 'color:var(--amber)' : ''}">${stats.transactions.pending}</div>
        <div class="kpi-sub">${stats.transactions.total} total broadcast</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Confirmed</div>
        <div class="kpi-value" style="color:var(--emerald)">${stats.transactions.confirmed}</div>
        <div class="kpi-sub">${stats.transactions.failed} failed</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Deposits Detected</div>
        <div class="kpi-value">${stats.deposits.total}</div>
        <div class="kpi-sub">${stats.deposits.pending} awaiting confirmations</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Active Chains</div>
        <div class="kpi-value">${stats.activeChains}</div>
        <div class="kpi-sub">${stats.chains.join(', ') || 'None'}</div>
      </div>
    </div>`;

  // Merge txs and deposits into one activity feed, sorted by time
  const activities = [];

  (txData.transactions || []).forEach(tx => {
    activities.push({
      type: 'withdrawal',
      chain: tx.chain,
      txHash: tx.txHash,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      status: tx.status,
      time: tx.createdAt,
    });
  });

  (depositData.deposits || []).forEach(d => {
    activities.push({
      type: 'deposit',
      chain: d.chain,
      txHash: d.txHash,
      from: d.from,
      to: d.address,
      amount: d.value,
      status: d.status,
      time: d.detectedAt,
    });
  });

  activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const feedRows = activities.length === 0
    ? '<div class="empty-state"><h3>No activity yet</h3><p>Create wallets and send transactions to see activity here.</p></div>'
    : activities.slice(0, 20).map(a => {
        const isOut = a.type === 'withdrawal';
        const icon = isOut ? '&#8593;' : '&#8595;';
        const iconClass = isOut ? 'activity-icon-out' : 'activity-icon-in';
        const label = isOut ? 'Withdrawal' : 'Deposit';
        const amountWei = BigInt(a.amount || '0');
        const eth = Number(amountWei) / 1e18;
        const amountStr = eth > 0 ? eth.toFixed(6) : '0';

        return `
          <div class="activity-row">
            <div class="activity-left">
              <div class="activity-icon ${iconClass}">${icon}</div>
              <div>
                <div class="activity-title">${label} · ${a.chain}</div>
                <div class="activity-detail">
                  <span class="mono truncate">${a.txHash || '—'}</span>
                </div>
              </div>
            </div>
            <div class="activity-right">
              <div class="activity-amount">${amountStr} ETH</div>
              <div><span class="badge badge-${a.status}">${a.status}</span></div>
            </div>
          </div>`;
      }).join('');

  return `
    ${kpis}
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Recent Activity</h2>
          <p class="card-subtitle">Withdrawals and deposits across all chains</p>
        </div>
      </div>
      ${feedRows}
    </div>`;
}
