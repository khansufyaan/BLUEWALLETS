import { api } from '../api.js';

const CHAIN_LABELS = {
  bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana',
  bsc: 'BNB Chain', polygon: 'Polygon', arbitrum: 'Arbitrum',
  tron: 'Tron', avalanche: 'Avalanche', litecoin: 'Litecoin',
};

export async function renderVaults() {
  try {
    const [vaults, wallets, recentTxs] = await Promise.all([
      api.getVaults(),
      api.getWallets(),
      api.getAllTransactions(200),
    ]);

    // Build lookups
    const walletsByVault = {};
    wallets.forEach(w => {
      if (!walletsByVault[w.vaultId]) walletsByVault[w.vaultId] = [];
      walletsByVault[w.vaultId].push(w);
    });

    // Tx by vault (via wallet's vaultId)
    const walletToVault = {};
    wallets.forEach(w => { walletToVault[w.id] = w.vaultId; });

    const txByVault = {};
    recentTxs.forEach(tx => {
      const vid = walletToVault[tx.fromWalletId] || walletToVault[tx.toWalletId];
      if (vid) {
        if (!txByVault[vid]) txByVault[vid] = [];
        txByVault[vid].push(tx);
      }
    });

    // Sort vaults: most wallets first, then by pending
    const enriched = vaults.map(v => {
      const vWallets = walletsByVault[v.id] || [];
      const vTxs = txByVault[v.id] || [];

      // Balance by currency
      const balByCurrency = {};
      vWallets.forEach(w => {
        balByCurrency[w.currency] = (balByCurrency[w.currency] || 0n) + BigInt(w.balance);
      });
      const balanceStr = Object.entries(balByCurrency)
        .filter(([, b]) => b > 0n)
        .map(([c, b]) => formatAmount(b.toString(), c))
        .join(', ') || 'No funds';

      // Chain breakdown
      const chainCounts = {};
      vWallets.forEach(w => { chainCounts[w.chain] = (chainCounts[w.chain] || 0) + 1; });

      // Pending count
      const pendingCount = vTxs.filter(tx => tx.status === 'pending').length;

      // Last activity
      const lastTx = vTxs[0]; // already sorted desc by backend
      const lastActivity = lastTx ? getTimeAgo(lastTx.createdAt) : 'No activity';

      return { ...v, vWallets, balanceStr, chainCounts, pendingCount, lastActivity };
    });

    enriched.sort((a, b) => b.vWallets.length - a.vWallets.length);

    // Vault cards
    const vaultCards = enriched.length === 0
      ? `<div class="empty-state">
          <div class="empty-state-icon">&#128274;</div>
          <h3>No vaults yet</h3>
          <p>Vaults organize your wallets and keys. Create one to get started.</p>
        </div>`
      : enriched.map(v => {
          const chainPills = Object.entries(v.chainCounts).map(([chain, count]) =>
            `<span class="vault-card-chain-pill">
              <span class="chain-dot chain-dot-${chain}"></span>
              ${CHAIN_LABELS[chain] || chain} (${count})
            </span>`
          ).join('');

          return `
            <div class="card vault-card ${v.pendingCount > 0 ? 'vault-card-pending' : ''}"
                 data-name="${v.name.toLowerCase()}" data-description="${(v.description || '').toLowerCase()}"
                 onclick="location.hash='#/vaults/${v.id}'">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <h3 style="margin-bottom:2px">${v.name}</h3>
                  ${v.description ? `<p class="text-xs text-tertiary">${v.description}</p>` : ''}
                </div>
                <span class="badge badge-${v.status}">${v.status}</span>
              </div>
              <div class="vault-card-balance">${v.balanceStr}</div>
              ${Object.keys(v.chainCounts).length > 0 ? `<div class="vault-card-chains">${chainPills}</div>` : ''}
              <div class="vault-card-stats">
                <div>
                  <span class="text-xs text-tertiary">Wallets</span>
                  <span style="font-weight:600">${v.vWallets.length}</span>
                </div>
                <div>
                  <span class="text-xs text-tertiary">Pending</span>
                  <span style="font-weight:600;${v.pendingCount > 0 ? 'color:var(--amber)' : ''}">${v.pendingCount}</span>
                </div>
                <div>
                  <span class="text-xs text-tertiary">Last Activity</span>
                  <span class="text-sm">${v.lastActivity}</span>
                </div>
                <div>
                  <span class="text-xs text-tertiary">Created</span>
                  <span class="text-sm">${new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>`;
        }).join('');

    // Search bar
    const searchBar = enriched.length > 1 ? `
      <div class="search-wrapper" style="margin-bottom:16px">
        <span class="search-icon">&#128269;</span>
        <input type="text" class="search-input" id="vault-search" placeholder="Search vaults...">
      </div>` : '';

    return `
      <div class="vaults-page">
        <div class="page-header">
          <div class="page-header-left">
            <h2>Vaults</h2>
            <span class="count-badge">${vaults.length}</span>
          </div>
          <button class="btn btn-primary" id="open-create-vault">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:6px">
              <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Create Vault
          </button>
        </div>
        ${searchBar}
        <div id="vault-list" class="vault-grid">
          ${vaultCards}
        </div>
      </div>

      <!-- Create Vault Modal -->
      <div class="modal-overlay" id="create-vault-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>Create Vault</h3>
            <button class="modal-close" id="close-create-vault" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div id="vault-result"></div>
          <form id="create-vault-form">
            <div class="form-group">
              <label class="form-label">Vault Name</label>
              <input type="text" class="form-input" id="v-name" placeholder="e.g. Treasury Vault" required>
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input type="text" class="form-input" id="v-desc" placeholder="Optional description">
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="cancel-create-vault">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Vault</button>
            </div>
          </form>
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initVaults() {
  const modal = document.getElementById('create-vault-modal');

  // Open modal
  document.getElementById('open-create-vault')?.addEventListener('click', () => {
    modal.classList.add('active');
    setTimeout(() => document.getElementById('v-name')?.focus(), 100);
  });

  // Close modal
  const closeModal = () => {
    modal.classList.remove('active');
    document.getElementById('create-vault-form')?.reset();
    const r = document.getElementById('vault-result');
    if (r) r.innerHTML = '';
  };
  document.getElementById('close-create-vault')?.addEventListener('click', closeModal);
  document.getElementById('cancel-create-vault')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeModal();
  });

  // Create vault form
  document.getElementById('create-vault-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultDiv = document.getElementById('vault-result');
    try {
      const vault = await api.createVault({
        name: document.getElementById('v-name').value,
        description: document.getElementById('v-desc').value || undefined,
      });
      resultDiv.innerHTML = `<div class="alert alert-success">Vault "${vault.name}" created!</div>`;
      setTimeout(() => { closeModal(); location.hash = `#/vaults/${vault.id}`; }, 600);
    } catch (err) {
      resultDiv.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  // Search filter
  document.getElementById('vault-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.vault-card').forEach(card => {
      const name = card.dataset.name || '';
      const desc = card.dataset.description || '';
      card.style.display = (name.includes(q) || desc.includes(q)) ? '' : 'none';
    });
  });
}

function formatAmount(balance, currency) {
  const b = BigInt(balance);
  const decimals = { ETH: 18, MATIC: 18, BNB: 18, AVAX: 18, BTC: 8, LTC: 8, SOL: 9, TRX: 6 };
  const d = decimals[currency];
  if (d && b > 0n) {
    const divisor = 10n ** BigInt(d);
    const whole = b / divisor;
    const frac = b % divisor;
    const fracStr = frac.toString().padStart(d, '0').substring(0, 4).replace(/0+$/, '');
    return `${whole.toLocaleString()}${fracStr ? '.' + fracStr : ''} ${currency}`;
  }
  return `${b.toLocaleString()} ${currency}`;
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
