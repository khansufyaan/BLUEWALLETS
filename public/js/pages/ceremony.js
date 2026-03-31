/* HSM Key Ceremony — FIPS 140-3 Level 3 · dual-control approval */

import { api, auth, setSessionToken, getSessionToken } from '../api.js';

const STEPS = [
  { id: 'connect',   title: 'Connect HSM',          subtitle: 'Configure your PKCS#11 provider' },
  { id: 'initiate',  title: 'Initiate Ceremony',    subtitle: 'Request dual-officer approval to begin' },
  { id: 'approve',   title: 'Officer Approval',     subtitle: 'Two independent officers must authorise' },
  { id: 'keygen',    title: 'Initialize HSM Keys',  subtitle: 'AES-256 master wrap key generated inside the HSM' },
  { id: 'accounts',  title: 'Account Structure',    subtitle: 'BIP-44 coin type configuration' },
  { id: 'complete',  title: 'HSM Ready',            subtitle: 'Your hardware module is initialized' },
];

// Well-known PKCS#11 library presets
const HSM_PRESETS = {
  luna: {
    name: 'Luna HSM',
    vendor: 'Thales',
    paths: {
      linux:  '/usr/lib/libCryptoki2_64.so',
      macos:  '/usr/local/lib/libCryptoki2_64.dylib',
      win:    'C:\\Program Files\\SafeNet\\LunaClient\\cryptoki.dll',
    },
  },
  softhsm: {
    name: 'SoftHSM2',
    vendor: 'OpenDNSSEC',
    paths: {
      linux:  '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so',
      macos:  '/opt/homebrew/lib/softhsm/libsofthsm2.so',
      win:    'C:\\SoftHSM2\\lib\\softhsm2-x64.dll',
    },
  },
  utimaco: {
    name: 'Utimaco HSM',
    vendor: 'Utimaco',
    paths: {
      linux:  '/opt/utimaco/lib/libcs_pkcs11_R3.so',
      macos:  '/opt/utimaco/lib/libcs_pkcs11_R3.dylib',
    },
  },
  nshield: {
    name: 'Entrust nShield',
    vendor: 'Entrust',
    paths: {
      linux:  '/opt/nfast/toolkits/pkcs11/libcknfast.so',
      macos:  '/opt/nfast/toolkits/pkcs11/libcknfast.dylib',
    },
  },
  custom: { name: 'Custom', vendor: '', paths: {} },
};

const BIP44_COINS = [
  { coin: 'Bitcoin',   symbol: 'BTC',  type: "0'",    checked: true  },
  { coin: 'Ethereum',  symbol: 'ETH',  type: "60'",   checked: true  },
  { coin: 'Solana',    symbol: 'SOL',  type: "501'",  checked: true  },
  { coin: 'BNB Chain', symbol: 'BNB',  type: "714'",  checked: false },
  { coin: 'Polygon',   symbol: 'POL',  type: "966'",  checked: false },
  { coin: 'Avalanche', symbol: 'AVAX', type: "9000'", checked: false },
];

// ── Shared mutable state ────────────────────────────────────────────────────

