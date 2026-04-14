/**
 * Blue Console — Application Router
 *
 * Handles authentication, page routing, and navigation.
 * Pages are loaded dynamically based on hash routes.
 */

import { api, auth, setSessionToken, getSessionToken } from './api.js';

// Page imports — operations (native to Console)
import { renderOverview } from './pages/overview.js';
import { renderTransactions, initTransactions } from './pages/transactions.js';
import { renderDeposits } from './pages/deposits.js';
import { renderBalances } from './pages/balances.js';
import { renderChains } from './pages/chains.js';
import { renderCompliance } from './pages/compliance.js';
import { renderGasStation } from './pages/gas-station.js';
import { renderSettings } from './pages/settings.js';
import { renderConnectivity } from './pages/connectivity.js';
import { renderApiKeys, initApiKeys } from './pages/api-keys.js';
import { renderTestExercise, initTestExercise } from './pages/test-exercise.js';
import { renderApiDocs, renderWhitepaper } from './pages/docs-viewer.js';

// Page imports — new features
import { renderRealtimeDashboard, initRealtimeDashboard, destroyRealtimeDashboard } from './pages/realtime-dashboard.js';
import { renderAuditLog, initAuditLog } from './pages/audit-log.js';
import { renderMultiChain, initMultiChain } from './pages/multi-chain.js';
import { renderWebhooks, initWebhooks } from './pages/webhooks.js';
import { renderTxBuilder, initTxBuilder } from './pages/tx-builder.js';
import { renderRiskDashboard, initRiskDashboard } from './pages/risk-dashboard.js';
import { renderKeyCeremony, initKeyCeremony } from './pages/key-ceremony.js';
import { renderHsmHealth, initHsmHealth, destroyHsmHealth } from './pages/hsm-health.js';
import { renderMultisig, initMultisig } from './pages/multisig.js';
import { renderAutomations, initAutomations } from './pages/automations.js';

// Page imports — management (proxied from Driver)
import { renderDashboard } from './pages/dashboard.js';
import { renderWallets, initWallets } from './pages/wallets.js';
import { renderWalletDetail, initWalletDetail } from './pages/wallet-detail.js';
import { renderCreateWallet, initCreateWallet } from './pages/create-wallet.js';
import { renderTransfer, initTransfer } from './pages/transfer.js';
import { renderVaults, initVaults } from './pages/vaults.js';
import { renderVaultDetail, initVaultDetail } from './pages/vault-detail.js';
import { renderPolicies, initPolicies } from './pages/policies.js';
import { renderRoles, initRoles } from './pages/roles.js';
import { renderPermissions, initPermissions } from './pages/permissions.js';
import { renderLogin, initLogin } from './pages/login.js';

const TITLES = {
  '':              'Overview',
  'dashboard':     'Overview',
  'wallets':       'Wallets',
  'vaults':        'Vaults',
  'balances':      'On-Chain Balances',
  'gas-station':   'Gas Station',
  'transactions':  'Withdrawals',
  'deposits':      'Deposits',
  'policies':      'Policies',
  'roles':         'Roles',
  'permissions':   'Permissions',
  'compliance':    'Compliance Screening',
  'connectivity':  'Health & Connectivity',
  'chains':        'Chains',
  'settings':      'Settings',
  'api-keys':      'API Keys',
  'test-exercise': 'Test Exercise',
  'api-docs':      'API Documentation',
  'whitepaper':    'White Paper',
  'realtime':      'Live Dashboard',
  'audit-log':     'Audit Log',
  'multi-chain':   'Multi-Chain View',
  'webhooks':      'Webhooks',
  'tx-builder':    'Transaction Builder',
  'risk':          'Risk Dashboard',
  'key-ceremony':  'Key Ceremony',
  'hsm-health':    'HSM Health',
  'multisig':      'Approvals',
  'automations':   'Automations',
};

let _currentUser = null;
let _authCheckedAt = 0;
const AUTH_CACHE_MS = 30_000; // re-verify session at most every 30s

