export function renderLogin() {
  return `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-logo">
          <img src="/img/logo.png" alt="Blue" style="width:40px;height:40px;border-radius:10px">
          <span class="logo-text">Blue Wallets</span>
        </div>
        <p class="login-tagline">Institutional-Grade Digital Asset Custody</p>
        <form id="login-form">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="login-email" value="admin@bluewallets.io" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="login-password" value="admin" required>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Sign In</button>
        </form>
        <div class="login-hsm-badge">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="#71717A" stroke-width="1.5"><path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/></svg>
          Secured by Thales Luna HSM
        </div>
      </div>
    </div>
  `;
}

export function initLogin(onLogin) {
  document.getElementById('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('waas_auth', 'true');
    onLogin();
  });
}
