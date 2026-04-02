import { api } from '../api.js';

export async function renderChains() {
  const { chains } = await api.getOpsChains();

  if (chains.length === 0) {
    return `<div class="card"><div class="empty-state"><h3>No chains configured</h3><p>Set RPC URLs in the gateway environment variables.</p></div></div>`;
  }

  const cards = chains.map(c => {
    const isConnected = c.status === 'connected';
    const gasPriceGwei = c.gasPrice ? (Number(BigInt(c.gasPrice)) / 1e9).toFixed(2) : '—';
    const maxFeeGwei = c.maxFeePerGas ? (Number(BigInt(c.maxFeePerGas)) / 1e9).toFixed(2) : null;
    const tipGwei = c.maxPriorityFeePerGas ? (Number(BigInt(c.maxPriorityFeePerGas)) / 1e9).toFixed(2) : null;

    return `
      <div class="chain-card">
        <div class="chain-card-header">
          <div>
            <div class="chain-card-name">${c.name}</div>
            <div class="chain-card-id">Chain ID: ${c.chainId} · ${c.ticker}</div>
          </div>
          <span class="badge badge-${isConnected ? 'connected' : 'error'}">${c.status}</span>
        </div>

        ${isConnected ? `
          <div class="chain-stat">
            <span class="chain-stat-label">Block Height</span>
            <span class="chain-stat-value mono">${c.blockNumber?.toLocaleString()}</span>
          </div>
          <div class="chain-stat">
            <span class="chain-stat-label">RPC Latency</span>
            <span class="chain-stat-value">${c.latencyMs}ms</span>
          </div>
          ${c.eip1559 && maxFeeGwei ? `
            <div class="chain-stat">
              <span class="chain-stat-label">Max Fee (EIP-1559)</span>
              <span class="chain-stat-value mono">${maxFeeGwei} gwei</span>
            </div>
            <div class="chain-stat">
              <span class="chain-stat-label">Priority Tip</span>
              <span class="chain-stat-value mono">${tipGwei} gwei</span>
            </div>
          ` : `
            <div class="chain-stat">
              <span class="chain-stat-label">Gas Price</span>
              <span class="chain-stat-value mono">${gasPriceGwei} gwei</span>
            </div>
          `}
          <div class="chain-stat">
            <span class="chain-stat-label">Fee Model</span>
            <span class="chain-stat-value">${c.eip1559 ? 'EIP-1559' : 'Legacy'}</span>
          </div>
          <div class="chain-stat">
            <span class="chain-stat-label">RPC Endpoint</span>
            <span class="chain-stat-value mono" style="font-size:11px">${c.rpcUrl}</span>
          </div>
        ` : `
          <div style="padding:var(--sp-4);color:var(--red);font-size:13px">
            ${c.error || 'Connection failed'}
          </div>
        `}
      </div>`;
  }).join('');

  return `<div class="chain-grid">${cards}</div>`;
}
