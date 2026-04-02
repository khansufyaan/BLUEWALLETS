import { api } from '../api.js';

export async function renderTransactions() {
  const { transactions } = await api.getOpsTransactions();

  if (transactions.length === 0) {
    return `<div class="card"><div class="empty-state"><h3>No transactions yet</h3><p>Execute withdrawals via the API to see them here.</p></div></div>`;
  }

  const rows = transactions.map(tx => {
    const amountWei = BigInt(tx.amount || '0');
    const eth = Number(amountWei) / 1e18;
    return `
      <tr>
        <td><span class="badge badge-${tx.status}">${tx.status}</span></td>
        <td>${tx.chain}</td>
        <td><span class="mono truncate" title="${tx.from}">${tx.from?.slice(0, 8)}...${tx.from?.slice(-6)}</span></td>
        <td><span class="mono truncate" title="${tx.to}">${tx.to?.slice(0, 8)}...${tx.to?.slice(-6)}</span></td>
        <td class="mono">${eth.toFixed(6)}</td>
        <td><span class="mono truncate" title="${tx.txHash}">${tx.txHash?.slice(0, 10)}...</span></td>
        <td>${tx.blockNumber || '—'}</td>
        <td class="text-tertiary">${tx.gasUsed || '—'}</td>
        <td class="text-tertiary">${new Date(tx.createdAt).toLocaleTimeString()}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Broadcast Transactions</h2>
          <p class="card-subtitle">All withdrawals sent to the blockchain</p>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Chain</th>
            <th>From</th>
            <th>To</th>
            <th>Amount</th>
            <th>Tx Hash</th>
            <th>Block</th>
            <th>Gas</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
