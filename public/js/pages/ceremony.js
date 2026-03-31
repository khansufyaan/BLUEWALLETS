/* HSM Key Ceremony — Shamir 3-of-5 + dual-control approval wizard */

import { api, auth, setSessionToken, getSessionToken } from '../api.js';

const STEPS = [
  { id: 'connect',     title: 'Connect HSM',          subtitle: 'Configure your PKCS#11 provider' },
  { id: 'initiate',   title: 'Initiate Ceremony',     subtitle: 'Request dual-officer approval to begin' },
  { id: 'approve',    title: 'Officer Approval',      subtitle: 'Two independent officers must authorise' },
  { id: 'entropy',    title: 'Generate Entropy',      subtitle: 'HSM hardware random number generation' },
  { id: 'shares',     title: 'Distribute Shares',     subtitle: 'Shamir 3-of-5 — each custodian records their share' },
  { id: 'reconstruct', title: 'Reconstruct & Seal',   subtitle: 'Enter 3 shares to derive and seal master key' },
  { id: 'accounts',   title: 'Account Structure',     subtitle: 'BIP-44 coin type configuration' },
  { id: 'complete',   title: 'HSM Ready',             subtitle: 'Your hardware module is initialized' },
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

  // HSM connect step
  hsmConnected: false,
  hsmProvider: null,
  hsmLibrary: '',
  hsmSlot: 0,
  hsmConnecting: false,
  hsmConnectError: null,
  hsmTokenLabel: null,
  selectedPreset: 'luna',

  // Approval state
  approvalId: null,
  approvalStatus: null,   // 'pending' | 'approved'
  approvalCount: 0,
  approvalRequestedBy: '',
  approvalReason: '',
  officerLoginUsername: '',
  officerLoginPassword: '',
  officerLoginError: null,
  officerLoginLoading: false,

  // Entropy state
  entropyHex: null,
  entropyDone: false,
  entropyError: null,
  entropyInterval: null,
  logLines: [],

  // Share distribution state
  currentShareIndex: 0,   // 0-4, which share is being shown
  currentShare: null,     // hex string of current share
  currentShareLoading: false,
  currentShareError: null,
  custodianNameInput: '',
  sharesAcknowledged: 0,

  // Reconstruction state
  reconstructShares: ['', '', ''],
  reconstructError: null,
  reconstructLoading: false,
  reconstructDone: false,

  // Master key data
  masterKeyId: null,
  publicKeyHex: null,
  chainCodeHex: null,
  derivationInfo: null,
  completedAt: null,

  // Accounts
  selectedCoins: new Set(['BTC', 'ETH', 'SOL']),
};

// ─── Step renderers ──────────────────────────────────────────────────────────

