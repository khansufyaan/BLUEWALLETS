import { api } from '../api.js';

export async function renderDeposits() {
  const { deposits } = await api.getOpsDeposits();

  if (deposits.length === 0) {
    return `<div class="card"><div class="empty-state"><h3>No deposits detected</h3><p>Send crypto to a wallet address to see incoming deposits here.</p></div></div>`;
  }

  const rows = deposits.map(d => {
    const amountWei = BigInt(d.value || '0');
    const eth = Number(amountWei) / 1e18;
    const confPct = Math.min(100, Math.round((d.confirmations / d.required) * 100));

    return `
      <tr>
        <td><span class="badge badge-${d.status}">${d.status}</span></td>
        <td>${d.chain}</td>
        <td><span class="mono truncate" title="${d.address}">${d.address?.slice(0, 8)}...${d.address?.slice(-6)}</span></td>
        <td><span class="mono truncate" title="${d.from}">${d.from?.slice(0, 8)}...${d.from?.slice(-6)}</span></td>
        <td class="mono">${eth.toFixed(6)}</td>
        <td>
          <span title="${d.confirmations}/${d.required}">${d.confirmations}/${d.required}</span>
          <span class="text-tertiary" style="margin-left:4px">(${confPct}%)</span>
        </td>
        <td><span class="mono truncate" title="${d.txHash}">${d.txHash?.slice(0, 10)}...</span></td>
        <td>${d.webhookSent ? '<span class="text-emerald">sent</span>' : '<span class="text-tertiary">—</span>'}</td>
        <td class="text-tertiary">${new Date(d.detectedAt).toLocaleTimeString()}</td>
      </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Incoming Deposits</h2>
          <p class="card-subtitle">Transfers detected to monitored wallet addresses</p>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Chain</th>
            <th>To Wallet</th>
            <th>From</th>
            <th>Amount</th>
            <th>Confirmations</th>
            <th>Tx Hash</th>
            <th>Webhook</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
