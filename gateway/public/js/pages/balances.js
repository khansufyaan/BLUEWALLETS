import { api } from '../api.js';

export async function renderBalances() {
  const wallets = await api.getWallets().catch(() => []);

  if (!wallets || wallets.length === 0) {
    return `<div class="card"><div class="empty-state"><h3>No wallets</h3><p>Create wallets on the signer dashboard first.</p></div></div>`;
  }

  const rows = wallets.map(w => {
    const onChain = w.onChainBalance ? (Number(BigInt(w.onChainBalance)) / 1e18).toFixed(6) : '—';
    const stored  = w.balance ? (Number(BigInt(w.balance)) / 1e18).toFixed(6) : '0';

    return `
      <tr>
        <td style="font-weight:500">${w.name}</td>
        <td>${w.chain}</td>
        <td><span class="mono truncate" title="${w.address}">${w.address?.slice(0, 10)}...${w.address?.slice(-8)}</span></td>
        <td class="mono">${onChain}</td>
        <td class="mono text-tertiary">${stored}</td>
        <td>${w.currency}</td>
        <td><span class="badge badge-${w.status === 'active' ? 'confirmed' : 'error'}">${w.status}</span></td>
      </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Wallet Balances</h2>
          <p class="card-subtitle">Live on-chain balances vs signer-stored balances</p>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Wallet</th>
            <th>Chain</th>
            <th>Address</th>
            <th>On-Chain Balance</th>
            <th>Stored Balance</th>
            <th>Currency</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