function renderConnect() {
  const preset = HSM_PRESETS[state.selectedPreset] || HSM_PRESETS.luna;
  const ua = navigator.userAgent.toLowerCase();
  const os = ua.includes('win') ? 'win' : ua.includes('mac') ? 'macos' : 'linux';
  const defaultLib = state.hsmLibrary || preset.paths[os] || preset.paths.linux || '';

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
        <button class="btn btn-primary" id="hsm-connect-btn" ${state.hsmConnecting ? 'disabled' : ''}>
          ${state.hsmConnecting
            ? `<div class="cer-spinner-sm" style="width:14px;height:14px;border-width:2px"></div> Connecting…`
            : state.hsmConnected
              ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg> Re-test Connection`
              : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Connect`}
        </button>

        ${state.hsmConnected ? `
          <div class="cer-connect-success">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#22C55E" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="#22C55E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div>
              <div class="cer-connect-success-title">Connected · ${state.hsmProvider || 'HSM'}</div>
              ${state.hsmTokenLabel ? `<div class="cer-connect-success-sub">Token: ${state.hsmTokenLabel}</div>` : ''}
            </div>
          </div>` : ''}

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
      <div class="cer-initiate-info">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#2563EB" stroke-width="1.5"/><path d="M10 9v5M10 7v.5" stroke="#2563EB" stroke-width="1.5" stroke-linecap="round"/></svg>
        <p>This ceremony requires dual-officer approval before entropy can be generated.
        Two independent officers must authorise this request. Your identity is taken from your current session.</p>
      </div>

      <div class="cer-form-group">
        <label class="cer-form-label" for="initiate-reason">Reason for Ceremony</label>
        <input class="cer-connect-input" id="initiate-reason" type="text"
          placeholder="e.g. Initial HSM setup for production deployment"
          value="${state.approvalReason}" autocomplete="off">
      </div>

    </div>`;
}

function renderApprove() {
  const count = state.approvalCount;
  const isApproved = state.approvalStatus === 'approved';

  return `
    <div class="cer-approve">
      <div class="cer-approval-badge-row">
        <div class="cer-approval-badge ${isApproved ? 'cer-approval-badge-done' : ''}">
          ${isApproved
            ? `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="#22C55E" stroke-width="1.5"/><path d="M5.5 9l2.5 2.5 5-5" stroke="#22C55E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
               <span style="color:var(--emerald)">Approval complete</span>`
            : `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="#F59E0B" stroke-width="1.5"/><path d="M9 6v4M9 11.5v.5" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/></svg>
               <span style="color:#F59E0B">${count} of 2 approvals received</span>`}
        </div>
      </div>

      ${state.approvalId ? `
        <div class="cer-approve-meta">
          <div class="cer-meta-item">
            <div class="cer-meta-label">Request ID</div>
            <div class="cer-meta-value" style="font-family:monospace;font-size:11px">${state.approvalId}</div>
          </div>
          <div class="cer-meta-item">
            <div class="cer-meta-label">Requested By</div>
            <div class="cer-meta-value">${state.approvalRequestedBy}</div>
          </div>
        </div>` : ''}

      ${!isApproved ? `
        <div class="cer-form-group" style="margin-top:20px">
          <label class="cer-form-label">Officer ${count + 1} &mdash; Please log in to approve</label>
          <input class="cer-connect-input" id="officer-username" type="text"
            placeholder="Username"
            value="${state.officerLoginUsername}" autocomplete="username" autocorrect="off" autocapitalize="off"
            style="margin-bottom:8px">
          <input class="cer-connect-input" id="officer-password" type="password"
            placeholder="Password"
            autocomplete="current-password">
          ${state.officerLoginError ? `
            <div class="cer-connect-error" style="margin-top:8px">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
              <span>${state.officerLoginError}</span>
            </div>` : ''}
        </div>
        <div class="cer-initiate-action">
          <button class="btn btn-primary" id="officer-login-approve-btn" ${state.officerLoginLoading ? 'disabled' : ''}>
            ${state.officerLoginLoading
              ? `<div class="cer-spinner-sm" style="width:14px;height:14px;border-width:2px"></div> Approving\u2026`
              : `Approve as Officer
                 <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`}
          </button>
        </div>` : `
        <div class="cer-connect-success" style="margin-top:20px">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#22C55E" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="#22C55E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div>
            <div class="cer-connect-success-title">Both officers have approved</div>
            <div class="cer-connect-success-sub">Click Continue to generate entropy</div>
          </div>
        </div>`}
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
            <div class="cer-meta-value">5 (threshold: 3)</div>
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
  const allDone = state.sharesAcknowledged >= 5;

  return `
    <div class="cer-shares">
      <div class="cer-shares-progress">
        ${[0,1,2,3,4].map(i => `
          <div class="cer-share-pip ${i < state.sharesAcknowledged ? 'done' : i === idx ? 'active' : ''}">
            ${i < state.sharesAcknowledged
              ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 4-4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
              : `<span>${i + 1}</span>`}
          </div>
        `).join('')}
      </div>

      ${allDone ? `
        <div class="cer-connect-success" style="margin:20px 0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#22C55E" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="#22C55E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div>
            <div class="cer-connect-success-title">All 5 shares distributed</div>
            <div class="cer-connect-success-sub">Click Continue to proceed to reconstruction</div>
          </div>
        </div>` : `
        <div class="cer-share-header">
          <div class="cer-share-title">Custodian ${custodianNum} of 5</div>
          <div class="cer-share-subtitle">
            This is share ${custodianNum}. It will not be shown again after acknowledgement.
          </div>
        </div>

        ${state.currentShareLoading ? `
          <div class="cer-share-loading">
            <div class="cer-spinner-sm"></div>
            <span>Loading share…</span>
          </div>` : state.currentShareError ? `
          <div class="cer-connect-error">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
            <span>${state.currentShareError}</span>
          </div>` : state.currentShare ? `
          <div class="cer-share-display">
            <div class="cer-share-label">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="1.5" stroke="#F59E0B" stroke-width="1.2"/><path d="M5 7h4M7 5v4" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
              Share ${custodianNum} — eyes only — do not photograph
            </div>
            <pre class="cer-share-hex">${formatShareHex(state.currentShare)}</pre>
          </div>

          <div class="cer-share-confirm-row">
            <div class="cer-form-group">
              <label class="cer-form-label" for="custodian-name">
                Custodian ${custodianNum} — enter your name to confirm you have recorded this share
              </label>
              <input class="cer-connect-input" id="custodian-name" type="text"
                placeholder="Your name"
                value="${state.custodianNameInput}" autocomplete="off">
            </div>
            <button class="btn btn-primary" id="ack-share-btn" style="margin-top:12px">
              I have securely recorded this share
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>` : ''}
      `}

      <div class="cer-share-warning">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5Z" stroke="#F59E0B" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 6v3M7 10.5v.5" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
        Shamir 3-of-5: any 3 of these 5 shares can reconstruct the master key. Keep them separate and secure.
      </div>
    </div>`;
}

