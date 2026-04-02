import { auth } from '../api.js';

export function renderLogin() {
  return `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-logo">
          <div class="login-logo-mark">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="4" y="4" width="24" height="10" rx="4" fill="#1D4ED8"/>
              <rect x="4" y="11" width="24" height="10" rx="4" fill="#2563EB"/>
              <rect x="4" y="18" width="24" height="10" rx="4" fill="#60A5FA"/>
            </svg>
          </div>
          <span class="login-logo-text">Blue Console</span>
        </div>
        <p class="login-tagline">Institutional-Grade Digital Asset Custody</p>

        <form id="login-form">
          <div class="form-group">
            <label class="form-label" for="login-username">Username</label>
            <input type="text" class="form-input" id="login-username" placeholder="admin" required autocomplete="username">
          </div>
          <div class="form-group">
            <label class="form-label" for="login-password">Password</label>
            <input type="password" class="form-input" id="login-password" placeholder="Enter password" required autocomplete="current-password">
          </div>
          <div id="login-error" class="login-error"></div>
          <button type="submit" class="login-submit" id="login-btn">
            <span id="login-btn-text">Sign In</span>
            <svg id="login-btn-spinner" class="login-spinner" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none">
              <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
              <path d="M14 8a6 6 0 0 0-6-6" stroke="white" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </form>

        <div class="login-hsm-badge">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/>
          </svg>
          Secured by Thales Luna HSM
        </div>
      </div>
    </div>
  `;
}

export function initLogin(onLogin) {
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    const btnText = document.getElementById('login-btn-text');
    const btnSpinner = document.getElementById('login-btn-spinner');

    if (!username || !password) {
      errorEl.textContent = 'Username and password are required';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btnText.textContent = 'Signing in';
    btnSpinner.style.display = 'inline-block';
    errorEl.style.display = 'none';

    try {
      await auth.login(username, password);
      btnText.textContent = 'Redirecting...';
      onLogin();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btnText.textContent = 'Sign In';
      btnSpinner.style.display = 'none';
    }
  });
}