async function checkAuth() {
  // Dev mode: bypass auth entirely when no backend is running.
  // Detects static file servers (Python, serve, etc.) by checking for /health JSON endpoint.
  if (!window.__devAuthChecked) {
    window.__devAuthChecked = true;
    try {
      const probe = await fetch('/health', { signal: AbortSignal.timeout(2000) });
      const ct = probe.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('not json');
      window.__hasBackend = true;
    } catch {
      window.__hasBackend = false;
    }
  }
  if (window.__hasBackend === false) {
    _currentUser = { username: 'admin', displayName: 'Admin (Dev)' };
    _authCheckedAt = Date.now();
    return true;
  }

  const token = getSessionToken();
  if (!token) return false;

  // Use cached result if recently verified
  if (_currentUser && (Date.now() - _authCheckedAt) < AUTH_CACHE_MS) {
    return true;
  }

  // auth.me() returns null on failure (never throws)
  let user = await auth.me();

  // If first attempt failed, retry once after a short delay
  if (!user) {
    await new Promise(r => setTimeout(r, 500));
    user = await auth.me();
  }

  if (user) {
    _currentUser = user;
    _authCheckedAt = Date.now();
    return true;
  }

  // Both attempts returned null — token is invalid
  setSessionToken(null);
  _currentUser = null;
  _authCheckedAt = 0;
  return false;
}

async function showLogin() {
  document.getElementById('app-shell').classList.add('hidden');
  const loginContainer = document.getElementById('login-container');
  loginContainer.innerHTML = renderLogin();
  loginContainer.classList.remove('hidden');
  initLogin(async () => {
    _currentUser = await auth.me();
    loginContainer.classList.add('hidden');
    loginContainer.innerHTML = '';
    document.getElementById('app-shell').classList.remove('hidden');
    updateUserMenu();
    route();
  });
}

function updateUserMenu() {
  if (!_currentUser) return;
  const menu = document.getElementById('user-menu');
  if (menu) {
    const initial = (_currentUser.displayName || _currentUser.username || 'A')[0].toUpperCase();
    menu.innerHTML = `
      <div class="user-avatar">${initial}</div>
      <span>${_currentUser.displayName || _currentUser.username}</span>
    `;
  }
}

