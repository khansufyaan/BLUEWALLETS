import { api } from '../api.js';

export async function renderDashboard() {
  try {
    const [stats, wallets, vaults, recentTxs] = await Promise.all([
      api.getStats().catch(() => ({ totalTransactions: 0, transactionsToday: 0, completedToday: 0, rejectedToday: 0, aumByCurrency: {} })),
      api.getWallets().catch(() => []),
      api.getVaults().catch(() => []),
      api.getAllTransactions(50).catch(() => []),
    ]);

    // Build wallet lookup for tx feed
    const walletMap = {};
    wallets.forEach(w => { walletMap[w.id] = w; });

    // ─── KPI Cards ─────────────────────────────────────────
    const kpis = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Assets Under Management</div>
          <div class="kpi-value kpi-volume">${formatVolume(stats.aumByCurrency || {})}</div>
          <div class="kpi-sub">${formatBreakdown(stats.aumByCurrency || {})} &middot; ${vaults.length} vaults</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Transactions</div>
          <div class="kpi-value">${stats.totalTransactions}</div>
          <div class="kpi-sub">
            ${stats.transactionsToday > 0 ? `<span style="color:var(--emerald)">${stats.transactionsToday} today</span>` : 'None today'}
            ${stats.rejectedToday > 0 ? `<span style="color:var(--red);margin-left:8px">${stats.rejectedToday} blocked</span>` : ''}
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Wallets Created</div>
          <div class="kpi-value">${stats.wallets}</div>
          <div class="kpi-sub">${stats.chains || 0} chains</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pending Approvals</div>
          <div class="kpi-value" style="${stats.pendingApprovals > 0 ? 'color:var(--amber)' : ''}">${stats.pendingApprovals || 0}</div>
          <div class="kpi-sub">${(stats.pendingApprovals || 0) > 0 ? 'Requires attention' : 'All clear'}</div>
        </div>
      </div>`;

    // ─── Alert Banner (below KPIs, above feed) ─────────────
    const hasAttention = (stats.pendingApprovals || 0) > 0 || stats.rejectedToday > 0;
    const attentionBanner = hasAttention ? `
      <div class="attention-banner" style="margin-bottom:20px">
        <div class="attention-banner-icon">&#9888;&#65039;</div>
        <div class="attention-banner-items">
          ${(stats.pendingApprovals || 0) > 0 ? `
            <div class="attention-item">
              <span class="count count-amber">${stats.pendingApprovals}</span>
              transaction${stats.pendingApprovals !== 1 ? 's' : ''} pending approval
            </div>
          ` : ''}
          ${stats.rejectedToday > 0 ? `
            <div class="attention-item">
              <span class="count count-red">${stats.rejectedToday}</span>
              policy block${stats.rejectedToday !== 1 ? 's' : ''} today
            </div>
          ` : ''}
        </div>
        <div class="attention-banner-action">
          <a href="#/wallets" class="btn btn-sm btn-secondary">Review</a>
        </div>
      </div>` : '';

    // ─── Transaction Feed with Filters ─────────────────────
    const statusCounts = { all: recentTxs.length, pending: 0, completed: 0, rejected: 0 };
    recentTxs.forEach(tx => {
      if (statusCounts[tx.status] !== undefined) statusCounts[tx.status]++;
    });

    const needsReview = recentTxs.filter(tx => tx.status === 'pending' || tx.status === 'rejected');

    const feedFilters = `
      <div class="feed-filters">
        <button class="feed-filter-btn active" data-filter="all">
          All<span class="feed-filter-count">${statusCounts.all}</span>
        </button>
        <button class="feed-filter-btn" data-filter="completed">
          Completed<span class="feed-filter-count">${statusCounts.completed}</span>
        </button>
        ${statusCounts.rejected > 0 || statusCounts.pending > 0 ? `
          <button class="feed-filter-btn" data-filter="review" ${needsReview.length > 0 ? 'style="color:var(--amber)"' : ''}>
            Review<span class="feed-filter-count" ${needsReview.length > 0 ? 'style="background:var(--amber);color:var(--text-inverse)"' : ''}>${needsReview.length}</span>
          </button>
        ` : ''}
      </div>`;

    const txFeed = recentTxs.length === 0
      ? `<div class="empty-state" style="padding:32px">
          <div class="empty-state-icon">&#128260;</div>
          <h3>No transactions yet</h3>
          <p>Create wallets and execute transfers to see activity here.</p>
        </div>`
      : recentTxs.map(tx => {
          const fromW = walletMap[tx.fromWalletId];
          const toW = walletMap[tx.toWalletId];
          const isRejected = tx.status === 'rejected';
          const isPending = tx.status === 'pending';
          const isReviewable = isRejected || isPending;
          const timeAgo = getTimeAgo(tx.createdAt);

          return `
            <div class="tx-row" data-status="${tx.status}" data-reviewable="${isReviewable}">
              <div class="tx-row-left">
                <div class="tx-status-icon tx-status-${tx.status}">
                  ${tx.status === 'completed' ? '&#10003;' : tx.status === 'rejected' ? '&#10007;' : '&#8943;'}
                </div>
                <div>
                  <div class="tx-row-title">
                    ${fromW ? `<span class="chain-dot chain-dot-${fromW.chain}"></span>` : ''}
                    <span style="font-weight:500">${fromW?.name || (tx.fromWalletId ? tx.fromWalletId.substring(0, 8) : '—')}</span>
                    <span class="tx-arrow">&rarr;</span>
                    ${toW ? `<span class="chain-dot chain-dot-${toW.chain}"></span>` : ''}
                    <span style="font-weight:500">${toW?.name || (tx.toWalletId ? tx.toWalletId.substring(0, 8) : '—')}</span>
                  </div>
                  <div class="tx-row-detail">
                    ${tx.memo ? `${tx.memo} &middot; ` : ''}
                    ${isRejected && tx.failureReason ? `<span style="color:var(--red)">${tx.failureReason.split(':')[0]}</span> &middot; ` : ''}
                    <span class="mono">${tx.signature ? tx.signature.substring(0, 16) + '...' : ''}</span>
                  </div>
                </div>
              </div>
              <div class="tx-row-right">
                <div class="tx-amount ${isRejected ? 'tx-amount-rejected' : ''}">
                  ${formatAmount(tx.amount, tx.currency)}
                </div>
                <div class="tx-row-meta">
                  <span class="badge badge-${tx.status}" style="font-size:10px">${tx.status}</span>
                  <span class="tx-time">${timeAgo}</span>
                </div>
              </div>
            </div>`;
        }).join('');

    // ─── Assemble Dashboard ────────────────────────────────
    const html = `
      ${kpis}
      ${attentionBanner}

      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Transaction Feed</h2>
            <p class="card-subtitle">All activity across wallets</p>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            ${feedFilters}
            <span class="text-xs text-tertiary">${stats.totalTransactions} total</span>
          </div>
        </div>
        <div class="tx-feed" id="tx-feed">
          ${txFeed}
        </div>
      </div>
    `;

    // Attach filter event listeners after render
    setTimeout(() => {
      const filterBtns = document.querySelectorAll('.feed-filter-btn');
      filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const filter = btn.dataset.filter;
          document.querySelectorAll('.tx-row').forEach(row => {
            if (filter === 'all') {
              row.style.display = '';
            } else if (filter === 'review') {
              row.style.display = row.dataset.reviewable === 'true' ? '' : 'none';
            } else {
              row.style.display = row.dataset.status === filter ? '' : 'none';
            }
          });
        });
      });
    }, 0);

    return html;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
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

// Approximate USD prices for AUM display
const USD_PRICES = {
  BTC: 94000, ETH: 3500, SOL: 180, MATIC: 0.40, BNB: 600,
  AVAX: 35, LTC: 85, TRX: 0.25,
};

function formatVolume(volumeByCurrency) {
  const entries = Object.entries(volumeByCurrency);
  if (entries.length === 0) return '$0';

  const decimals = { ETH: 18, MATIC: 18, BNB: 18, AVAX: 18, BTC: 8, LTC: 8, SOL: 9, TRX: 6 };
  let totalUsd = 0;

  entries.forEach(([currency, amountStr]) => {
    const b = BigInt(amountStr);
    const d = decimals[currency];
    if (d && b > 0n) {
      const divisor = 10n ** BigInt(d);
      const whole = Number(b / divisor);
      const frac = Number(b % divisor) / Number(divisor);
      const units = whole + frac;
      totalUsd += units * (USD_PRICES[currency] || 0);
    }
  });

  if (totalUsd >= 1_000_000) return `$${(totalUsd / 1_000_000).toFixed(2)}M`;
  if (totalUsd >= 1_000) return `$${(totalUsd / 1_000).toFixed(1)}K`;
  return `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBreakdown(volumeByCurrency) {
  const decimals = { ETH: 18, MATIC: 18, BNB: 18, AVAX: 18, BTC: 8, LTC: 8, SOL: 9, TRX: 6 };
  return Object.entries(volumeByCurrency)
    .filter(([, v]) => BigInt(v) > 0n)
    .map(([currency, amountStr]) => {
      const b = BigInt(amountStr);
      const d = decimals[currency];
      if (d && b > 0n) {
        const divisor = 10n ** BigInt(d);
        const whole = b / divisor;
        const frac = b % divisor;
        const fracStr = frac.toString().padStart(d, '0').substring(0, 2).replace(/0+$/, '');
        return `${whole}${fracStr ? '.' + fracStr : ''} ${currency}`;
      }
      return `${b} ${currency}`;
    }).join(', ') || '0';
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
