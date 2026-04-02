import { auth, setSessionToken } from './api.js';

// ── Base64url ↔ ArrayBuffer helpers for WebAuthn ──────────────────────────
function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function checkAuthAndRender(onAuthenticated) {
  const meResult = await auth.me();
  if (meResult?.user) {
    onAuthenticated(meResult.user);
    return;
  }
  renderLoginPage(onAuthenticated);
}

function renderLoginPage(onAuthenticated) {
  document.body.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      .login-root {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #080a0f;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        position: relative;
        overflow: hidden;
      }

      /* Layered background */
      .login-root::before {
        content: '';
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse 80% 60% at 50% -10%, rgba(37,99,235,0.18) 0%, transparent 60%),
          radial-gradient(ellipse 50% 40% at 80% 90%, rgba(37,99,235,0.08) 0%, transparent 50%);
        pointer-events: none;
      }

      /* Subtle dot grid */
      .login-root::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image: radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
        background-size: 28px 28px;
        pointer-events: none;
        mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 40%, transparent 100%);
      }

      .login-card {
        position: relative;
        z-index: 10;
        width: 400px;
        background: rgba(18, 21, 32, 0.92);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        padding: 40px;
        box-shadow:
          0 0 0 1px rgba(37,99,235,0.1),
          0 32px 64px rgba(0,0,0,0.6),
          0 0 80px rgba(37,99,235,0.06);
        backdrop-filter: blur(20px);
        animation: card-appear 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
      }

      @keyframes card-appear {
        from { opacity: 0; transform: translateY(20px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* Logo area */
      .login-logo-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 36px;
      }

      .login-logo-img {
        width: 72px;
        height: 72px;
        object-fit: cover;
        border-radius: 20px;   /* clips the black corners of the PNG */
        margin-bottom: 14px;
        box-shadow:
          0 0 0 1px rgba(43,136,255,0.2),
          0 8px 32px rgba(43,136,255,0.35),
          0 2px 8px rgba(0,0,0,0.4);
        animation: logo-glow 3s ease-in-out infinite;
      }

      @keyframes logo-glow {
        0%, 100% { box-shadow: 0 0 0 1px rgba(43,136,255,0.2), 0 8px 32px rgba(43,136,255,0.3),  0 2px 8px rgba(0,0,0,0.4); }
        50%       { box-shadow: 0 0 0 1px rgba(43,136,255,0.3), 0 8px 40px rgba(43,136,255,0.55), 0 2px 8px rgba(0,0,0,0.4); }
      }

      .login-brand-name {
        font-size: 20px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: -0.02em;
        margin-bottom: 3px;
      }

      .login-brand-sub {
        font-size: 12px;
        color: rgba(255,255,255,0.35);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      /* Divider */
      .login-divider {
        width: 100%;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
        margin-bottom: 28px;
      }

      /* Heading */
      .login-heading {
        font-size: 22px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: -0.02em;
        margin-bottom: 6px;
      }

      .login-subheading {
        font-size: 13px;
        color: rgba(255,255,255,0.4);
        margin-bottom: 28px;
        line-height: 1.5;
      }

      /* Error */
      .login-error {
        display: none;
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.25);
        border-radius: 10px;
        padding: 10px 14px;
        color: #fca5a5;
        font-size: 13px;
        margin-bottom: 16px;
        animation: shake 0.3s ease;
      }
      @keyframes shake {
        0%,100% { transform: translateX(0); }
        25%      { transform: translateX(-4px); }
        75%      { transform: translateX(4px); }
      }

      /* Fields */
      .login-field { margin-bottom: 18px; }

      .login-label {
        display: block;
        color: rgba(255,255,255,0.45);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 8px;
      }

      .login-input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 10px;
        padding: 12px 14px;
        color: #ffffff;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
      }
      .login-input::placeholder { color: rgba(255,255,255,0.2); }
      .login-input:hover {
        border-color: rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.06);
      }
      .login-input:focus {
        border-color: rgba(37,99,235,0.6);
        background: rgba(37,99,235,0.06);
        box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
      }

      /* Button */
      .login-btn {
        width: 100%;
        background: linear-gradient(135deg, #2563EB 0%, #1d4ed8 100%);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 13px;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        margin-top: 8px;
        position: relative;
        overflow: hidden;
        transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
        box-shadow: 0 4px 16px rgba(37,99,235,0.35);
        letter-spacing: 0.01em;
      }
      .login-btn::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 100%);
        border-radius: inherit;
        pointer-events: none;
      }
      .login-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(37,99,235,0.5);
      }
      .login-btn:active:not(:disabled) {
        transform: translateY(0);
        box-shadow: 0 2px 8px rgba(37,99,235,0.3);
      }
      .login-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      /* Spinner */
      .login-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        vertical-align: middle;
        margin-right: 8px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Hint toggle */
      .login-hint-toggle {
        background: none;
        border: none;
        color: rgba(255,255,255,0.2);
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        padding: 0;
        margin-top: 14px;
        display: block;
        width: 100%;
        text-align: center;
        transition: color 0.15s;
      }
      .login-hint-toggle:hover { color: rgba(255,255,255,0.45); }

      .login-hint-box {
        display: none;
        margin-top: 10px;
        background: rgba(43,136,255,0.06);
        border: 1px solid rgba(43,136,255,0.15);
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 12px;
        color: rgba(255,255,255,0.45);
        line-height: 1.7;
      }
      .login-hint-box code {
        font-family: 'JetBrains Mono', monospace;
        color: rgba(43,136,255,0.9);
        background: rgba(43,136,255,0.1);
        padding: 1px 5px;
        border-radius: 4px;
      }

      /* Footer */
      .login-footer {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid rgba(255,255,255,0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: rgba(255,255,255,0.18);
        font-size: 11px;
      }
      .login-footer-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(34,197,94,0.6);
        flex-shrink: 0;
      }
    </style>

    <div class="login-root">
      <div class="login-card">

        <!-- Logo -->
        <div class="login-logo-wrap">
          <img src="/img/logo.png" alt="Blue Wallets" class="login-logo-img" id="logo-img">
          <div class="login-brand-name">Blue Wallets</div>
          <div class="login-brand-sub">HSM Key Management Console</div>
        </div>

        <div class="login-divider"></div>

        <div class="login-heading">Sign in</div>
        <div class="login-subheading">Authenticate to access the Blue Driver</div>

        <div class="login-error" id="login-error"></div>

        <!-- Phase 1: Username -->
        <div id="phase-username">
          <div class="login-field">
            <label class="login-label" for="login-username">Username</label>
            <input id="login-username" class="login-input" type="text"
              autocomplete="username" autocorrect="off" autocapitalize="off"
              placeholder="Enter username">
          </div>
          <button id="continue-btn" class="login-btn">Continue</button>
        </div>

        <!-- Phase 2a: Passkey -->
        <div id="phase-passkey" style="display:none;text-align:center;padding:20px 0">
          <div style="margin-bottom:16px">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="rgba(37,99,235,0.3)" stroke-width="2"/>
              <circle cx="24" cy="24" r="20" stroke="#2563EB" stroke-width="2" stroke-dasharray="4 4" class="login-passkey-ring"/>
              <path d="M18 24h12M24 18v12" stroke="#2563EB" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div style="font-size:15px;font-weight:600;color:white;margin-bottom:6px">Authenticating with passkey…</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.4)">Touch your security key or use biometrics</div>
          <button id="use-password-btn" style="background:none;border:none;color:rgba(37,99,235,0.7);font-size:12px;margin-top:16px;cursor:pointer;font-family:inherit">Use password instead</button>
        </div>

        <!-- Phase 2b: Password (shown if no passkey or user chooses password) -->
        <div id="phase-password" style="display:none">
          <div class="login-field">
            <label class="login-label">Username</label>
            <div style="font-size:14px;color:white;padding:10px 0" id="password-username-display"></div>
          </div>
          <div class="login-field">
            <label class="login-label" for="login-password">Password</label>
            <input id="login-password" class="login-input" type="password"
              autocomplete="current-password" placeholder="••••••••">
          </div>
          <button id="login-btn" class="login-btn">Sign In</button>
          <button id="back-to-username" style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:12px;margin-top:10px;cursor:pointer;display:block;width:100%;text-align:center;font-family:inherit">← Back</button>
        </div>

        <button class="login-hint-toggle" id="hint-toggle">Need login credentials? ›</button>
        <div class="login-hint-box" id="hint-box">
          <strong style="color:rgba(255,255,255,0.5)">Default accounts:</strong><br>
          Admin: <code>admin</code> / <code>Admin1234!</code><br>
          Officer: <code>officer1</code> / <code>Officer1234!</code>
        </div>

        <div class="login-footer">
          <div class="login-footer-dot"></div>
          <span>FIPS 140-3 Level 3 · End-to-end encrypted · Session expires in 8 hours</span>
        </div>

      </div>
    </div>`;

  // Fallback if logo fails to load — show the lock icon
  const logoImg = document.getElementById('logo-img');
  logoImg.onerror = () => {
    logoImg.style.display = 'none';
    const fallback = document.createElement('div');
    fallback.style.cssText = 'width:64px;height:64px;background:linear-gradient(135deg,#2563EB,#1d4ed8);border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;box-shadow:0 4px 20px rgba(37,99,235,0.5)';
    fallback.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="5" y="14" width="22" height="14" rx="3" stroke="white" stroke-width="2"/><path d="M10 14V10a6 6 0 0112 0v4" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
    logoImg.parentElement.insertBefore(fallback, logoImg.nextSibling);
  };

  const errDiv = document.getElementById('login-error');
  let currentUsername = '';

  function showError(msg) {
    errDiv.textContent = msg;
    errDiv.style.display = 'block';
    errDiv.style.animation = 'none';
    errDiv.offsetHeight;
    errDiv.style.animation = '';
  }

  function loginSuccess(btn) {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:middle;margin-right:6px"><path d="M3 8l3.5 3.5 7-7" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Welcome back`;
    btn.style.background = 'linear-gradient(135deg, #16a34a, #15803d)';
    btn.style.boxShadow  = '0 4px 20px rgba(22,163,74,0.5)';
    setTimeout(() => window.location.reload(), 600);
  }

  // Phase 1: Continue button → check passkey availability
  const continueBtn = document.getElementById('continue-btn');
  continueBtn.addEventListener('click', async () => {
    currentUsername = document.getElementById('login-username').value.trim();
    if (!currentUsername) return;

    continueBtn.disabled = true;
    continueBtn.innerHTML = `<span class="login-spinner"></span>Checking…`;
    errDiv.style.display = 'none';

    try {
      // Check if user has a passkey
      const res = await fetch('/auth/webauthn/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUsername }),
      });
      const options = await res.json();

      if (options.available && window.PublicKeyCredential) {
        // User has a passkey — try WebAuthn
        showPasskeyPhase(options);
      } else {
        // No passkey — show password form
        showPasswordPhase();
      }
    } catch {
      // On error, fall back to password
      showPasswordPhase();
    }
    continueBtn.disabled = false;
    continueBtn.innerHTML = 'Continue';
  });

  document.getElementById('login-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') continueBtn.click();
  });

  // Phase 2a: Passkey authentication
  async function showPasskeyPhase(options) {
    document.getElementById('phase-username').style.display = 'none';
    document.getElementById('phase-passkey').style.display = 'block';

    try {
      // Convert base64url to ArrayBuffer
      const publicKeyOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        allowCredentials: (options.allowCredentials || []).map(c => ({
          ...c,
          id: base64urlToBuffer(c.id),
        })),
      };

      const credential = await navigator.credentials.get({ publicKey: publicKeyOptions });

      // Convert response to JSON
      const credJson = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bufferToBase64url(credential.response.authenticatorData),
          clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
          signature: bufferToBase64url(credential.response.signature),
          userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : null,
        },
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
      };

      // Verify with server
      const verifyRes = await fetch('/auth/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUsername, ...credJson }),
      });

      if (!verifyRes.ok) throw new Error('Passkey verification failed');

      const data = await verifyRes.json();
      auth.login = async () => data; // Override to set token
      await auth.login(currentUsername, '');
      // Actually set the token manually since we bypassed the real login
      const { setSessionToken } = await import('./api.js');
      setSessionToken(data.token);
      loginSuccess(document.getElementById('use-password-btn') || continueBtn);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
        // User cancelled — fall back to password
        showPasswordPhase();
      } else {
        showError(err.message || 'Passkey authentication failed');
        showPasswordPhase();
      }
    }
  }

  // Phase 2b: Password form
  function showPasswordPhase() {
    document.getElementById('phase-username').style.display = 'none';
    document.getElementById('phase-passkey').style.display = 'none';
    document.getElementById('phase-password').style.display = 'block';
    document.getElementById('password-username-display').textContent = currentUsername;
    setTimeout(() => document.getElementById('login-password')?.focus(), 100);
  }

  // Back button
  document.getElementById('back-to-username')?.addEventListener('click', () => {
    document.getElementById('phase-password').style.display = 'none';
    document.getElementById('phase-passkey').style.display = 'none';
    document.getElementById('phase-username').style.display = 'block';
    errDiv.style.display = 'none';
  });

  // Use password button (from passkey phase)
  document.getElementById('use-password-btn')?.addEventListener('click', () => {
    showPasswordPhase();
  });

  // Password login
  const loginBtn = document.getElementById('login-btn');
  async function doPasswordLogin() {
    const password = document.getElementById('login-password').value;
    if (!currentUsername || !password) return;

    loginBtn.disabled = true;
    loginBtn.innerHTML = `<span class="login-spinner"></span>Signing in…`;
    errDiv.style.display = 'none';

    try {
      await auth.login(currentUsername, password);
      loginSuccess(loginBtn);
    } catch (err) {
      showError(err.message || 'Login failed');
      loginBtn.disabled = false;
      loginBtn.innerHTML = 'Sign In';
    }
  }

  if (loginBtn) loginBtn.addEventListener('click', doPasswordLogin);
  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doPasswordLogin();
  });

  // Hint toggle
  const hintToggle = document.getElementById('hint-toggle');
  const hintBox    = document.getElementById('hint-box');
  hintToggle.addEventListener('click', () => {
    const open = hintBox.style.display === 'block';
    hintBox.style.display = open ? 'none' : 'block';
    hintToggle.textContent = open ? 'Need login credentials? ›' : 'Hide credentials ‹';
  });

  // Auto-focus username
  setTimeout(() => document.getElementById('login-username')?.focus(), 100);
}