async function route() {
  const isAuth = await checkAuth();
  if (!isAuth) { showLogin(); return; }

  const hash = (window.location.hash || '#/').replace('#/', '');
  const parts = hash.split('/');
  const page = parts[0] || '';
  const pageTitle = document.getElementById('page-title');
  const pageContent = document.getElementById('page-content');

  pageTitle.textContent = TITLES[page] || 'Blue Console';
  pageContent.innerHTML = '<div class="loading">Loading...</div>';

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(item => {
    const itemPage = item.dataset.page;
    const isActive = (page === '' && itemPage === 'dashboard') || itemPage === page;
    item.classList.toggle('active', isActive);
  });

  try {
    if (page === '' || page === 'dashboard') {
      pageContent.innerHTML = await renderDashboard();
    } else if (page === 'wallets' && parts[1] === 'new') {
      pageContent.innerHTML = await renderCreateWallet();
      initCreateWallet();
    } else if (page === 'wallets' && parts[1] && parts[2] === 'transfer') {
      pageContent.innerHTML = await renderTransfer(parts[1]);
      initTransfer(parts[1]);
    } else if (page === 'wallets' && parts[1]) {
      pageContent.innerHTML = await renderWalletDetail(parts[1]);
      initWalletDetail(parts[1]);
    } else if (page === 'wallets') {
      pageContent.innerHTML = await renderWallets();
      initWallets();
    } else if (page === 'vaults' && parts[1]) {
      pageContent.innerHTML = await renderVaultDetail(parts[1]);
      initVaultDetail(parts[1]);
    } else if (page === 'vaults') {
      pageContent.innerHTML = await renderVaults();
      initVaults();
    } else if (page === 'policies') {
      pageContent.innerHTML = await renderPolicies();
      initPolicies();
    } else if (page === 'roles') {
      pageContent.innerHTML = await renderRoles();
      initRoles();
    } else if (page === 'permissions') {
      pageContent.innerHTML = await renderPermissions();
      initPermissions();
    } else if (page === 'balances') {
      pageContent.innerHTML = await renderBalances();
    } else if (page === 'gas-station') {
      pageContent.innerHTML = await renderGasStation();
    } else if (page === 'transactions') {
      pageContent.innerHTML = await renderTransactions();
      initTransactions();
    } else if (page === 'deposits') {
      pageContent.innerHTML = await renderDeposits();
    } else if (page === 'compliance') {
      pageContent.innerHTML = await renderCompliance();
    } else if (page === 'connectivity') {
      pageContent.innerHTML = await renderConnectivity();
    } else if (page === 'chains') {
      pageContent.innerHTML = await renderChains();
    } else if (page === 'settings') {
      pageContent.innerHTML = await renderSettings();
    } else if (page === 'api-keys') {
      pageContent.innerHTML = await renderApiKeys();
      initApiKeys();
    } else if (page === 'test-exercise') {
      pageContent.innerHTML = await renderTestExercise();
      initTestExercise();
    } else if (page === 'api-docs') {
      pageContent.innerHTML = await renderApiDocs();
    } else if (page === 'whitepaper') {
      pageContent.innerHTML = await renderWhitepaper();
    } else if (page === 'realtime') {
      pageContent.innerHTML = await renderRealtimeDashboard();
      initRealtimeDashboard();
    } else if (page === 'audit-log') {
      pageContent.innerHTML = await renderAuditLog();
      initAuditLog();
    } else if (page === 'multi-chain') {
      pageContent.innerHTML = await renderMultiChain();
      initMultiChain();
    } else if (page === 'webhooks') {
      pageContent.innerHTML = await renderWebhooks();
      initWebhooks();
    } else if (page === 'tx-builder') {
      pageContent.innerHTML = await renderTxBuilder();
      initTxBuilder();
    } else if (page === 'risk') {
      pageContent.innerHTML = await renderRiskDashboard();
      initRiskDashboard();
    } else if (page === 'key-ceremony') {
      pageContent.innerHTML = await renderKeyCeremony();
      initKeyCeremony();
    } else if (page === 'hsm-health') {
      pageContent.innerHTML = await renderHsmHealth();
      initHsmHealth();
    } else if (page === 'multisig') {
      pageContent.innerHTML = await renderMultisig();
      initMultisig();
    } else if (page === 'automations') {
      pageContent.innerHTML = await renderAutomations();
      initAutomations();
    } else {
      pageContent.innerHTML = '<div class="empty-state"><h3>Page not found</h3></div>';
    }
  } catch (err) {
    console.error('Page render error:', page, err);
    pageContent.innerHTML = `
      <div style="text-align:center;padding:var(--sp-8);color:var(--text-tertiary)">
        <div style="font-size:32px;margin-bottom:var(--sp-4)">&#9888;</div>
        <h3 style="color:var(--text-primary);margin-bottom:var(--sp-2)">Page failed to load</h3>
        <p style="margin-bottom:var(--sp-4);font-size:13px">${err.message || 'An unexpected error occurred.'}</p>
        <button class="btn-action" id="btn-retry-page" style="font-size:13px">Retry</button>
      </div>`;
    setTimeout(() => {
      document.getElementById('btn-retry-page')?.addEventListener('click', () => route());
    }, 0);
  }
}

// Logout handler
document.addEventListener('click', (e) => {
  if (e.target.id === 'logout-btn' || e.target.closest('#logout-btn')) {
    auth.logout().then(() => {
      _currentUser = null;
      showLogin();
    });
  }
});

window.addEventListener('hashchange', route);
window.addEventListener('load', route);
window.addEventListener('session-expired', () => showLogin());
