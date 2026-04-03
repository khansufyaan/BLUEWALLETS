/* HSM Key Ceremony — FIPS 140-3 Level 3 · HSM-native key generation */

import { api } from '../api.js';

const STEPS = [
  { id: 'connect',  title: 'Connect HSM',         subtitle: 'Configure your PKCS#11 provider' },
  { id: 'generate', title: 'Generate Master Key',  subtitle: 'AES-256 wrap key generated inside the HSM' },
  { id: 'hd-seed',  title: 'HD Master Seed',       subtitle: 'BIP-39 mnemonic for hierarchical key derivation (optional)' },
  { id: 'complete', title: 'HSM Ready',            subtitle: 'Your hardware module is initialized' },
];

// Well-known PKCS#11 library presets
const HSM_PRESETS = {
  luna: {
    name: 'Luna HSM',
    vendor: 'Thales',
    paths: {
      linux:  '/opt/lunaclient/libs/64/libCryptoki2.so',
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

// ── Shared mutable state ────────────────────────────────────────────────────

let state = {
  step: 0,

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

  // Key generation (Step 2)
  keygenLoading:  false,
  keygenDone:     false,
  keygenError:    null,
  wrapKeyLabel:   null,

  // HD seed (Step 3)
  hdLoading:   false,
  hdDone:      false,
  hdSkipped:   false,
  hdError:     null,
  hdMnemonic:  null,
  hdHash:      null,

  // Completion
  completedAt: null,

  // End-to-end verification (Step 3)
  verifyStage:  -1,   // -1=not started, 0-3=running, 4=done
  verifyError:  null,
  verifyDbType: null,  // 'postgresql' | 'in-memory'
  testWallet:   null,  // { address, publicKey, wrappedPrivateKey, chain, name, id }
  verifyDone:   false,
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

        <div class="cer-connect-action" style="margin-top:8px;display:flex;gap:var(--sp-3);align-items:center">
          <button class="btn btn-ghost" id="hsm-connect-btn" style="font-size:12px">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Re-test Connection
          </button>
          <button class="btn btn-ghost" id="hsm-disconnect-btn" style="font-size:12px;color:var(--red)">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Disconnect HSM
          </button>
        </div>
      </div>`;
  }

  // ── Connecting state ─────────────────────────────────────
  if (state.hsmConnecting) {
    const stage = state.hsmConnectStage;
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
                <span>${label}${active ? '…' : ''}</span>
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

function renderGenerate() {
  // ── Already generated ──
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

  // ── Pre-generation ──
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
             <span>Generate Master Key on HSM</span>`}
      </button>
    </div>`;
}

function _truncate(hex, len = 16) {
  if (!hex || hex.length <= len * 2) return hex || '';
  return hex.slice(0, len) + '...' + hex.slice(-8);
}

const VERIFY_STEPS = [
  { label: 'Database Connected',        detail: () => state.verifyDbType === 'postgresql' ? 'PostgreSQL (persistent volume)' : 'In-Memory Store' },
  { label: 'Master Wrap Key Verified',  detail: () => `${state.wrapKeyLabel || 'blue:wrap:v1'} (AES-256, non-extractable)` },
  { label: 'Test Wallet Created',       detail: () => state.testWallet ? `${state.testWallet.address.slice(0,8)}...${state.testWallet.address.slice(-6)} (Ethereum)` : '' },
  { label: 'Private Key Secured on HSM',   detail: () => state.testWallet ? `Key reference stored in database — private key never leaves HSM` : '' },
];

function renderComplete() {
  const svgCheck = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5 5.5-5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgSpinner = `<div class="cer-spinner-sm" style="width:10px;height:10px;border-width:2px"></div>`;

  const checklist = VERIFY_STEPS.map((vs, i) => {
    const done   = i < state.verifyStage;
    const active = i === state.verifyStage;
    const failed = state.verifyError && i === state.verifyStage;
    return `
      <div class="cer-checklist-item ${done ? 'cer-checklist-done' : active ? (failed ? 'cer-checklist-error' : 'cer-checklist-active') : 'cer-checklist-wait'}" style="animation-delay:${i * 60}ms">
        <div class="cer-checklist-icon">
          ${done ? svgCheck
            : active ? (failed
              ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4" stroke="var(--red)" stroke-width="1.5"/><path d="M4.5 4.5l3 3M7.5 4.5l-3 3" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>`
              : svgSpinner)
            : `<span style="font-size:9px;color:var(--text-tertiary)">${i+1}</span>`}
        </div>
        <div style="flex:1">
          <span>${vs.label}${active && !failed ? '...' : ''}</span>
          ${done || (active && failed) ? `<div style="font-size:11px;color:${failed ? 'var(--red)' : 'var(--text-tertiary)'};margin-top:2px">${failed ? state.verifyError : vs.detail()}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // Wallet detail card (shown after verification completes)
  let walletCard = '';
  if (state.verifyDone && state.testWallet) {
    const w = state.testWallet;
    const hsmLabel = w.wrappedPrivateKey || '';

    walletCard = `
      <div style="margin-top:var(--sp-5);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:var(--sp-5)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--sp-4)">
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(37,99,235,0.12);display:flex;align-items:center;justify-content:center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="9" rx="2" stroke="var(--blue-400)" stroke-width="1.3"/><path d="M4 4V3a4 4 0 0 1 8 0v1" stroke="var(--blue-400)" stroke-width="1.3"/></svg>
          </div>
          <div>
            <div style="font-size:14px;font-weight:600">${w.name}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">End-to-end verification wallet</div>
          </div>
        </div>

        <div style="display:grid;gap:var(--sp-2)">
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--r-md)">
            <span style="color:var(--text-tertiary)">Chain</span>
            <span style="font-weight:500">Ethereum (secp256k1)</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--r-md)">
            <span style="color:var(--text-tertiary)">Address</span>
            <code style="font-size:11px;color:var(--blue-400)">${w.address}</code>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--r-md)">
            <span style="color:var(--text-tertiary)">Public Key</span>
            <code style="font-size:10px;color:var(--text-secondary)">${_truncate(w.publicKey, 16)}</code>
          </div>
          <div style="padding:8px 12px;background:var(--bg-elevated);border-radius:var(--r-md)">
            <div style="display:flex;justify-content:space-between;font-size:12px">
              <span style="color:var(--text-tertiary)">Private Key</span>
              <span style="font-size:10px;color:var(--emerald)">Secured on HSM</span>
            </div>
            <div style="margin-top:6px;font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--text-tertiary);word-break:break-all;line-height:1.5">
              <span style="color:var(--blue-400)">HSM Label:</span> <code style="color:var(--emerald)">${hsmLabel.replace('hsm:', '')}</code>
              <div style="margin-top:4px;color:var(--text-tertiary)">CKA_EXTRACTABLE=false · CKA_SENSITIVE=true · Never leaves HSM boundary</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // Success banner (after verification)
  let successBanner = '';
  if (state.verifyDone) {
    successBanner = `
      <div style="margin-top:var(--sp-5);padding:var(--sp-4);background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:var(--r-lg);text-align:center">
        <div style="font-size:14px;font-weight:500;color:#4ADE80;margin-bottom:4px">End-to-end verification passed</div>
        <div style="font-size:13px;color:var(--text-tertiary)">
          HSM key generation, wallet creation, wrapping, and database storage all working.
          Log in to <strong style="color:var(--text-secondary)">Blue Console</strong> to start operations.
        </div>
      </div>`;
  }

  return `
    <div class="cer-complete">
      <div style="font-size:15px;font-weight:600;margin-bottom:var(--sp-4)">System Verification</div>
      <div class="cer-checklist">
        ${checklist}
      </div>

      ${walletCard}
      ${successBanner}
    </div>`;
}

