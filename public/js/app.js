import { renderDashboard } from './pages/dashboard.js';
import { renderWallets, initWallets } from './pages/wallets.js';
import { renderVaults, initVaults } from './pages/vaults.js';
import { renderVaultDetail, initVaultDetail } from './pages/vault-detail.js';
import { renderWalletDetail, initWalletDetail } from './pages/wallet-detail.js';
import { renderCreateWallet } from './pages/create-wallet.js';
import { renderTransfer, initTransfer } from './pages/transfer.js';
import { renderPolicies, initPolicies } from './pages/policies.js';
import { renderRoles, initRoles } from './pages/roles.js';
import { renderPermissions, initPermissions } from './pages/permissions.js';
import { renderHealth } from './pages/health.js';
import { renderCeremony, initCeremony } from './pages/ceremony.js';
import { api, auth } from './api.js';
import { checkAuthAndRender } from './login.js';

const appShell = document.getElementById('app-shell');
const pageContent = document.getElementById('page-content');
const pageTitle = document.getElementById('page-title');

let _currentUser = null;

async function updateHsmStatus() {
  try {
    const health = await api.health();
    const el = document.getElementById('hsm-status');
    if (health.hsm?.connected) {
      el.className = 'hsm-status';
      el.innerHTML = `
        <div class="hsm-dot"></div>
        <div>
          <div class="hsm-status-text">Luna HSM Connected</div>
          <div class="hsm-status-detail">${health.hsm.tokenInfo?.label || 'Partition'} &middot; FIPS 140-3</div>
        </div>`;
    } else {
      el.className = 'hsm-status hsm-disconnected';
      el.innerHTML = `<div class="hsm-dot"></div><div><div class="hsm-status-text">HSM Disconnected</div></div>`;
    }
  } catch { /* ignore */ }
}

const TITLES = {
  '/': 'Dashboard',
  '/vaults': 'Vaults',
  '/wallets': 'Wallets',
  '/wallets/new': 'Create Wallet',
  '/policies': 'Policies',
  '/roles': 'Roles',
  '/permissions': 'Permissions',
  '/ceremony': 'Key Ceremony',
};

function updateUserMenu(user) {
  const userMenu = document.getElementById('user-menu');
  if (userMenu && user) {
    const initial = (user.displayName || user.username || 'A')[0].toUpperCase();
    userMenu.innerHTML = `<div class="user-avatar">${initial}</div><span>${user.displayName || user.username}</span>`;
  }
}

async function route() {
  appShell.classList.remove('hidden');
  updateHsmStatus();
  updateUserMenu(_currentUser);

  const hash = (window.location.hash || '#/').substring(1);
  pageContent.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)"><div class="signing-spinner" style="margin:0 auto 12px"></div>Loading...</div>';

  let match;
  let title = TITLES[hash] || 'Blue Wallets';

  try {
    if (hash === '/' || hash === '') {
      pageContent.innerHTML = await renderDashboard();
    } else if (hash === '/vaults') {
      pageContent.innerHTML = await renderVaults();
      initVaults();
    } else if ((match = hash.match(/^\/vaults\/([^/]+)$/))) {
      title = 'Vault';
      pageContent.innerHTML = await renderVaultDetail(match[1]);
      initVaultDetail(match[1]);
    } else if (hash === '/wallets') {
      pageContent.innerHTML = await renderWallets();
      initWallets();
      title = 'Wallets';
    } else if (hash === '/wallets/new') {
      pageContent.innerHTML = await renderCreateWallet();
    } else if ((match = hash.match(/^\/wallets\/([^/]+)\/transfer$/))) {
      title = 'Transfer';
      pageContent.innerHTML = await renderTransfer(match[1]);
      initTransfer(match[1]);
    } else if ((match = hash.match(/^\/wallets\/([^/]+)$/))) {
      title = 'Wallet';
      pageContent.innerHTML = await renderWalletDetail(match[1]);
      initWalletDetail(match[1]);
    } else if (hash === '/policies') {
      pageContent.innerHTML = await renderPolicies();
      initPolicies();
    } else if (hash === '/roles') {
      pageContent.innerHTML = await renderRoles();
      initRoles();
    } else if (hash === '/permissions') {
      pageContent.innerHTML = await renderPermissions();
      initPermissions();
    } else if (hash === '/health') {
      title = 'System Health';
      pageContent.innerHTML = await renderHealth();
    } else if (hash === '/ceremony') {
      title = 'Key Ceremony';
      pageContent.innerHTML = renderCeremony();
      initCeremony();
    } else {
      pageContent.innerHTML = '<div class="alert alert-warning">Page not found</div>';
    }
  } catch (err) {
    pageContent.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }

  pageTitle.textContent = title;

  // Highlight active nav
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href')?.substring(1) || '';
    const isActive = hash === href || (href !== '/' && hash.startsWith(href));
    item.classList.toggle('active', isActive);
  });
}

// Logout
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await auth.logout();
  _currentUser = null;
  window.location.reload();
});

window.addEventListener('hashchange', route);

window.addEventListener('session-expired', () => {
  window.location.reload();
});

// Boot: check auth first, then start the app
checkAuthAndRender((user) => {
  _currentUser = user;
  route();
});