let state = {
  step: 0,

  // Demo mode (bypass quorum)
  demoMode: false,

  // HSM connect
  hsmConnected:    false,
  hsmProvider:     null,
  hsmLibrary:      '',
  hsmSlot:         0,
  hsmConnecting:   false,
  hsmConnectError: null,
  hsmTokenLabel:   null,
  selectedPreset:  'luna',
  hsmConnectStage: 0,   // 0=idle 1=library 2=slots 3=session 4=auth 5=done

  // Approval
  approvalId:           null,
  approvalStatus:       null,   // 'pending' | 'approved'
  approvalCount:        0,
  approvalRequestedBy:  '',
  approvalReason:       '',
  officerLoginUsername: '',
  officerLoginPassword: '',
  officerLoginError:    null,
  officerLoginLoading:  false,

  // Key generation (Step 4)
  keygenLoading:  false,
  keygenDone:     false,
  keygenError:    null,
  wrapKeyLabel:   null,

  // Completion
  completedAt: null,

  // Accounts
  selectedCoins: new Set(['BTC', 'ETH', 'SOL']),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Confetti ─────────────────────────────────────────────────────────────────

function fireConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const COLORS = ['#22C55E','#2563EB','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4'];
  const pieces = Array.from({ length: 100 }, () => ({
    x:  Math.random() * canvas.width,
    y: -20 - Math.random() * 80,
    vx: (Math.random() - 0.5) * 5,
    vy: Math.random() * 4 + 2,
    w:  Math.random() * 10 + 5,
    h:  Math.random() * 6 + 3,
    r:  Math.random() * Math.PI * 2,
    dr: (Math.random() - 0.5) * 0.2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.06;
      p.r  += p.dr;
      if (p.y < canvas.height + 30) { alive = true; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - frame / 160);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (alive && frame < 200) requestAnimationFrame(draw);
    else canvas.remove();
  }
  draw();
}

// ─── Step renderers ──────────────────────────────────────────────────────────

function renderConnect() {
  const preset = HSM_PRESETS[state.selectedPreset] || HSM_PRESETS.luna;
  const ua = navigator.userAgent.toLowerCase();
  const os = ua.includes('win') ? 'win' : ua.includes('mac') ? 'macos' : 'linux';
  const defaultLib = state.hsmLibrary || preset.paths[os] || preset.paths.linux || '';

  const STAGE_LABELS = [
    'Loading PKCS#11 library',
    'Scanning HSM partitions',
    'Opening session',
    'Authenticating PIN',
  ];

  // ── Connected success state ──────────────────────────────
  if (state.hsmConnected) {
    return `
      <div class="cer-connect">
        <div class="cer-hsm-connected-hero">
          <div class="cer-electric-ring cer-electric-done" id="electric-ring">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="36" stroke="rgba(34,197,94,0.15)" stroke-width="2"/>
              <circle cx="40" cy="40" r="28" stroke="rgba(34,197,94,0.25)" stroke-width="2"/>
              <circle cx="40" cy="40" r="20" fill="rgba(34,197,94,0.12)" stroke="#22C55E" stroke-width="1.5"/>
              <path d="M34 38l4-7 2 5h4l-4 7-2-5h-4z" fill="#22C55E" class="cer-bolt"/>
            </svg>
          </div>
          <div class="cer-hsm-connected-info">
            <div class="cer-hsm-connected-title">HSM Connected</div>
            <div class="cer-hsm-connected-sub">${state.hsmProvider || 'PKCS#11 Device'} · Token: ${state.hsmTokenLabel || 'Ready'}</div>
          </div>
        </div>

        <div class="cer-checklist">
          ${STAGE_LABELS.map((label, i) => `
            <div class="cer-checklist-item cer-checklist-done" style="animation-delay:${i * 60}ms">
              <div class="cer-checklist-icon">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <span>${label}</span>
            </div>
          `).join('')}
        </div>

        <div class="cer-connect-action" style="margin-top:8px">
          <button class="btn btn-ghost" id="hsm-connect-btn" style="font-size:12px">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Re-test Connection
          </button>
        </div>
      </div>`;
  }

  // ── Connecting state ─────────────────────────────────────
  if (state.hsmConnecting) {
    const stage = state.hsmConnectStage; // 0-4
    return `
      <div class="cer-connect">
        <div class="cer-checklist-header">Establishing HSM connection…</div>
        <div class="cer-checklist">
          ${STAGE_LABELS.map((label, i) => {
            const done   = i < stage;
            const active = i === stage;
            return `
              <div class="cer-checklist-item ${done ? 'cer-checklist-done' : active ? 'cer-checklist-active' : 'cer-checklist-wait'}">
                <div class="cer-checklist-icon">
                  ${done
                    ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                    : active
                      ? `<div class="cer-spinner-sm" style="width:10px;height:10px;border-width:2px"></div>`
                      : `<span style="font-size:9px;color:var(--text-tertiary)">${i+1}</span>`}
                </div>
                <span>${label}${active ? '…' : done ? '' : ''}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ── Idle / error state ────────────────────────────────────
  return `
    <div class="cer-connect">

      <!-- Vendor picker -->
      <div class="cer-connect-section">
        <div class="cer-connect-label">HSM Provider</div>
        <div class="cer-vendor-grid" id="vendor-grid">
          ${Object.entries(HSM_PRESETS).map(([key, p]) => `
            <button class="cer-vendor-btn ${state.selectedPreset === key ? 'active' : ''}"
              data-preset="${key}">
              ${p.name}
              ${p.vendor ? `<span class="cer-vendor-sub">${p.vendor}</span>` : ''}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Library path -->
      <div class="cer-connect-section">
        <label class="cer-connect-label" for="hsm-lib">PKCS#11 Library Path</label>
        <input class="cer-connect-input" id="hsm-lib" type="text"
          placeholder="/usr/lib/libCryptoki2_64.so"
          value="${defaultLib}" autocomplete="off" spellcheck="false">
        <div class="cer-connect-hint">
          Path to the PKCS#11 shared library (.so / .dylib / .dll) on the server host
        </div>
      </div>

      <!-- Slot + PIN row -->
      <div class="cer-connect-row">
        <div class="cer-connect-section" style="flex:0 0 120px">
          <label class="cer-connect-label" for="hsm-slot">Slot Index</label>
          <input class="cer-connect-input" id="hsm-slot" type="number"
            min="0" max="99" value="${state.hsmSlot}" style="text-align:center">
        </div>
        <div class="cer-connect-section" style="flex:1">
          <label class="cer-connect-label" for="hsm-pin">HSM PIN / Password</label>
          <input class="cer-connect-input" id="hsm-pin" type="password"
            placeholder="••••••••" autocomplete="current-password">
        </div>
      </div>

      <!-- Connect button + status -->
      <div class="cer-connect-action">
        <button class="btn btn-primary" id="hsm-connect-btn">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Connect
        </button>

        ${state.hsmConnectError ? `
          <div class="cer-connect-error">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--red)" stroke-width="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="var(--red)" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>${state.hsmConnectError}</span>
          </div>` : ''}
      </div>

    </div>`;
}

function renderInitiate() {
  return `
    <div class="cer-initiate">

      <!-- Info callout -->
      <div class="cer-initiate-callout">
        <div class="cer-initiate-callout-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="#3B82F6" stroke-width="1.5"/>
            <path d="M8 7v4M8 5v.6" stroke="#3B82F6" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="cer-initiate-callout-text">
          Dual-officer approval is required before entropy generation can begin.
          Two independent officers will log in sequentially and each authorise this request.
          Your identity is recorded from your current session.
        </p>
      </div>

      <!-- Process steps (mini) -->
      <div class="cer-initiate-steps">
        <div class="cer-initiate-step">
          <div class="cer-initiate-step-num">1</div>
          <span>You initiate &amp; state a reason</span>
        </div>
        <div class="cer-initiate-step-arrow">→</div>
        <div class="cer-initiate-step">
          <div class="cer-initiate-step-num">2</div>
          <span>Officer 1 logs in &amp; approves</span>
        </div>
        <div class="cer-initiate-step-arrow">→</div>
        <div class="cer-initiate-step">
          <div class="cer-initiate-step-num">3</div>
          <span>Officer 2 logs in &amp; approves</span>
        </div>
      </div>

      <!-- Reason field -->
      <div class="cer-form-group cer-initiate-reason-group">
        <label class="cer-form-label" for="initiate-reason">
          Reason for Ceremony
          <span class="cer-form-required">*</span>
        </label>
        <input class="cer-connect-input" id="initiate-reason" type="text"
          placeholder="e.g. Initial HSM setup for production deployment"
          value="${state.approvalReason}" autocomplete="off">
        <div class="cer-form-hint">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/></svg>
          Logged to the audit trail and shown to approving officers
        </div>
      </div>

    </div>`;
}

function renderApprove() {
  const count = state.approvalCount;
  const isApproved = state.approvalStatus === 'approved';

  // Quorum progress track
  const quorumTrack = `
    <div class="cer-quorum-track">
      ${[0, 1].map(i => {
        const done   = count > i;
        const active = count === i && !isApproved;
        return `
          <div class="cer-quorum-node ${done ? 'done' : active ? 'active' : 'wait'}">
            <div class="cer-quorum-dot">
              ${done
                ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                : `<span>${i + 1}</span>`}
            </div>
            <span class="cer-quorum-label">Officer ${i + 1}</span>
          </div>
          ${i < 1 ? `<div class="cer-quorum-line ${count > 0 ? 'done' : ''}"></div>` : ''}`;
      }).join('')}
      <div class="cer-quorum-line ${isApproved ? 'done' : ''}"></div>
      <div class="cer-quorum-node ${isApproved ? 'done' : 'wait'}">
        <div class="cer-quorum-dot">
          ${isApproved
            ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            : `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2v3l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.2"/></svg>`}
        </div>
        <span class="cer-quorum-label">Ready</span>
      </div>
    </div>`;

  // Compact meta row
  const metaRow = state.approvalId ? `
    <div class="cer-approve-meta-row">
      <div class="cer-meta-chip">
        <span class="cer-meta-chip-label">REQUEST</span>
        <span class="cer-meta-chip-value mono">${state.approvalId.slice(0, 13)}…</span>
      </div>
      <div class="cer-meta-chip">
        <span class="cer-meta-chip-label">INITIATED BY</span>
        <span class="cer-meta-chip-value">${state.approvalRequestedBy || '—'}</span>
      </div>
    </div>` : '';

  if (isApproved) {
    return `
      <div class="cer-approve">
        ${quorumTrack}
        ${metaRow}
        <div class="cer-approve-success-card">
          <div class="cer-approve-success-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="12" fill="rgba(16,185,129,0.12)" stroke="#10B981" stroke-width="1.5"/>
              <path d="M8 14l4 4 8-8" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cer-approve-success-title">${state.demoMode ? 'Quorum bypassed for demo' : 'Both officers have approved'}</div>
          <div class="cer-approve-success-sub">${state.demoMode ? '1-of-1 Shamir · single-operator demo mode' : 'Entropy generation is now authorised'}</div>
        </div>
      </div>`;
  }

  return `
    <div class="cer-approve">
      ${quorumTrack}
      ${metaRow}

      <!-- Login card -->
      <div class="cer-approve-login-card">
        <div class="cer-approve-login-header">
          <div class="cer-approve-login-num">${count + 1}</div>
          <div>
            <div class="cer-approve-login-title">Officer ${count + 1} — Authenticate to approve</div>
            <div class="cer-approve-login-sub">Log in with officer or admin credentials</div>
          </div>
        </div>

        <div class="cer-approve-login-fields">
          <input class="cer-connect-input" id="officer-username" type="text"
            placeholder="Username"
            value="${state.officerLoginUsername}" autocomplete="username" autocorrect="off" autocapitalize="off">
          <input class="cer-connect-input" id="officer-password" type="password"
            placeholder="Password" autocomplete="current-password">

          ${state.officerLoginError ? `
            <div class="cer-connect-error">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
              <span>${state.officerLoginError}</span>
            </div>` : ''}

          <button class="btn btn-primary cer-approve-submit-btn" id="officer-login-approve-btn" ${state.officerLoginLoading ? 'disabled' : ''}>
            ${state.officerLoginLoading
              ? `<div class="cer-spinner-sm" style="width:14px;height:14px;border-width:2px"></div> Verifying…`
              : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 6V4a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                 Approve as Officer`}
          </button>
        </div>
      </div>

      <!-- Bypass quorum -->
      <div class="cer-bypass-section">
        <div class="cer-bypass-divider"><span>or</span></div>
        <div class="cer-bypass-row">
          <div>
            <div style="font-size:12px;font-weight:500;color:var(--text-secondary)">Running a single-operator demo?</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Real HSM · real entropy · 1-of-1 Shamir</div>
          </div>
          <button class="btn cer-bypass-btn" id="bypass-quorum-btn">Bypass Quorum ›</button>
        </div>
      </div>
    </div>`;
}

function renderKeygen() {
  if (state.keygenDone) {
    return `
      <div class="cer-keygen">
        <div class="cer-keygen-success">
          <div class="cer-keygen-success-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="17" stroke="#22C55E" stroke-width="1.5" opacity="0.3"/>
              <circle cx="20" cy="20" r="17" stroke="#22C55E" stroke-width="1.5"/>
              <path d="M13 20l5 5 10-10" stroke="#22C55E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cer-keygen-success-title">Master Wrap Key Generated</div>
          <div class="cer-keygen-success-sub">Sealed inside the HSM. Never exposed in plaintext.</div>
          <div class="cer-keygen-key-info">
            <div class="cer-keygen-key-row">
              <span class="cer-keygen-key-dot" style="background:#22C55E"></span>
              <code class="cer-keygen-key-label-val">${state.wrapKeyLabel || 'blue:wrap:v1'}</code>
              <span class="cer-keygen-key-algo">AES-256 · CKA_EXTRACTABLE=false</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="cer-keygen">
      <div class="cer-keygen-callout">
        <div class="cer-keygen-callout-icon">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2a4 4 0 0 1 4 4v2H5V6a4 4 0 0 1 4-4z" stroke="#3B82F6" stroke-width="1.4"/>
            <rect x="3" y="8" width="12" height="8" rx="2" stroke="#3B82F6" stroke-width="1.4"/>
            <circle cx="9" cy="12" r="1.2" fill="#3B82F6"/>
          </svg>
        </div>
        <div>
          <div class="cer-keygen-callout-title">FIPS 140-3 Level 3 Key Generation</div>
          <div class="cer-keygen-callout-sub">
            The following key will be generated entirely inside the Luna HSM via
            <code>C_GenerateKey</code>. No key material will ever cross the HSM boundary.
            Wallet private keys will be wrapped with this key and stored in the database as
            AES-256 ciphertext — unwrapped into the HSM only during transaction signing.
          </div>
        </div>
      </div>

      <div class="cer-keygen-keys">
        <div class="cer-keygen-key-card">
          <div class="cer-keygen-key-card-header">
            <div class="cer-keygen-key-card-name">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5a2.5 2.5 0 0 1 2.5 2.5v1.5H4.5V4A2.5 2.5 0 0 1 7 1.5z" stroke="var(--blue-400)" stroke-width="1.2"/><rect x="2" y="5" width="10" height="7.5" rx="1.5" stroke="var(--blue-400)" stroke-width="1.2"/><circle cx="7" cy="8.5" r="1" fill="var(--blue-400)"/></svg>
              Master Wrap Key
            </div>
            <span class="cer-keygen-key-badge">blue:wrap:v1</span>
          </div>
          <div class="cer-keygen-key-attrs">
            <div class="cer-keygen-attr"><span class="cer-keygen-attr-k">Algorithm</span><span class="cer-keygen-attr-v">AES-256</span></div>
            <div class="cer-keygen-attr"><span class="cer-keygen-attr-k">CKA_SENSITIVE</span><span class="cer-keygen-attr-v emerald">true</span></div>
            <div class="cer-keygen-attr"><span class="cer-keygen-attr-k">CKA_EXTRACTABLE</span><span class="cer-keygen-attr-v red">false</span></div>
            <div class="cer-keygen-attr"><span class="cer-keygen-attr-k">CKA_WRAP</span><span class="cer-keygen-attr-v emerald">true</span></div>
            <div class="cer-keygen-attr"><span class="cer-keygen-attr-k">CKA_UNWRAP</span><span class="cer-keygen-attr-v emerald">true</span></div>
            <div class="cer-keygen-attr"><span class="cer-keygen-attr-k">CKA_TOKEN</span><span class="cer-keygen-attr-v emerald">true — permanent</span></div>
          </div>
        </div>
      </div>

      ${state.keygenError ? `
        <div class="cer-connect-error">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
          <span>${state.keygenError}</span>
        </div>` : ''}

      <button class="btn btn-primary cer-keygen-btn" id="keygen-btn"
        ${state.keygenLoading ? 'disabled' : ''}>
        ${state.keygenLoading
          ? `<div class="cer-spinner-sm" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div>
             <span>Generating inside HSM…</span>`
          : `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5a3 3 0 0 1 3 3V6H4.5V4.5a3 3 0 0 1 3-3z" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="6" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="7.5" cy="9.5" r="1.2" fill="currentColor"/></svg>
             <span>Generate Master Keys on HSM</span>`}
      </button>
    </div>`;
}

function renderEntropy() {
  if (state.entropyDone && state.entropyHex) {
    const preview = state.entropyHex.match(/.{1,8}/g).slice(0, 8).join(' ');
    return `
      <div class="cer-entropy">
        <div class="cer-entropy-vis">
          <div class="cer-entropy-ring">
            <svg viewBox="0 0 120 120" class="cer-ring-svg">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--bg-card)" stroke-width="8"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke="#22C55E" stroke-width="8"
                stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="0"
                style="transform:rotate(-90deg);transform-origin:center"/>
            </svg>
            <div class="cer-ring-center">
              <div class="cer-ring-pct" style="color:var(--emerald)">100%</div>
              <div class="cer-ring-label">entropy</div>
            </div>
          </div>
        </div>

        <div class="cer-entropy-log">
          <div class="cer-log-header">
            <span class="cer-log-dot" style="background:var(--emerald)"></span>
            C_GenerateRandom · 256 bits · FIPS 186-4 DRBG
          </div>
          <div class="cer-log-lines">
            ${state.logLines.map(l => `
              <div class="cer-log-line cer-log-line-labeled">
                <span class="cer-log-byte-range">${l.label}</span>
                <span>${l.value}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="cer-entropy-meta">
          <div class="cer-meta-item">
            <div class="cer-meta-label">Source</div>
            <div class="cer-meta-value">Luna HSM · TRNG</div>
          </div>
          <div class="cer-meta-item">
            <div class="cer-meta-label">Entropy</div>
            <div class="cer-meta-value">256 bits</div>
          </div>
          <div class="cer-meta-item">
            <div class="cer-meta-label">Shares</div>
            <div class="cer-meta-value">${state.sharesTotal} (threshold: ${state.sharesThreshold})${state.demoMode ? ' · demo' : ''}</div>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="cer-entropy">
      <div class="cer-entropy-vis">
        <div class="cer-entropy-ring">
          <svg viewBox="0 0 120 120" class="cer-ring-svg">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--bg-card)" stroke-width="8"/>
            <circle cx="60" cy="60" r="52" fill="none" stroke="#2563EB" stroke-width="8"
              stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7"
              id="entropy-arc" style="transition:stroke-dashoffset 0.2s ease;transform:rotate(-90deg);transform-origin:center"/>
          </svg>
          <div class="cer-ring-center">
            <div class="cer-ring-pct" id="entropy-pct">0%</div>
            <div class="cer-ring-label">entropy</div>
          </div>
        </div>
      </div>

      <div class="cer-entropy-log">
        <div class="cer-log-header">
          <span class="cer-log-dot"></span>
          Calling HSM C_GenerateRandom…
        </div>
        <div class="cer-log-lines" id="entropy-lines">
          ${state.entropyError
            ? `<div class="cer-log-line" style="color:var(--red)">${state.entropyError}</div>`
            : ''}
        </div>
      </div>

      <div class="cer-entropy-meta">
        <div class="cer-meta-item">
          <div class="cer-meta-label">Source</div>
          <div class="cer-meta-value">Luna HSM · TRNG</div>
        </div>
        <div class="cer-meta-item">
          <div class="cer-meta-label">Algorithm</div>
          <div class="cer-meta-value">FIPS 186-4 DRBG</div>
        </div>
        <div class="cer-meta-item">
          <div class="cer-meta-label">Output</div>
          <div class="cer-meta-value">256 bits → 5 shares</div>
        </div>
      </div>
    </div>`;
}

function formatShareHex(hex) {
  // Split into groups of 8 chars, then 4 groups per line
  const groups = hex.match(/.{1,8}/g) || [];
  const lines = [];
  for (let i = 0; i < groups.length; i += 4) {
    lines.push(groups.slice(i, i + 4).join(' '));
  }
  return lines.join('\n');
}

function renderShares() {
  const idx = state.currentShareIndex;
  const custodianNum = idx + 1;
  const total = state.sharesTotal;
  const allDone = state.sharesAcknowledged >= total;

  const pipTrack = `
    <div class="cer-share-pip-track">
      ${Array.from({length: total}, (_, i) => {
        const done = i < state.sharesAcknowledged;
        const active = !allDone && i === idx;
        return `
          <div class="cer-share-pip-wrap">
            <div class="cer-share-pip ${done ? 'done' : active ? 'active' : 'wait'}">
              ${done
                ? `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 5.5l2.5 2.5 4-4" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                : `<span>${i + 1}</span>`}
            </div>
            <div class="cer-share-pip-label">${done ? 'Done' : active ? 'Now' : `Share ${i + 1}`}</div>
          </div>
          ${i < total - 1 ? `<div class="cer-share-pip-line ${done ? 'done' : ''}"></div>` : ''}`;
      }).join('')}
    </div>`;

  if (allDone) {
    return `
      <div class="cer-shares">
        ${pipTrack}
        <div class="cer-share-all-done">
          <div class="cer-share-done-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="#22C55E" stroke-width="1.5" opacity="0.3"/>
              <circle cx="16" cy="16" r="14" stroke="#22C55E" stroke-width="1.5"/>
              <path d="M10 16l4 4 8-8" stroke="#22C55E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cer-share-done-title">All ${total} share${total > 1 ? 's' : ''} distributed</div>
          <div class="cer-share-done-sub">Each custodian has recorded their share. Click Continue to seal the master key into the HSM.</div>
        </div>
        <div class="cer-share-security-note">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5Z" stroke="#F59E0B" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 5.5v3M7 10v.5" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
          ${total > 1 ? `Shamir ${total > 1 ? `${state.sharesThreshold}-of-${total}` : '1-of-1'}: any ${state.sharesThreshold} of these ${total} shares can reconstruct the master key.` : 'Keep your share in a secure, offline location.'}
          Never store all shares in the same location.
        </div>
      </div>`;
  }

  return `
    <div class="cer-shares">
      ${pipTrack}

      <div class="cer-share-card">
        <div class="cer-share-card-header">
          <div class="cer-share-card-badge">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="10" height="10" rx="2" stroke="#F59E0B" stroke-width="1.2"/><path d="M4.5 6.5h4M6.5 4.5v4" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
            Share ${custodianNum} of ${total}
          </div>
          <div class="cer-share-card-title">${total > 1 ? `Custodian ${custodianNum}` : 'Your Key Share'}</div>
          <div class="cer-share-card-sub">
            ${total > 1
              ? 'Hand this screen to Custodian ' + custodianNum + '. This share will not be displayed again after confirmation.'
              : 'Record this share securely. You will enter it in the next step to seal the master key.'}
          </div>
        </div>

        ${state.currentShareLoading ? `
          <div class="cer-share-loading">
            <div class="cer-spinner-sm"></div>
            <span>Retrieving share from HSM…</span>
          </div>
        ` : state.currentShareError ? `
          <div class="cer-connect-error">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
            <span>${state.currentShareError}</span>
          </div>
        ` : state.currentShare ? `
          <div class="cer-share-hex-block">
            <div class="cer-share-hex-header">
              <span class="cer-share-hex-label">Key Share — Confidential</span>
              <button class="cer-share-copy-btn" id="copy-share-btn" type="button">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 8V2h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Copy
              </button>
            </div>
            <pre class="cer-share-hex" id="share-hex-display">${formatShareHex(state.currentShare)}</pre>
          </div>

          <div class="cer-share-confirm-section">
            <label class="cer-form-label" for="custodian-name">
              Custodian ${custodianNum} — type your name to confirm you've recorded this share
            </label>
            <input class="cer-connect-input" id="custodian-name" type="text"
              placeholder="Full name"
              value="${state.custodianNameInput || ''}" autocomplete="off">
            <button class="btn btn-primary cer-share-ack-btn" id="ack-share-btn">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              I have securely recorded this share
            </button>
          </div>
        ` : ''}
      </div>

      <div class="cer-share-security-note">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5Z" stroke="#F59E0B" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 5.5v3M7 10v.5" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
        ${total > 1
          ? `Shamir ${state.sharesThreshold}-of-${total}: any ${state.sharesThreshold} of these ${total} shares can reconstruct the master key. Keep them separate and secure.`
          : 'Keep this share in a secure, offline location. Do not store it digitally.'}
      </div>
    </div>`;
}

function renderReconstruct() {
  const inputCount = state.sharesThreshold; // 1 in demo, 3 in production
  const totalShares = state.sharesTotal;

  if (state.reconstructDone) {
    return `
      <div class="cer-reconstruct">
        <div class="cer-reconstruct-sealed">
          <div class="cer-reconstruct-sealed-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="#22C55E" stroke-width="1.5" opacity="0.25"/>
              <circle cx="24" cy="24" r="20" stroke="#22C55E" stroke-width="1.5"/>
              <path d="M15 24l6 6 12-12" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cer-reconstruct-sealed-title">Master Key Sealed</div>
          <div class="cer-reconstruct-sealed-sub">Non-extractable · Stored in HSM</div>
          <div class="cer-reconstruct-sealed-id">
            <span class="cer-reconstruct-sealed-id-label">Key ID</span>
            <code class="cer-reconstruct-sealed-id-val">${state.masterKeyId || '—'}</code>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="cer-reconstruct">
      <div class="cer-reconstruct-callout">
        <div class="cer-reconstruct-callout-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a3 3 0 0 1 3 3v2H5V5a3 3 0 0 1 3-3z" stroke="#3B82F6" stroke-width="1.3"/><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="#3B82F6" stroke-width="1.3"/><circle cx="8" cy="10.5" r="1" fill="#3B82F6"/></svg>
        </div>
        <div class="cer-reconstruct-callout-text">
          <div class="cer-reconstruct-callout-title">
            ${inputCount === 1 ? 'Enter your key share to seal the master key' : `Enter any ${inputCount} of ${totalShares} shares to reconstruct`}
          </div>
          <div class="cer-reconstruct-callout-sub">
            ${inputCount === 1
              ? 'The share will be used to derive the BIP-32 master key, then immediately sealed into the HSM as non-extractable. The share is cleared from memory afterwards.'
              : `The ${inputCount} shares will reconstruct the master entropy via Shamir's Secret Sharing, derive the BIP-32 master key, and seal it into the HSM. All shares are cleared from memory after sealing.`}
          </div>
        </div>
      </div>

      <div class="cer-reconstruct-inputs">
        ${Array.from({length: inputCount}, (_, i) => `
          <div class="cer-reconstruct-share-field">
            <div class="cer-reconstruct-share-label">
              <div class="cer-reconstruct-share-num">${i + 1}</div>
              <label class="cer-form-label" for="reconstruct-share-${i}">
                ${inputCount > 1 ? `Share ${i + 1}` : 'Key Share'}
              </label>
            </div>
            <textarea class="cer-share-textarea" id="reconstruct-share-${i}"
              rows="4" placeholder="Paste hex share here — spaces and line breaks are fine…"
              spellcheck="false" autocomplete="off">${state.reconstructShares[i] || ''}</textarea>
          </div>
        `).join('')}
      </div>

      ${state.reconstructError ? `
        <div class="cer-connect-error">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
          <span>${state.reconstructError}</span>
        </div>` : ''}

      <button class="btn btn-primary cer-reconstruct-seal-btn" id="reconstruct-btn"
        ${state.reconstructLoading ? 'disabled' : ''}>
        ${state.reconstructLoading
          ? `<div class="cer-spinner-sm" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.3);border-top-color:white"></div><span>Sealing into HSM…</span>`
          : `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 2a3 3 0 0 1 3 3v1.5H4.5V5a3 3 0 0 1 3-3z" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="6.5" width="10" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="7.5" cy="9.5" r="1" fill="currentColor"/></svg><span>Seal into HSM</span>`}
      </button>

      <div class="cer-share-security-note">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5Z" stroke="#F59E0B" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 5.5v3M7 10v.5" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
        Once sealed, the master private key is non-extractable and cannot be exported from the HSM. Shares are wiped from memory immediately after sealing.
      </div>
    </div>`;
}

function renderAccounts() {
  return `
    <div class="cer-accounts">
      <p class="cer-accounts-desc">
        Select the coin types to register under this HSM. Each activated coin type
        enables BIP-44 derivation: <code>m/44'/coin_type'/0'/0/n</code>
      </p>

      <div class="cer-coin-grid" id="coin-grid">
        ${BIP44_COINS.map(c => `
          <label class="cer-coin-card ${state.selectedCoins.has(c.symbol) ? 'selected' : ''}" data-coin="${c.symbol}">
            <input type="checkbox" class="cer-coin-check" value="${c.symbol}" ${state.selectedCoins.has(c.symbol) ? 'checked' : ''}>
            <div class="cer-coin-top">
              <div class="cer-coin-symbol">${c.symbol}</div>
              <div class="cer-coin-check-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>
            <div class="cer-coin-name">${c.coin}</div>
            <div class="cer-coin-path">coin_type = ${c.type}</div>
          </label>
        `).join('')}
      </div>

      <div class="cer-path-preview">
        <div class="cer-path-label">Example derivation path</div>
        <code class="cer-path-code" id="path-preview">m / 44' / 0' / 0' / 0 / 0</code>
        <div class="cer-path-legend">
          <span><em>purpose</em> / <em>coin_type</em> / <em>account</em> / <em>change</em> / <em>index</em></span>
        </div>
      </div>

      <div class="cer-accounts-note">
        Each wallet you create will occupy one <em>index</em> leaf node. Child keys are derived
        in HSM and wrapped with AES-256 before storage — enabling millions of wallets without
        exhausting HSM key slots.
      </div>
    </div>`;
}

function renderComplete() {
  const coins = [...state.selectedCoins];
  return `
    <div class="cer-complete">
      <div class="cer-complete-icon">
        <div class="cer-complete-ring">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="24" stroke="#22C55E" stroke-width="2" opacity="0.3"/>
            <circle cx="28" cy="28" r="24" stroke="#22C55E" stroke-width="2"
              stroke-dasharray="150.8" stroke-dashoffset="0" class="cer-complete-circle"/>
            <path d="M18 28l7 7 14-14" stroke="#22C55E" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" class="cer-complete-check"/>
          </svg>
        </div>
      </div>

      <h2 class="cer-complete-title">HSM Initialized</h2>
      <p class="cer-complete-sub">Your Luna HSM is ready for production use</p>

      <div class="cer-complete-summary">
        <div class="cer-summary-row">
          <span class="cer-summary-label">Master Key ID</span>
          <span class="cer-summary-val" style="font-family:monospace;font-size:11px">
            ${state.masterKeyId || '—'}
          </span>
        </div>
        <div class="cer-summary-row">
          <span class="cer-summary-label">Master Key</span>
          <span class="cer-summary-val">
            <span class="cer-dot-green"></span>
            Stored in HSM · Non-extractable
          </span>
        </div>
        <div class="cer-summary-row">
          <span class="cer-summary-label">Key Ceremony</span>
          <span class="cer-summary-val">
            <span class="cer-dot-green"></span>
            Shamir 3-of-5 · Dual-officer approved
          </span>
        </div>
        <div class="cer-summary-row">
          <span class="cer-summary-label">Coin Types</span>
          <span class="cer-summary-val">${coins.join(', ')}</span>
        </div>
        <div class="cer-summary-row">
          <span class="cer-summary-label">Completed</span>
          <span class="cer-summary-val">${state.completedAt ? new Date(state.completedAt).toLocaleString() : '—'}</span>
        </div>
        <div class="cer-summary-row">
          <span class="cer-summary-label">Compliance</span>
          <span class="cer-summary-val">FIPS 140-3 Level 3 · PKCS#11</span>
        </div>
      </div>

      <div class="cer-complete-actions">
        <a href="#/vaults" class="btn btn-primary">Create First Vault</a>
        <a href="#/" class="btn btn-ghost">Go to Dashboard</a>
      </div>
    </div>`;
}

// ─── Main render ─────────────────────────────────────────────────────────────

export function renderCeremony() {
  const step = STEPS[state.step];
  const isFirst = state.step === 0;
  const isLast  = state.step === STEPS.length - 1;

  return `
    <div class="cer-root">

      ${state.demoMode ? `
        <div class="cer-demo-step-indicator">
          <span class="cer-demo-badge">🎬 DEMO MODE</span>
          <span style="font-size:12px;color:var(--text-tertiary)">Single-operator · 1-of-1 Shamir</span>
        </div>` : ''}

      <div class="cer-stepper">
        ${STEPS.map((s, i) => `
          <div class="cer-step-dot ${i < state.step ? 'done' : i === state.step ? 'active' : ''}">
            ${i < state.step
              ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
              : `<span>${i + 1}</span>`}
          </div>
          ${i < STEPS.length - 1 ? `<div class="cer-step-line ${i < state.step ? 'done' : ''}"></div>` : ''}
        `).join('')}
      </div>

      <div class="cer-card" id="cer-card">
        <div class="cer-card-head">
          <div class="cer-step-label">Step ${state.step + 1} of ${STEPS.length}</div>
          <h1 class="cer-card-title">${step.title}</h1>
          <p class="cer-card-subtitle">${step.subtitle}</p>
        </div>

        <div class="cer-card-body" id="cer-body">
          ${renderStep()}
        </div>

        <div class="cer-card-foot">
          ${!isFirst && !isLast
            ? `<button class="btn btn-ghost" id="cer-back">Back</button>`
            : '<div></div>'}
          ${!isLast
            ? `<button class="btn btn-primary" id="cer-next" ${nextDisabled() ? 'disabled' : ''}>
                ${state.step === STEPS.length - 2 ? 'Finish' : 'Continue'}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>`
            : ''}
        </div>
      </div>
    </div>`;
}

function renderStep() {
  switch (STEPS[state.step].id) {
    case 'connect':   return renderConnect();
    case 'initiate':  return renderInitiate();
    case 'approve':   return renderApprove();
    case 'keygen':    return renderKeygen();
    case 'accounts':  return renderAccounts();
    case 'complete':  return renderComplete();
    default: return '';
  }
}

function nextDisabled() {
  const id = STEPS[state.step].id;
  if (id === 'connect')  return !state.hsmConnected;
  if (id === 'initiate') return false;
  if (id === 'approve')  return state.approvalStatus !== 'approved';
  if (id === 'keygen')   return !state.keygenDone;
  return false;
}

// ─── Live API calls ───────────────────────────────────────────────────────────

async function startEntropyFromHsm() {
  state.entropyDone  = false;
  state.entropyError = null;
  state.logLines     = [];

  const arc = () => document.getElementById('entropy-arc');
  const pct = () => document.getElementById('entropy-pct');
  const lines = () => document.getElementById('entropy-lines');
  const nextBtn = () => document.getElementById('cer-next');

  let progress = 0;
  state.entropyInterval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 3 + 0.5, 90);
    const el = arc();
    const pe = pct();
    if (el) el.style.strokeDashoffset = 326.7 * (1 - progress / 100);
    if (pe) pe.textContent = Math.round(progress) + '%';

    const linesEl = lines();
    if (linesEl) {
      const hex = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
      ).join(' ');
      const line = document.createElement('div');
      line.className = 'cer-log-line';
      line.textContent = hex;
      if (linesEl.children.length >= 8) linesEl.removeChild(linesEl.firstChild);
      linesEl.appendChild(line);
    }
  }, 80);

  try {
    const result = await api.generateEntropy(state.demoMode);
    clearInterval(state.entropyInterval);

    state.entropyHex      = result.entropyHex;
    state.entropyDone     = true;
    state.sharesTotal     = result.sharesGenerated;
    state.sharesThreshold = result.sharesThreshold || (state.demoMode ? 1 : 3);

    state.logLines = [
      { label: 'bytes 01–16', value: result.entropyHex.slice(0, 32) },
      { label: 'bytes 17–32', value: result.entropyHex.slice(32, 64) },
    ];

    const arcEl = arc();
    if (arcEl) {
      arcEl.style.transition = 'stroke-dashoffset 0.3s ease, stroke 0.3s ease';
      arcEl.style.strokeDashoffset = '0';
      arcEl.style.stroke = '#22C55E';
    }
    const pctEl = pct();
    if (pctEl) { pctEl.textContent = '100%'; pctEl.style.color = 'var(--emerald)'; }

    const linesEl = lines();
    if (linesEl) {
      linesEl.innerHTML = '';
      state.logLines.forEach(({ label, value }) => {
        const line = document.createElement('div');
        line.className = 'cer-log-line cer-log-line-labeled';
        line.innerHTML = `<span class="cer-log-byte-range">${label}</span><span>${value}</span>`;
        linesEl.appendChild(line);
      });
    }

    const logHeader = document.querySelector('.cer-log-header');
    if (logHeader) {
      const scheme = state.demoMode
        ? `1-of-1 Shamir (demo)`
        : `${result.sharesGenerated} shares · threshold ${state.sharesThreshold}`;
      logHeader.innerHTML = `
        <span class="cer-log-dot" style="background:var(--emerald)"></span>
        C_GenerateRandom · 256 bits · real HSM entropy · ${scheme}`;
    }

    const nb = nextBtn();
    if (nb) nb.disabled = false;

    // Auto-advance to shares step after brief pause
    setTimeout(() => {
      // Load share 0 preemptively
      state.currentShareIndex = 0;
      state.sharesAcknowledged = 0;
      transition('next');
    }, 1500);

  } catch (err) {
    clearInterval(state.entropyInterval);
    // Format known PKCS#11 error codes into helpful messages
    let msg = err.message || 'HSM entropy generation failed';
    if (msg.includes('CKR_PIN_EXPIRED')) {
      msg = 'CKR_PIN_EXPIRED — The HSM partition PIN has expired. Go to Health → Change PIN to reset it directly from this dashboard, then retry.';
    } else if (msg.includes('CKR_USER_NOT_LOGGED_IN')) {
      msg = 'CKR_USER_NOT_LOGGED_IN — Authentication lost. Reconnect the HSM and retry.';
    }
    state.entropyError = msg;
    // Rebuild so the Continue button is correctly disabled
    rebuildCeremony();
  }
}

async function loadCurrentShare() {
  state.currentShareLoading = true;
  state.currentShareError = null;
  state.currentShare = null;
  state.custodianNameInput = '';
  rebuildCeremony();

  try {
    const result = await api.getShare(state.currentShareIndex);
    state.currentShare = result.shareHex;
    state.currentShareLoading = false;
    rebuildCeremony();
  } catch (err) {
    state.currentShareError = err.message || 'Failed to load share';
    state.currentShareLoading = false;
    rebuildCeremony();
  }
}

async function finishCeremony() {
  try {
    const result = await api.completeCeremony([...state.selectedCoins]);
    state.completedAt = result.completedAt;
  } catch (err) {
    console.error('Failed to complete ceremony:', err);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function transition(direction) {
  const card = document.getElementById('cer-card');
  if (!card) return;
  card.classList.add(direction === 'next' ? 'slide-out-left' : 'slide-out-right');
  setTimeout(() => {
    if (direction === 'next') state.step++;
    else state.step--;
    rebuildCeremony();
  }, 200);
}

function rebuildCeremony() {
  const root = document.querySelector('.cer-root');
  if (!root) return;

  const tmp = document.createElement('div');
  tmp.innerHTML = renderCeremony();
  root.replaceWith(tmp.firstElementChild);

  const card = document.getElementById('cer-card');
  if (card) {
    card.classList.add('slide-in');
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('slide-in')));
  }

  const newRoot = document.querySelector('.cer-root');
  if (newRoot) initCeremonyHandlers(newRoot);
}

function initCeremonyHandlers(root) {
  const nextBtn = root.querySelector('#cer-next');
  const backBtn = root.querySelector('#cer-back');
  const stepId  = STEPS[state.step].id;

  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      if (nextBtn.disabled) return;

      if (stepId === 'initiate') {
        const reason = document.getElementById('initiate-reason')?.value?.trim();
        if (!reason && !state.demoMode) {
          alert('Please enter a reason for the ceremony.');
          return;
        }
        state.approvalReason = reason || 'Investor Demo — Blue Wallets';
        nextBtn.disabled = true;
        nextBtn.textContent = 'Submitting\u2026';
        try {
          // Initiate is always real — approval handled at Step 3
          const initiated = await api.initiateCeremony({ reason: state.approvalReason });
          state.approvalId          = initiated.id;
          state.approvalStatus      = initiated.status;
          state.approvalCount       = initiated.approvals.length;
          state.approvalRequestedBy = initiated.requestedByDisplay || '';
        } catch (err) {
          nextBtn.disabled = false;
          nextBtn.textContent = 'Continue \u2192';
          alert('Failed to initiate ceremony: ' + (err.message || 'Unknown error'));
          return;
        }
      }

      if (stepId === 'accounts') {
        nextBtn.disabled = true;
        nextBtn.textContent = 'Saving…';
        await finishCeremony();
      }
      transition('next');
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => transition('back'));
  }

  // Step-specific setup
  if (stepId === 'connect')  attachConnectHandlers(root);
  if (stepId === 'approve')  attachApproveHandlers(root);
  if (stepId === 'keygen')   attachKeygenHandlers(root);
  if (stepId === 'accounts') attachAccountHandlers(root);
}

// ─── Connect handlers ─────────────────────────────────────────────────────────

async function handleHsmConnect() {
  const lib  = document.getElementById('hsm-lib')?.value?.trim();
  const slot = parseInt(document.getElementById('hsm-slot')?.value || '0', 10);
  const pin  = document.getElementById('hsm-pin')?.value;

  if (!lib || !pin) {
    state.hsmConnectError = 'Library path and PIN are required';
    state.hsmConnecting = false;
    rebuildCeremony();
    return;
  }

  state.hsmLibrary      = lib;
  state.hsmSlot         = slot;
  state.hsmConnecting   = true;
  state.hsmConnected    = false;
  state.hsmConnectError = null;
  state.hsmConnectStage = 0;
  rebuildCeremony();

  // Animate through stages while API call is in-flight
  const stageTimers = [
    setTimeout(() => { state.hsmConnectStage = 1; _patchConnectStage(); }, 250),
    setTimeout(() => { state.hsmConnectStage = 2; _patchConnectStage(); }, 600),
    setTimeout(() => { state.hsmConnectStage = 3; _patchConnectStage(); }, 1000),
  ];

  function _patchConnectStage() {
    // Lightweight DOM patch — no full rebuild needed
    const root = document.querySelector('.cer-root');
    if (root) {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderConnect();
      const existing = root.querySelector('.cer-connect');
      if (existing) existing.replaceWith(tmp.firstElementChild);
    }
  }

  try {
    const result = await api.connectHsm({ pkcs11Library: lib, slotIndex: slot, pin });
    stageTimers.forEach(clearTimeout);

    state.hsmConnectStage = 4;
    state.hsmConnected    = true;
    state.hsmConnecting   = false;
    state.hsmProvider     = result.provider;
    state.hsmTokenLabel   = result.tokenLabel || null;
    state.hsmConnectError = null;
    rebuildCeremony();

    // Fire confetti + brief electricity burst, then settle to static glow
    setTimeout(fireConfetti, 100);
    setTimeout(() => {
      const ring = document.getElementById('electric-ring');
      if (ring) {
        ring.classList.add('cer-electric-active');
        // Remove after burst — only cer-electric-done remains, spin stops
        setTimeout(() => ring.classList.remove('cer-electric-active'), 900);
      }
    }, 200);
  } catch (err) {
    stageTimers.forEach(clearTimeout);
    state.hsmConnected    = false;
    state.hsmConnecting   = false;
    state.hsmConnectStage = 0;
    state.hsmConnectError = err.message || 'Connection failed';
    rebuildCeremony();
  }
}

function attachConnectHandlers(root) {
  root.querySelectorAll('.cer-vendor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset;
      state.selectedPreset = key;
      state.hsmConnected = false;
      state.hsmConnectError = null;

      const preset = HSM_PRESETS[key];
      if (preset && Object.keys(preset.paths).length > 0) {
        const ua = navigator.userAgent.toLowerCase();
        const os = ua.includes('win') ? 'win' : ua.includes('mac') ? 'macos' : 'linux';
        state.hsmLibrary = preset.paths[os] || preset.paths.linux || '';
      } else {
        state.hsmLibrary = '';
      }
      rebuildCeremony();
    });
  });

  const connectBtn = root.querySelector('#hsm-connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', handleHsmConnect);
  }

  root.querySelectorAll('#hsm-lib, #hsm-pin, #hsm-slot').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleHsmConnect();
    });
  });
}

// ─── Initiate handlers ────────────────────────────────────────────────────────
// (submission is handled by the Continue button in initCeremonyHandlers)

// ─── Approve handlers ─────────────────────────────────────────────────────────

function attachApproveHandlers(root) {
  const approveBtn = root.querySelector('#officer-login-approve-btn');
  const usernameInput = root.querySelector('#officer-username');
  const passwordInput = root.querySelector('#officer-password');

  async function doOfficerApprove() {
    const username = document.getElementById('officer-username')?.value?.trim();
    const password = document.getElementById('officer-password')?.value;
    if (!username || !password) {
      state.officerLoginError = 'Username and password are required';
      rebuildCeremony();
      return;
    }

    state.officerLoginLoading = true;
    state.officerLoginError = null;
    state.officerLoginUsername = username;
    rebuildCeremony();

    // Save the admin's session token before officer logs in
    const adminToken = getSessionToken();

    try {
      // Step 1: log in as officer (this sets their token in api.js)
      const loginResult = await auth.login(username, password);

      // Step 2: check role
      if (loginResult.user.role !== 'officer' && loginResult.user.role !== 'admin') {
        await auth.logout();
        setSessionToken(adminToken);
        state.officerLoginLoading = false;
        state.officerLoginError = `Only officers can approve. Role: ${loginResult.user.role}`;
        rebuildCeremony();
        return;
      }

      // Step 3: submit approval (officer's token is active)
      const result = await api.approveCeremony({ requestId: state.approvalId });

      // Step 4: log out officer and restore admin token
      await auth.logout();
      setSessionToken(adminToken);

      state.approvalStatus = result.status;
      state.approvalCount = result.approvals.length;
      state.officerLoginUsername = '';
      state.officerLoginPassword = '';
      state.officerLoginLoading = false;
      state.officerLoginError = null;
      rebuildCeremony();
    } catch (err) {
      // On error: ensure admin token is restored
      await auth.logout().catch(() => {});
      setSessionToken(adminToken);
      state.officerLoginLoading = false;
      state.officerLoginError = err.message || 'Approval failed';
      rebuildCeremony();
    }
  }

  if (usernameInput) {
    usernameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('officer-password')?.focus();
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doOfficerApprove();
    });
  }

  if (approveBtn) {
    approveBtn.addEventListener('click', doOfficerApprove);
  }

  // Bypass Quorum button (demo mode)
  const bypassBtn = root.querySelector('#bypass-quorum-btn');
  if (bypassBtn) {
    bypassBtn.addEventListener('click', async () => {
      bypassBtn.disabled = true;
      bypassBtn.textContent = 'Bypassing…';
      state.demoMode = true;
      try {
        const approved = await api.demoApprove(state.approvalId);
        state.approvalStatus = approved.status;
        state.approvalCount  = approved.approvals.length;
      } catch (err) {
        state.demoMode = false;
        alert('Bypass failed: ' + (err.message || 'Unknown error'));
        bypassBtn.disabled = false;
        bypassBtn.textContent = 'Bypass Quorum ›';
        return;
      }
      rebuildCeremony();
    });
  }
}

// ─── Key generation handlers ──────────────────────────────────────────────────

function attachKeygenHandlers(root) {
  const btn = root.querySelector('#keygen-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    state.keygenLoading = true;
    state.keygenError   = null;
    rebuildCeremony();

    try {
      const result = await api.generateMasterKeys();
      state.keygenDone    = true;
      state.keygenLoading = false;
      state.wrapKeyLabel  = result.wrapKeyLabel || 'blue:wrap:v1';
      rebuildCeremony();

      // Auto-advance after a brief success display
      setTimeout(() => transition('next'), 1600);
    } catch (err) {
      let msg = err.message || 'Key generation failed';
      if (msg.includes('CKR_PIN_EXPIRED')) {
        msg = 'CKR_PIN_EXPIRED — HSM PIN has expired. Go to Health → Change PIN, then retry.';
      } else if (msg.includes('not approved')) {
        msg = 'Ceremony not approved. Complete officer approval first.';
      }
      state.keygenError   = msg;
      state.keygenLoading = false;
      rebuildCeremony();
    }
  });
}

// ─── Share handlers (legacy — kept for reference) ────────────────────────────

function attachShareHandlers(root) {
  const ackBtn = root.querySelector('#ack-share-btn');
  const nameInput = root.querySelector('#custodian-name');

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      state.custodianNameInput = nameInput.value;
    });
  }

  if (ackBtn) {
    ackBtn.addEventListener('click', async () => {
      const custodianName = document.getElementById('custodian-name')?.value?.trim();
      if (!custodianName) {
        alert('Please enter the custodian name to confirm.');
        return;
      }

      ackBtn.disabled = true;
      ackBtn.textContent = 'Recording…';

      try {
        await api.acknowledgeShare(state.currentShareIndex);
        state.sharesAcknowledged++;
        state.currentShareIndex++;
        state.currentShare = null;
        state.custodianNameInput = '';

        if (state.currentShareIndex < state.sharesTotal) {
          // Load next share
          await loadCurrentShare();
        } else {
          // All shares acknowledged
          rebuildCeremony();
        }
      } catch (err) {
        ackBtn.disabled = false;
        ackBtn.textContent = 'I have securely recorded this share';
        alert('Failed to acknowledge share: ' + (err.message || 'Unknown error'));
      }
    });
  }

  // Copy share button
  const copyBtn = root.querySelector('#copy-share-btn');
  if (copyBtn && state.currentShare) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(state.currentShare).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 8V2h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copy`;
        }, 2000);
      }).catch(() => {});
    });
  }

  // Load the current share if not already loaded
  if (!state.currentShare && !state.currentShareLoading && state.currentShareIndex < state.sharesTotal && state.sharesAcknowledged < state.sharesTotal) {
    loadCurrentShare();
  }
}

// ─── Reconstruct handlers ─────────────────────────────────────────────────────

function attachReconstructHandlers(root) {
  const inputCount = state.sharesThreshold; // 1 in demo, 3 in production

  // Sync textarea values to state on input
  Array.from({length: inputCount}, (_, i) => i).forEach(i => {
    const ta = root.querySelector(`#reconstruct-share-${i}`);
    if (ta) {
      ta.addEventListener('input', () => {
        state.reconstructShares[i] = ta.value.trim();
      });
    }
  });

  const sealBtn = root.querySelector('#reconstruct-btn');
  if (!sealBtn) return;

  sealBtn.addEventListener('click', async () => {
    // Read current textarea values — strip all whitespace (shares are formatted with spaces/newlines for display)
    const shares = Array.from({length: inputCount}, (_, i) => {
      const ta = document.getElementById(`reconstruct-share-${i}`);
      const raw = ta ? ta.value : (state.reconstructShares[i] || '');
      return raw.replace(/\s+/g, '');
    }).filter(s => s.length > 0);

    if (shares.length < inputCount) {
      state.reconstructError = inputCount === 1
        ? 'Please paste your key share.'
        : `All ${inputCount} share fields must be filled in.`;
      rebuildCeremony();
      return;
    }

    state.reconstructShares = shares;
    state.reconstructError = null;
    state.reconstructLoading = true;
    rebuildCeremony();

    try {
      const result = await api.reconstructAndSeal(shares);
      state.masterKeyId    = result.masterKeyId;
      state.publicKeyHex   = result.publicKeyHex;
      state.chainCodeHex   = result.chainCodeHex;
      state.derivationInfo = result.derivationInfo;
      state.reconstructDone = true;
      state.reconstructLoading = false;
      rebuildCeremony();

      // Auto-advance after brief pause
      setTimeout(() => transition('next'), 1500);
    } catch (err) {
      state.reconstructError = err.message || 'Reconstruction failed';
      state.reconstructLoading = false;
      rebuildCeremony();
    }
  });
}

// ─── Account handlers ─────────────────────────────────────────────────────────

function attachAccountHandlers(root) {
  root.querySelectorAll('.cer-coin-card').forEach(card => {
    card.addEventListener('click', () => {
      const coin = card.dataset.coin;
      const check = card.querySelector('input[type=checkbox]');
      if (state.selectedCoins.has(coin)) {
        state.selectedCoins.delete(coin);
        card.classList.remove('selected');
        if (check) check.checked = false;
      } else {
        state.selectedCoins.add(coin);
        card.classList.add('selected');
        if (check) check.checked = true;
      }
      updatePathPreview();
    });
  });
  updatePathPreview();
}

function updatePathPreview() {
  const preview = document.getElementById('path-preview');
  if (!preview) return;
  const first = [...state.selectedCoins][0];
  const coin = BIP44_COINS.find(c => c.symbol === first);
  if (coin) preview.textContent = `m / 44' / ${coin.type} / 0' / 0 / 0`;
}

// ─── Demo mode activation ─────────────────────────────────────────────────────

function activateDemoMode() {
  // Demo mode: everything is REAL (real HSM, real entropy, real keys)
  // The ONLY difference: single-person flow, 1 Shamir share instead of 5
  state.demoMode = true;
  rebuildCeremony();
}


export function initCeremony() {
  const root = document.querySelector('.cer-root');
  if (root) initCeremonyHandlers(root);
}