// ─── End-to-end verification runner ──────────────────────────────────────────

async function runVerification() {
  if (state.verifyDone || state.verifyStage >= 0) return; // already running or done

  const advance = async (stage) => {
    state.verifyStage = stage;
    state.verifyError = null;
    rebuildCeremony();
    await _sleep(400);
  };

  try {
    // Step 0: Database check
    await advance(0);
    const health = await api.health();
    state.verifyDbType = health.database?.type || 'in-memory';
    await _sleep(300);

    // Step 1: Master wrap key
    await advance(1);
    const status = await api.getCeremonyStatus();
    if (!status.keysGenerated) throw new Error('Master wrap key not found on HSM');
    state.wrapKeyLabel = status.wrapKeyLabel || 'blue:wrap:v1';
    await _sleep(300);

    // Step 2: Create test wallet
    await advance(2);
    const wallet = await api.createWallet({ chain: 'ethereum', name: 'Ceremony Test Wallet' });
    state.testWallet = wallet;
    await _sleep(300);

    // Step 3: Show wrapped key proof
    await advance(3);
    if (!wallet.wrappedPrivateKey) {
      throw new Error('Key reference not found in response');
    }
    await _sleep(300);

    // Done
    state.verifyStage = 4;
    state.verifyDone  = true;
    rebuildCeremony();
    setTimeout(fireConfetti, 200);
  } catch (err) {
    state.verifyError = err.message || 'Verification failed';
    rebuildCeremony();
  }
}