function renderReconstruct() {
  return `
    <div class="cer-reconstruct">
      <div class="cer-reconstruct-desc">
        Enter any 3 of the 5 Shamir shares to reconstruct the entropy, derive the BIP-32 master key,
        and seal it into the HSM as non-extractable.
      </div>

      <div class="cer-reconstruct-inputs">
        ${[0, 1, 2].map(i => `
          <div class="cer-form-group">
            <label class="cer-form-label" for="reconstruct-share-${i}">Share ${i + 1}</label>
            <textarea class="cer-share-textarea" id="reconstruct-share-${i}"
              rows="3" placeholder="Paste hex share here…"
              spellcheck="false" autocomplete="off">${state.reconstructShares[i]}</textarea>
          </div>
        `).join('')}
      </div>

      ${state.reconstructError ? `
        <div class="cer-connect-error" style="margin-top:12px">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--red)" stroke-width="1.5"/><path d="M5 5l4 4M9 5l-4 4" stroke="var(--red)" stroke-width="1.2" stroke-linecap="round"/></svg>
          <span>${state.reconstructError}</span>
        </div>` : ''}

      ${state.reconstructDone ? `
        <div class="cer-connect-success" style="margin-top:12px">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#22C55E" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="#22C55E" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div>
            <div class="cer-connect-success-title">Master key sealed into HSM</div>
            <div class="cer-connect-success-sub">ID: ${state.masterKeyId || '—'}</div>
          </div>
        </div>` : ''}

      <div class="cer-reconstruct-action">
        <button class="btn btn-primary" id="reconstruct-btn"
          ${state.reconstructLoading || state.reconstructDone ? 'disabled' : ''}>
          ${state.reconstructLoading
            ? `<div class="cer-spinner-sm" style="width:14px;height:14px;border-width:2px"></div> Sealing into HSM…`
            : 'Seal into HSM'}
          ${!state.reconstructLoading ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2l2 5-9 5V7l7-5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>` : ''}
        </button>
      </div>

      <div class="cer-share-warning" style="margin-top:16px">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5Z" stroke="#F59E0B" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 6v3M7 10.5v.5" stroke="#F59E0B" stroke-width="1.2" stroke-linecap="round"/></svg>
        Once sealed, the master private key is non-extractable. Shares are cleared from memory after this step.
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
    case 'connect':     return renderConnect();
    case 'initiate':    return renderInitiate();
    case 'approve':     return renderApprove();
    case 'entropy':     return renderEntropy();
    case 'shares':      return renderShares();
    case 'reconstruct': return renderReconstruct();
    case 'accounts':    return renderAccounts();
    case 'complete':    return renderComplete();
    default: return '';
  }
}

