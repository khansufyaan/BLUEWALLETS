import { api } from '../api.js';

export async function renderCreateWallet() {
  const vaults = await api.getVaults();
  if (vaults.length === 0) {
    return `
      <div class="card" style="max-width:500px">
        <div class="empty-state">
          <div class="empty-state-icon">&#128274;</div>
          <h3>Create a Vault First</h3>
          <p>Wallets must belong to a vault. Create a vault first, then add wallets to it.</p>
          <a href="#/vaults" class="btn btn-primary">Go to Vaults</a>
        </div>
      </div>`;
  }
  // Redirect to first vault
  return `<div class="alert alert-info">
    <span>To create a wallet, go to a vault and use the "Add Wallet" form.</span>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:16px">
    ${vaults.map(v => `
      <a href="#/vaults/${v.id}" class="card" style="text-decoration:none;flex:1;min-width:200px;cursor:pointer">
        <h3>${v.name}</h3>
        <p class="text-sm text-muted">${v.walletIds.length} wallets</p>
      </a>
    `).join('')}
  </div>`;
}