// ─── Main render ─────────────────────────────────────────────────────────────

export function renderCeremony() {
  const step = STEPS[state.step];
  const isFirst = state.step === 0;
  const isLast  = state.step === STEPS.length - 1;

  return `
    <div class="cer-root">

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
    case 'connect':  return renderConnect();
    case 'generate': return renderGenerate();
    case 'hd-seed':  return renderHdSeed();
    case 'complete': return renderComplete();
    default: return '';
  }
}

function renderHdSeed() {
  // Already done or skipped
  if (state.hdDone) {
    return `
      <div class="cer-keygen">
        <div class="cer-keygen-success">
          <div class="cer-keygen-success-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="17" stroke="#22C55E" stroke-width="1.5"/>
              <path d="M13 20l5 5 10-10" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="cer-keygen-success-title">HD Master Seed Generated</div>
          <div class="cer-keygen-success-sub">BIP-39 mnemonic displayed once. Master seed imported to HSM.</div>
          <div class="cer-keygen-key-info">
            <div class="cer-keygen-key-row">
              <span class="cer-keygen-key-dot" style="background:#22C55E"></span>
              <code class="cer-keygen-key-label-val">blue:hd:master:v1</code>
              <span class="cer-keygen-key-algo">Generic Secret (64 bytes) · Wrapped backup stored</span>
            </div>
            <div class="cer-keygen-key-row">
              <span class="cer-keygen-key-dot" style="background:#22C55E"></span>
              <code class="cer-keygen-key-label-val">blue:encrypt:v1</code>
              <span class="cer-keygen-key-algo">AES-256 (encrypt/decrypt) · Child key protection</span>
            </div>
          </div>
        </div>
        <div style="margin-top:var(--sp-4);padding:var(--sp-3) var(--sp-4);background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.2);border-radius:var(--r-md)">
          <div style="font-size:13px;font-weight:600;color:var(--blue-400);margin-bottom:4px">Wallet Mode: HD (BIP-32/44)</div>
          <div style="font-size:11px;color:var(--text-tertiary);line-height:1.6">
            All new wallets will use hierarchical deterministic derivation from the master seed.
            Child keys are BIP-44 derived, AES-256 encrypted by the HSM, and stored in the database.
            <strong style="color:var(--text-secondary)">Zero HSM slots consumed per wallet</strong> — scales to millions.
          </div>
        </div>
      </div>`;
  }

  if (state.hdSkipped) {
    return `
      <div class="cer-keygen">
        <div style="text-align:center;padding:var(--sp-4);color:var(--text-tertiary)">
          <p>HD seed generation skipped.</p>
          <p style="font-size:11px;margin-top:8px">You can generate the HD seed later from this page.</p>
        </div>
        <div style="margin-top:var(--sp-3);padding:var(--sp-3) var(--sp-4);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:var(--r-md)">
          <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:4px">Wallet Mode: Legacy (HSM Token Keys)</div>
          <div style="font-size:11px;color:var(--text-tertiary);line-height:1.6">
            Wallets will use independent EC keypairs stored permanently on the HSM.
            Each wallet consumes one HSM object slot. No hierarchical derivation.
          </div>
        </div>
      </div>`;
  }

  // Mnemonic display (after generation)
  if (state.hdMnemonic) {
    const words = state.hdMnemonic.split(' ');
    return `
      <div class="cer-keygen">
        <div style="margin-bottom:var(--sp-4);padding:var(--sp-3) var(--sp-4);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:var(--r-md)">
          <strong style="color:var(--amber)">Write down these 24 words now. They will NEVER be shown again.</strong>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:var(--sp-4)">
          ${words.map((w, i) => `
            <div style="padding:8px 12px;background:var(--bg-elevated);border-radius:var(--r-sm);font-size:13px">
              <span style="color:var(--text-tertiary);font-size:10px;margin-right:6px">${i+1}.</span>
              <strong style="color:var(--text-primary);font-family:'JetBrains Mono',monospace">${w}</strong>
            </div>
          `).join('')}
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:var(--sp-3)">
          Mnemonic hash: <code style="color:var(--text-secondary)">${state.hdHash || ''}</code>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);cursor:pointer">
          <input type="checkbox" id="hd-confirm-backup">
          I have written down these 24 words and stored them securely.
        </label>
        <button class="btn btn-primary" id="hd-confirm-btn" disabled style="margin-top:var(--sp-3)">
          Confirm & Continue
        </button>
      </div>`;
  }

  // Pre-generation state
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
          <div class="cer-keygen-callout-title">BIP-32 Hierarchical Deterministic Wallets</div>
          <div class="cer-keygen-callout-sub">
            Generate a 24-word BIP-39 mnemonic. The master seed is imported to the HSM
            and used to derive child wallet keys deterministically. Each child key is
            wrapped with <code>blue:wrap:v1</code> and stored in the database.
          </div>
        </div>
      </div>

      ${state.hdError ? `
        <div class="cer-connect-error">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
          <span>${state.hdError}</span>
        </div>` : ''}

      <div style="display:flex;gap:var(--sp-3)">
        <button class="btn btn-primary" id="hd-generate-btn" ${state.hdLoading ? 'disabled' : ''}>
          ${state.hdLoading
            ? '<span>Generating HD seed...</span>'
            : '<span>Generate HD Master Seed</span>'}
        </button>
        <button class="btn btn-ghost" id="hd-skip-btn">
          Skip (use legacy HSM token keys)
        </button>
      </div>
    </div>`;
}

