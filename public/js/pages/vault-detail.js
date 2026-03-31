import { api } from '../api.js';

const CHAINS = [
  { value: 'bitcoin', label: 'Bitcoin', ticker: 'BTC', color: '#F7931A' },
  { value: 'ethereum', label: 'Ethereum', ticker: 'ETH', color: '#627EEA' },
  { value: 'solana', label: 'Solana', ticker: 'SOL', color: '#9945FF' },
  { value: 'bsc', label: 'BNB Chain', ticker: 'BNB', color: '#F0B90B' },
  { value: 'polygon', label: 'Polygon', ticker: 'MATIC', color: '#8247E5' },
  { value: 'arbitrum', label: 'Arbitrum', ticker: 'ETH', color: '#28A0F0' },
  { value: 'tron', label: 'Tron', ticker: 'TRX', color: '#FF0013' },
  { value: 'avalanche', label: 'Avalanche', ticker: 'AVAX', color: '#E84142' },
  { value: 'litecoin', label: 'Litecoin', ticker: 'LTC', color: '#BFBBBB' },
];

export async function renderVaultDetail(vaultId) {
  try {
    const vault = await api.getVault(vaultId);
    const wallets = await api.getVaultWallets(vaultId);

    const chainCards = CHAINS.map(c => `
      <div class="chain-card" data-chain="${c.value}">
        <div class="chain-icon" style="background:${c.color}20;color:${c.color};border:1px solid ${c.color}40">${c.ticker[0]}</div>
        <div class="chain-name">${c.label}</div>
        <div class="chain-ticker">${c.ticker}</div>
      </div>
    `).join('');

    const walletRows = wallets.map(w => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="chain-dot chain-dot-${w.chain}"></span>
            <a href="#/wallets/${w.id}" style="color:var(--text-primary);text-decoration:none;font-weight:500">${w.name}</a>
          </div>
        </td>
        <td style="text-transform:capitalize">${w.chain}</td>
        <td class="mono text-sm">${w.address.substring(0, 18)}...</td>
        <td class="mono">${BigInt(w.balance).toLocaleString()} ${w.currency}</td>
        <td><span class="badge badge-${w.status}">${w.status}</span></td>
      </tr>
    `).join('');

    return `
      <div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <a href="#/vaults" class="text-sm text-muted" style="text-decoration:none">&larr; Vaults</a>
          <span class="text-tertiary">/</span>
          <h2>${vault.name}</h2>
          <span class="badge badge-${vault.status}">${vault.status}</span>
        </div>
        <p class="text-sm text-muted">${vault.description || ''}</p>
      </div>

      <div class="hsm-badge" style="margin-bottom:24px">
        <span class="shield-icon">&#128737;</span>
        Private keys secured in Luna HSM &middot; FIPS 140-3 Level 3
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Wallets (${wallets.length})</h3>
          </div>
          ${wallets.length === 0
            ? '<p class="text-sm text-muted">No wallets in this vault yet. Create one using the form.</p>'
            : `<table>
                <thead><tr><th>Name</th><th>Chain</th><th>Address</th><th>Balance</th><th>Status</th></tr></thead>
                <tbody>${walletRows}</tbody>
              </table>`}
        </div>
        <div class="card">
          <h3 class="card-title" style="margin-bottom:16px">Add Wallet</h3>
          <div id="create-wallet-result"></div>
          <form id="create-wallet-in-vault-form">
            <div class="form-group">
              <label class="form-label">Select Blockchain</label>
              <div class="chain-grid" id="chain-selector">${chainCards}</div>
              <input type="hidden" id="cw-chain" required>
            </div>
            <div class="form-group">
              <label class="form-label">Wallet Name</label>
              <input type="text" class="form-input" id="cw-name" placeholder="e.g. Hot Wallet" required>
            </div>
            <div class="form-group">
              <label class="form-label">Initial Balance (smallest unit)</label>
              <input type="text" class="form-input" id="cw-balance" value="0" pattern="\\d+">
            </div>
            <button type="submit" class="btn btn-primary" id="cw-submit" disabled>Select a blockchain first</button>
          </form>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initVaultDetail(vaultId) {
  // Chain selector
  const chainCards = document.querySelectorAll('.chain-card');
  const chainInput = document.getElementById('cw-chain');
  const submitBtn = document.getElementById('cw-submit');

  chainCards.forEach(card => {
    card.addEventListener('click', () => {
      chainCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      chainInput.value = card.dataset.chain;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Wallet';
    });
  });

  document.getElementById('create-wallet-in-vault-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultDiv = document.getElementById('create-wallet-result');
    const chain = chainInput.value;
    if (!chain) { resultDiv.innerHTML = '<div class="alert alert-warning">Select a blockchain</div>'; return; }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="signing-spinner" style="width:14px;height:14px"></span> Generating keys in HSM...';

    try {
      const wallet = await api.createWalletInVault(vaultId, {
        chain,
        name: document.getElementById('cw-name').value,
        initialBalance: document.getElementById('cw-balance').value || '0',
      });
      resultDiv.innerHTML = `
        <div class="alert alert-success">
          Wallet created!<br>
          <div class="address-display" style="margin-top:8px;font-size:12px">${wallet.address}</div>
        </div>`;
      setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 1000);
    } catch (err) {
      resultDiv.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Wallet';
    }
  });
}
