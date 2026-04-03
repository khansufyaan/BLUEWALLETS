import { api } from '../api.js';

const CHAIN_LABELS = {
  bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana',
  bsc: 'BNB Chain', polygon: 'Polygon', arbitrum: 'Arbitrum',
  tron: 'Tron', avalanche: 'Avalanche', litecoin: 'Litecoin',
};

export async function renderWallets() {
  try {
    const [wallets, vaults, stats] = await Promise.all([
      api.getWallets(),
      api.getVaults(),
      api.getStats(),
    ]);

    const vaultMap = {};
    vaults.forEach(v => { vaultMap[v.id] = v; });

    // Chain stats
    const chainCounts = {};
    wallets.forEach(w => { chainCounts[w.chain] = (chainCounts[w.chain] || 0) + 1; });
    const uniqueChains = Object.keys(chainCounts);

    // Aggregate total balance by currency
    const totalByCurrency = {};
    wallets.forEach(w => {
      totalByCurrency[w.currency] = (totalByCurrency[w.currency] || 0n) + BigInt(w.balance);
    });
    const totalBalanceStr = Object.entries(totalByCurrency)
      .filter(([, b]) => b > 0n)
      .map(([c, b]) => formatAmount(b.toString(), c))
      .join(', ') || '0';

    // KPI row
    const kpis = `
      <div class="kpi-grid" style="margin-bottom:20px">
        <div class="kpi-card">
          <div class="kpi-label">Total Wallets</div>
          <div class="kpi-value">${wallets.length}</div>
          <div class="kpi-sub">${vaults.length} vaults</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Balance</div>
          <div class="kpi-value kpi-volume">${totalBalanceStr}</div>
          <div class="kpi-sub">Across ${uniqueChains.length} chains</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Active Chains</div>
          <div class="kpi-value">${uniqueChains.length}</div>
          <div class="kpi-sub">${uniqueChains.map(c => CHAIN_LABELS[c] || c).join(', ')}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Transactions (24h)</div>
          <div class="kpi-value">${stats.transactionsToday}</div>
          <div class="kpi-sub">
            <span style="color:var(--emerald)">${stats.completedToday} completed</span>
            ${stats.rejectedToday > 0 ? `<span style="color:var(--red);margin-left:8px">${stats.rejectedToday} blocked</span>` : ''}
          </div>
        </div>
      </div>`;

    // Chain filter pills
    const chainFilters = `
      <div class="feed-filters" id="chain-filters">
        <button class="feed-filter-btn active" data-chain="all">
          All<span class="feed-filter-count">${wallets.length}</span>
        </button>
        ${uniqueChains.map(chain => `
          <button class="feed-filter-btn" data-chain="${chain}">
            <span class="chain-dot chain-dot-${chain}"></span>
            ${CHAIN_LABELS[chain] || chain}<span class="feed-filter-count">${chainCounts[chain]}</span>
          </button>
        `).join('')}
      </div>`;

    // Filter toolbar
    const toolbar = `
      <div class="wallets-toolbar">
        ${chainFilters}
        <div class="search-wrapper" style="flex:1;min-width:200px">
          <span class="search-icon">&#128269;</span>
          <input type="text" class="search-input" id="wallet-search" placeholder="Search wallets by name, address, or vault...">
        </div>
        <a href="#/vaults" class="btn btn-primary btn-sm">+ New Wallet</a>
      </div>`;

    // Table rows
    const rows = wallets.map(w => {
      const vault = vaultMap[w.vaultId];
      const vaultName = vault?.name || 'Unassigned';
      return `
        <tr data-chain="${w.chain}" data-status="${w.status}" data-name="${w.name.toLowerCase()}" data-address="${w.address.toLowerCase()}" data-vault="${vaultName.toLowerCase()}" data-balance="${w.balance}">
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="chain-dot chain-dot-${w.chain}"></span>
              <a href="#/wallets/${w.id}" style="color:var(--text-primary);text-decoration:none;font-weight:500">${w.name}</a>
            </div>
          </td>
          <td><a href="#/vaults/${w.vaultId}" class="text-sm" style="color:var(--text-secondary);text-decoration:none">${vaultName}</a></td>
          <td style="text-transform:capitalize">${w.chain}</td>
          <td>
            <span class="mono text-sm">${w.address.substring(0, 16)}...</span>
            <button class="copy-btn" onclick="navigator.clipboard.writeText('${w.address}').then(()=>{this.textContent='Copied';setTimeout(()=>{this.textContent='Copy'},1000)})">Copy</button>
          </td>
          <td class="mono">${formatAmount(w.balance, w.currency)}</td>
          <td>${w.hdVersion
            ? `<span style="color:var(--blue-400);font-size:11px;font-weight:600" title="${w.derivationPath || ''}">HD v${w.hdVersion}</span>`
            : '<span style="color:var(--text-tertiary);font-size:11px">Legacy</span>'}</td>
          <td><span class="badge badge-${w.status}">${w.status}</span></td>
          <td>
            <div style="display:flex;gap:6px">
              <a href="#/wallets/${w.id}/transfer" class="btn btn-primary btn-sm">Transfer</a>
              <a href="#/wallets/${w.id}" class="btn btn-secondary btn-sm">View</a>
            </div>
          </td>
        </tr>`;
    }).join('');

    const table = wallets.length === 0
      ? `<div class="empty-state">
          <div class="empty-state-icon">&#128179;</div>
          <h3>No wallets yet</h3>
          <p>Create a vault first, then add wallets to it.</p>
          <a href="#/vaults" class="btn btn-primary">Create Vault</a>
        </div>`
      : `<table>
          <thead>
            <tr>
              <th class="sortable" data-sort="name">Wallet</th>
              <th class="sortable" data-sort="vault">Vault</th>
              <th class="sortable" data-sort="chain">Chain</th>
              <th>Address</th>
              <th class="sortable" data-sort="balance">Balance</th>
              <th>Mode</th>
              <th class="sortable" data-sort="status">Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="wallets-tbody">${rows}</tbody>
        </table>`;

    return `
      ${kpis}
      ${toolbar}
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">All Wallets</h2>
            <p class="card-subtitle">${wallets.length} wallets across ${vaults.length} vaults</p>
          </div>
        </div>
        ${table}
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initWallets() {
  let activeChain = 'all';
  let searchQuery = '';

  function applyFilters() {
    document.querySelectorAll('#wallets-tbody tr').forEach(row => {
      const chainMatch = activeChain === 'all' || row.dataset.chain === activeChain;
      const q = searchQuery;
      const searchMatch = !q ||
        (row.dataset.name || '').includes(q) ||
        (row.dataset.address || '').includes(q) ||
        (row.dataset.vault || '').includes(q);
      row.style.display = (chainMatch && searchMatch) ? '' : 'none';
    });
  }

  // Chain filters
  document.querySelectorAll('#chain-filters .feed-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#chain-filters .feed-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeChain = btn.dataset.chain;
      applyFilters();
    });
  });

  // Search
  document.getElementById('wallet-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    applyFilters();
  });

  // Sortable headers
  let currentSort = null;
  let sortDir = 'asc';

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (currentSort === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = col;
        sortDir = 'asc';
      }

      document.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');

      const tbody = document.getElementById('wallets-tbody');
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));

      rows.sort((a, b) => {
        let va = a.dataset[col] || '';
        let vb = b.dataset[col] || '';
        if (col === 'balance') {
          const diff = BigInt(va || '0') - BigInt(vb || '0');
          return sortDir === 'asc' ? (diff < 0n ? -1 : diff > 0n ? 1 : 0) : (diff > 0n ? -1 : diff < 0n ? 1 : 0);
        }
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });

      rows.forEach(r => tbody.appendChild(r));
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