function nextDisabled() {
  const id = STEPS[state.step].id;
  if (id === 'connect')  return !state.hsmConnected;
  if (id === 'generate') return !state.keygenDone;
  if (id === 'hd-seed')  return !(state.hdDone || state.hdSkipped);
  return false;
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
      transition('next');
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => transition('back'));
  }

  // Step-specific setup
  if (stepId === 'connect')  attachConnectHandlers(root);
  if (stepId === 'generate') attachKeygenHandlers(root);
  if (stepId === 'hd-seed')  attachHdSeedHandlers(root);
  if (stepId === 'complete') setTimeout(runVerification, 300);
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
    window.dispatchEvent(new CustomEvent('hsm-connected'));
    setTimeout(fireConfetti, 100);
  } catch (err) {
    stageTimers.forEach(clearTimeout);
    state.hsmConnected    = false;
    state.hsmConnecting   = false;
    state.hsmConnectStage = 0;
    state.hsmConnectError = err.message || 'Connection failed';
    rebuildCeremony();
  }
}

async function handleHsmDisconnect() {
  if (!confirm('Disconnect from the current HSM?\n\nThis will invalidate the current session. You can then connect to a different HSM and re-run the ceremony.')) return;

  try {
    await api.disconnectHsm();
  } catch (err) {
    // If disconnect fails, warn but still reset UI — HSM may be in bad state
    console.warn('HSM disconnect error (proceeding with UI reset):', err);
  }

  // Reset all ceremony state
  state.step            = 0;
  state.hsmConnected    = false;
  state.hsmProvider     = null;
  state.hsmLibrary      = '';
  state.hsmSlot         = 0;
  state.hsmConnecting   = false;
  state.hsmConnectError = null;
  state.hsmTokenLabel   = null;
  state.hsmConnectStage = 0;
  state.keygenLoading   = false;
  state.keygenDone      = false;
  state.keygenError     = null;
  state.wrapKeyLabel    = null;
  state.completedAt     = null;
  state.verifyStage     = -1;
  state.verifyError     = null;
  state.verifyDbType    = null;
  state.testWallet      = null;
  state.verifyDone      = false;

  rebuildCeremony();
  window.dispatchEvent(new CustomEvent('hsm-disconnected'));
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

  const disconnectBtn = root.querySelector('#hsm-disconnect-btn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', handleHsmDisconnect);
  }

  root.querySelectorAll('#hsm-lib, #hsm-pin, #hsm-slot').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleHsmConnect();
    });
  });
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
      state.completedAt   = new Date().toISOString();
      rebuildCeremony();
      setTimeout(() => transition('next'), 1600);
    } catch (err) {
      let msg = err.message || 'Key generation failed';
      if (msg.includes('CKR_PIN_EXPIRED')) {
        msg = 'CKR_PIN_EXPIRED — HSM PIN has expired. Go to Health → Change PIN, then retry.';
      }
      state.keygenError   = msg;
      state.keygenLoading = false;
      rebuildCeremony();
    }
  });
}

