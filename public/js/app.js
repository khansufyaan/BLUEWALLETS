/**
 * Blue Driver — Application Router
 *
 * Minimal: only Key Ceremony and HSM Health.
 * All other pages (wallets, policies, etc.) are on the Blue Console.
 */

import { renderHealth } from './pages/health.js';
import { renderCeremony, initCeremony } from './pages/ceremony.js';
import { renderUsers, initUsers } from './pages/users.js';
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
  pageContent.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">Loading...</div>';

  // Highlight active nav
  document.querySelectorAll('.nav-item').forEach(item => {
    const page = item.dataset.page;
    const isActive = (hash === '/' || hash === '' || hash === '/ceremony') && page === 'ceremony'
                  || hash === '/health' && page === 'health'
                  || hash === '/users' && page === 'users';
    item.classList.toggle('active', isActive);
  });

  let title = 'Blue Driver';

  try {
    if (hash === '/' || hash === '' || hash === '/ceremony') {
      title = 'Key Ceremony';
      pageContent.innerHTML = renderCeremony();
      initCeremony();
    } else if (hash === '/health') {
      title = 'HSM Health';
      pageContent.innerHTML = await renderHealth();
    } else if (hash === '/users') {
      title = 'Users';
      pageContent.innerHTML = renderUsers();
      initUsers();
    } else {
      pageContent.innerHTML = `
        <div style="text-align:center;padding:60px;color:var(--text-tertiary)">
          <div style="font-size:40px;margin-bottom:16px">🔒</div>
          <h3 style="color:var(--text-secondary);margin-bottom:8px">Blue Driver</h3>
          <p>This portal is for HSM configuration only.</p>
          <p style="margin-top:12px">For wallets, policies, and daily operations, use <strong>Blue Console</strong>.</p>
        </div>`;
    }
  } catch (err) {
    pageContent.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }

  pageTitle.textContent = title;

  // Update active nav highlight
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('href') === '#' + hash || (hash === '/' && item.dataset.page === 'ceremony')) {
      item.classList.add('active');
    }
  });
}

// Boot
checkAuthAndRender((user) => {
  _currentUser = user;
  route();
  window.addEventListener('hashchange', route);

  // Refresh HSM status every 10 seconds + on ceremony connect
  setInterval(updateHsmStatus, 10_000);
  window.addEventListener('hsm-connected', updateHsmStatus);

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await auth.logout();
      window.location.reload();
    });
  }
});