function nextDisabled() {
  const id = STEPS[state.step].id;
  if (id === 'connect')     return !state.hsmConnected;
  if (id === 'initiate')    return false; // Continue button handles validation + submit
  if (id === 'approve')     return state.approvalStatus !== 'approved';
  if (id === 'entropy')     return !state.entropyDone;
  if (id === 'shares')      return state.sharesAcknowledged < 5;
  if (id === 'reconstruct') return !state.reconstructDone;
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
    const result = await api.generateEntropy();
    clearInterval(state.entropyInterval);

    state.entropyHex = result.entropyHex;
    state.entropyDone = true;

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
      logHeader.innerHTML = `
        <span class="cer-log-dot" style="background:var(--emerald)"></span>
        C_GenerateRandom · ${result.entropyHex.length * 4} bits · real HSM entropy → ${result.sharesGenerated} shares`;
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
    state.entropyError = err.message || 'HSM entropy generation failed';
    const linesEl = lines();
    if (linesEl) {
      const line = document.createElement('div');
      line.className = 'cer-log-line';
      line.style.color = 'var(--red)';
      line.textContent = 'ERROR: ' + state.entropyError;
      linesEl.appendChild(line);
    }
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
  clearInterval(state.entropyInterval);
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
  clearInterval(state.entropyInterval);
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
        if (!reason) {
          alert('Please enter a reason for the ceremony.');
          return;
        }
        state.approvalReason = reason;
        nextBtn.disabled = true;
        nextBtn.textContent = 'Submitting\u2026';
        try {
          const result = await api.initiateCeremony({ reason });
          state.approvalId = result.id;
          state.approvalStatus = result.status;
          state.approvalCount = result.approvals.length;
          state.approvalRequestedBy = result.requestedByDisplay || '';
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
  if (stepId === 'connect')     attachConnectHandlers(root);
  // initiate step: submission handled by Continue in nextBtn above
  if (stepId === 'approve')     attachApproveHandlers(root);
  if (stepId === 'entropy')     startEntropyFromHsm();
  if (stepId === 'shares')      attachShareHandlers(root);
  if (stepId === 'reconstruct') attachReconstructHandlers(root);
  if (stepId === 'accounts')    attachAccountHandlers(root);
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
  rebuildCeremony();

  try {
    const result = await api.connectHsm({ pkcs11Library: lib, slotIndex: slot, pin });
    state.hsmConnected    = true;
    state.hsmConnecting   = false;
    state.hsmProvider     = result.provider;
    state.hsmTokenLabel   = result.tokenLabel || null;
    state.hsmConnectError = null;
    rebuildCeremony();
  } catch (err) {
    state.hsmConnected    = false;
    state.hsmConnecting   = false;
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
}

// ─── Share handlers ───────────────────────────────────────────────────────────

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

        if (state.currentShareIndex < 5) {
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

  // Load the current share if not already loaded
  if (!state.currentShare && !state.currentShareLoading && state.currentShareIndex < 5 && state.sharesAcknowledged < 5) {
    loadCurrentShare();
  }
}

// ─── Reconstruct handlers ─────────────────────────────────────────────────────

function attachReconstructHandlers(root) {
  // Sync textarea values to state on input
  [0, 1, 2].forEach(i => {
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
    // Read current textarea values
    const shares = [0, 1, 2].map(i => {
      const ta = document.getElementById(`reconstruct-share-${i}`);
      return (ta ? ta.value.trim() : state.reconstructShares[i]);
    }).filter(s => s.length > 0);

    if (shares.length < 3) {
      state.reconstructError = 'All 3 share fields must be filled in.';
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

export function initCeremony() {
  const root = document.querySelector('.cer-root');
  if (root) initCeremonyHandlers(root);
}
