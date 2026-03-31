import { auth } from './api.js';

export async function checkAuthAndRender(onAuthenticated) {
  // Check if we have a valid session
  const meResult = await auth.me();
  if (meResult?.user) {
    onAuthenticated(meResult.user);
    return;
  }
  renderLoginPage(onAuthenticated);
}

function renderLoginPage(onAuthenticated) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117">
      <div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:40px;width:360px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
          <div style="width:36px;height:36px;background:#2563EB;border-radius:8px;display:flex;align-items:center;justify-content:center">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="9" width="14" height="9" rx="2" stroke="white" stroke-width="1.5"/><path d="M7 9V6a3 3 0 016 0v3" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div>
            <div style="color:white;font-weight:600;font-size:16px">Blue Wallets</div>
            <div style="color:#6b7280;font-size:12px">HSM Key Management</div>
          </div>
        </div>
        <div style="color:white;font-size:20px;font-weight:600;margin-bottom:8px">Sign in</div>
        <div style="color:#6b7280;font-size:13px;margin-bottom:24px">Enter your credentials to continue</div>
        <div id="login-error" style="display:none;background:#2d1a1a;border:1px solid #7f1d1d;border-radius:8px;padding:10px 12px;color:#fca5a5;font-size:13px;margin-bottom:16px"></div>
        <div style="margin-bottom:16px">
          <label style="color:#9ca3af;font-size:12px;font-weight:500;display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Username</label>
          <input id="login-username" type="text" autocomplete="username" autocorrect="off" autocapitalize="off"
            style="width:100%;box-sizing:border-box;background:#0f1117;border:1px solid #2a2d3a;border-radius:8px;padding:10px 12px;color:white;font-size:14px;outline:none"
            placeholder="username">
        </div>
        <div style="margin-bottom:24px">
          <label style="color:#9ca3af;font-size:12px;font-weight:500;display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Password</label>
          <input id="login-password" type="password" autocomplete="current-password"
            style="width:100%;box-sizing:border-box;background:#0f1117;border:1px solid #2a2d3a;border-radius:8px;padding:10px 12px;color:white;font-size:14px;outline:none"
            placeholder="••••••••">
        </div>
        <button id="login-btn"
          style="width:100%;background:#2563EB;color:white;border:none;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer">
          Sign In
        </button>
        <div style="color:#374151;font-size:11px;text-align:center;margin-top:20px">
          Default credentials: admin / Admin1234!
        </div>
      </div>
    </div>`;

  const btn = document.getElementById('login-btn');
  const errDiv = document.getElementById('login-error');

  async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) return;
    btn.disabled = true;
    btn.textContent = 'Signing in\u2026';
    errDiv.style.display = 'none';
    try {
      const result = await auth.login(username, password);
      onAuthenticated(result.user);
    } catch (err) {
      errDiv.textContent = err.message || 'Login failed';
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  btn.addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });
}