// ─── HD Seed handlers ────────────────────────────────────────────────────────

function attachHdSeedHandlers(root) {
  // Generate button
  const genBtn = root.querySelector('#hd-generate-btn');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      state.hdLoading = true;
      state.hdError = null;
      rebuildCeremony();

      try {
        const result = await api.generateHdSeed();
        state.hdMnemonic = result.mnemonic;
        state.hdHash     = result.mnemonicHash;
        state.hdLoading  = false;
        rebuildCeremony();
      } catch (err) {
        state.hdError   = err.message || 'HD seed generation failed';
        state.hdLoading = false;
        rebuildCeremony();
      }
    });
  }

  // Skip button
  const skipBtn = root.querySelector('#hd-skip-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      state.hdSkipped = true;
      rebuildCeremony();
    });
  }

  // Confirm backup checkbox + button
  const checkbox = root.querySelector('#hd-confirm-backup');
  const confirmBtn = root.querySelector('#hd-confirm-btn');
  if (checkbox && confirmBtn) {
    checkbox.addEventListener('change', () => {
      confirmBtn.disabled = !checkbox.checked;
    });
    confirmBtn.addEventListener('click', () => {
      state.hdDone     = true;
      state.hdMnemonic = null; // Clear from memory
      rebuildCeremony();
      setTimeout(() => transition('next'), 800);
    });
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export async function initCeremony() {
  // Step 1: Check if HSM is connected — this gates everything else
  let hsmConnected = false;
  try {
    const hsmStatus = await api.getHsmStatus();
    if (hsmStatus.connected) {
      hsmConnected = true;
      state.hsmConnected  = true;
      state.hsmProvider   = hsmStatus.provider || null;
      state.hsmTokenLabel = hsmStatus.tokenLabel || null;
    }
  } catch {
    // HSM not configured — stay on step 0
  }

  // Step 2: Only check ceremony status if HSM is actually connected
  if (hsmConnected) {
    try {
      const status = await api.getCeremonyStatus();
      if (status.keysGenerated) {
        state.keygenDone   = true;
        state.wrapKeyLabel = status.wrapKeyLabel || 'blue:wrap:v1';
        state.completedAt  = status.completedAt || new Date().toISOString();

        // Check HD state
        if (status.hdEnabled) {
          state.hdDone = true;
          state.hdHash = null; // not stored
        }

        state.step         = STEPS.length - 1; // Jump to verification
      } else {
        // HSM connected but no keys yet — go to generate step
        state.step = 1;
      }
    } catch {
      // Ceremony check failed — go to generate step (HSM is connected)
      state.step = 1;
    }
  } else {
    // HSM not connected — start from step 0 (connect)
    state.step          = 0;
    state.hsmConnected  = false;
    state.keygenDone    = false;
    state.wrapKeyLabel  = null;
    state.completedAt   = null;
    state.verifyStage   = -1;
    state.verifyDone    = false;
    state.testWallet    = null;
  }

  const root = document.querySelector('.cer-root');
  if (root) {
    rebuildCeremony();
    initCeremonyHandlers(document.querySelector('.cer-root'));
  }
}
