/**
 * Command Palette (⌘K / Ctrl+K)
 *
 * Spotlight-style search over all pages + common actions.
 * Fuzzy-matches by name and keywords. Keyboard-first navigation.
 */

const PAGES = [
  // OPERATE
  { hash: '#/',            label: 'Overview',         section: 'Operate', keywords: ['dashboard','home'], icon: '<rect x="2" y="2" width="6" height="6" rx="1"/><rect x="10" y="2" width="6" height="6" rx="1"/><rect x="2" y="10" width="6" height="6" rx="1"/><rect x="10" y="10" width="6" height="6" rx="1"/>' },
  { hash: '#/realtime',    label: 'Live Dashboard',   section: 'Operate', keywords: ['live','realtime','websocket','monitoring'], icon: '<circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2"/>' },
  { hash: '#/risk',        label: 'Risk Dashboard',   section: 'Operate', keywords: ['risk','alert','score','threat'], icon: '<path d="M9 2l7 13H2L9 2z"/><path d="M9 7v3M9 12v1"/>' },
  { hash: '#/agent',       label: 'AI Agent',         section: 'Operate', keywords: ['ai','chat','assistant','llm','ask','voice','beta'], icon: '<circle cx="9" cy="9" r="7"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="12" cy="7" r="1" fill="currentColor"/><path d="M6 11.5c1 1 2 1.5 3 1.5s2-.5 3-1.5"/>' },
  { hash: '#/vaults',      label: 'Vaults',           section: 'Operate', keywords: ['vault','safe','storage'], icon: '<rect x="2" y="4" width="14" height="11" rx="2"/><path d="M6 4V3a3 3 0 016 0v1"/><circle cx="9" cy="10" r="1.5"/>' },
  { hash: '#/wallets',     label: 'Wallets',          section: 'Operate', keywords: ['wallet','address','keys'], icon: '<rect x="1" y="4" width="16" height="11" rx="2"/><path d="M1 7h16"/>' },
  { hash: '#/multi-chain', label: 'Multi-Chain View', section: 'Operate', keywords: ['chain','ethereum','bitcoin','bsc','polygon'], icon: '<circle cx="5" cy="5" r="2"/><circle cx="13" cy="5" r="2"/><circle cx="9" cy="13" r="2"/>' },
  { hash: '#/balances',    label: 'On-Chain Balances',section: 'Operate', keywords: ['balance','onchain','live'], icon: '<rect x="2" y="4" width="14" height="11" rx="2"/><path d="M5 9h8"/>' },
  { hash: '#/gas-station', label: 'Gas Station',      section: 'Operate', keywords: ['gas','fee','priority'], icon: '<path d="M4 15V5a2 2 0 012-2h3a2 2 0 012 2v10"/><path d="M4 15h7"/>' },
  { hash: '#/transactions',label: 'Transactions',     section: 'Operate', keywords: ['transaction','tx','send','transfer','withdrawal'], icon: '<path d="M14 5l-4-3-4 3M6 13l4 3 4-3"/>' },
  { hash: '#/tx-builder',  label: 'TX Builder',       section: 'Operate', keywords: ['builder','wizard','new transfer'], icon: '<rect x="2" y="2" width="14" height="14" rx="2"/><path d="M6 9h6M9 6v6"/>' },
  { hash: '#/deposits',    label: 'Deposits',         section: 'Operate', keywords: ['deposit','incoming','received'], icon: '<path d="M10 3v7M6 7l4 4 4-4"/>' },
  { hash: '#/multisig',    label: 'Approvals',        section: 'Operate', keywords: ['approval','multisig','pending','sign'], icon: '<path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/><path d="M7 9l2 2 3-3"/>' },

  // CONTROL
  { hash: '#/policies',    label: 'Policies',         section: 'Control', keywords: ['policy','rule','limit','whitelist'], icon: '<path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/>' },
  { hash: '#/automations', label: 'Automations',      section: 'Control', keywords: ['automation','when','trigger','scheduled'], icon: '<path d="M2 5h5l2 3-2 3H2l2-3-2-3z"/><path d="M11 5h5l2 3-2 3h-5l2-3-2-3z"/>' },
  { hash: '#/compliance',  label: 'Compliance Screening', section: 'Control', keywords: ['compliance','trm','chainalysis','screening','sanctions'], icon: '<path d="M9 2l6 3v4c0 3.5-2.5 6.5-6 7.5C5.5 15.5 3 12.5 3 9V5l6-3z"/>' },
  { hash: '#/audit-log',   label: 'Audit Log',        section: 'Control', keywords: ['audit','log','history','events'], icon: '<path d="M4 2h7l4 4v10H4V2z"/>' },
  { hash: '#/roles',       label: 'Roles',            section: 'Control', keywords: ['role','admin','operator'], icon: '<circle cx="9" cy="6" r="3"/><path d="M3 16c0-3.3 2.7-6 6-6s6 2.7 6 6"/>' },
  { hash: '#/permissions', label: 'Permissions',      section: 'Control', keywords: ['permission','access','rbac'], icon: '<path d="M7 2h4v3H7z"/><path d="M3 7h12v9H3z"/>' },

  // SYSTEM
  { hash: '#/hsm-health',  label: 'HSM Health',       section: 'System',  keywords: ['hsm','luna','pkcs11','security'], icon: '<rect x="2" y="4" width="14" height="10" rx="2"/><circle cx="6" cy="9" r="1.5"/>' },
  { hash: '#/key-ceremony',label: 'Key Ceremony',     section: 'System',  keywords: ['key','ceremony','seed','hd','bip'], icon: '<path d="M11.5 2a3.5 3.5 0 00-2.83 5.54L3 13.2V16h2.8l5.66-5.67A3.5 3.5 0 1011.5 2z"/>' },
  { hash: '#/connectivity',label: 'System Health',    section: 'System',  keywords: ['health','connectivity','status'], icon: '<circle cx="5" cy="5" r="2.5"/><circle cx="13" cy="5" r="2.5"/><circle cx="9" cy="14" r="2.5"/>' },
  { hash: '#/chains',      label: 'Chains',           section: 'System',  keywords: ['chain','network','rpc','block'], icon: '<path d="M2 5h14M2 9h14M2 13h10"/>' },
  { hash: '#/settings',    label: 'Settings',         section: 'System',  keywords: ['settings','config','preferences'], icon: '<circle cx="9" cy="9" r="2.5"/>' },
  { hash: '#/api-keys',    label: 'API Keys',         section: 'System',  keywords: ['api','key','token','bank integration'], icon: '<path d="M11.5 2a3.5 3.5 0 00-2.83 5.54L3 13.2V16h2.8l5.66-5.67A3.5 3.5 0 1011.5 2z"/>' },
  { hash: '#/webhooks',    label: 'Webhooks',         section: 'System',  keywords: ['webhook','notification','callback'], icon: '<path d="M2 4l7 5 7-5"/><rect x="2" y="4" width="14" height="10" rx="2"/>' },

  // DEVELOPER
  { hash: '#/api-docs',    label: 'API Documentation',section: 'Developer', keywords: ['docs','api','reference'], icon: '<path d="M4 2h7l4 4v10H4V2z"/>' },
  { hash: '#/whitepaper',  label: 'White Paper',      section: 'Developer', keywords: ['whitepaper','white paper','architecture'], icon: '<path d="M3 3h12v12H3z"/>' },
  { hash: '#/test-exercise',label:'Test Exercise',    section: 'Developer', keywords: ['test','exercise','sandbox'], icon: '<path d="M5 3l8 6-8 6V3z"/>' },
];

function esc(s) {
  return (s == null ? '' : String(s)).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

// Fuzzy score: returns higher for better matches. 0 = no match.
function score(query, item) {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const label = item.label.toLowerCase();
  const section = item.section.toLowerCase();
  const kws = (item.keywords || []).join(' ').toLowerCase();

  // Exact prefix match
  if (label.startsWith(q)) return 100;
  // Word-start match in label
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) return 80;
  // Substring in label
  if (label.includes(q)) return 60;
  // Keyword match
  if (kws.includes(q)) return 40;
  // Section match
  if (section.includes(q)) return 20;
  // Character-subsequence (each char of q in order)
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 10;
  return 0;
}

function rankedResults(query) {
  const scored = PAGES
    .map(p => ({ ...p, _score: score(query, p) }))
    .filter(p => p._score > 0);
  scored.sort((a, b) => b._score - a._score || a.label.localeCompare(b.label));
  return scored.slice(0, 12);
}

function renderResults(results, activeIndex) {
  if (results.length === 0) {
    return '<div class="cmdk-empty">No results. Try a different search term.</div>';
  }
  // Group by section when no query (so users see everything)
  return results.map((r, i) => `
    <div class="cmdk-result ${i === activeIndex ? 'active' : ''}" data-hash="${esc(r.hash)}" data-index="${i}">
      <div class="cmdk-result-icon">
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">${r.icon}</svg>
      </div>
      <div class="cmdk-result-label">${esc(r.label)}</div>
      <div class="cmdk-result-hint">${esc(r.section)}</div>
    </div>
  `).join('');
}

export function initCommandPalette() {
  const overlay = document.getElementById('cmdk-overlay');
  const input = document.getElementById('cmdk-input');
  const resultsEl = document.getElementById('cmdk-results');
  const trigger = document.getElementById('cmdk-open');
  if (!overlay || !input || !resultsEl) return;

  let results = [];
  let activeIndex = 0;

  function open() {
    results = rankedResults('');
    activeIndex = 0;
    resultsEl.innerHTML = renderResults(results, activeIndex);
    input.value = '';
    overlay.style.display = 'flex';
    setTimeout(() => input.focus(), 20);
  }

  function close() {
    overlay.style.display = 'none';
    input.value = '';
  }

  function updateResults() {
    results = rankedResults(input.value);
    activeIndex = 0;
    resultsEl.innerHTML = renderResults(results, activeIndex);
  }

  function setActive(i) {
    activeIndex = (i + results.length) % results.length;
    resultsEl.querySelectorAll('.cmdk-result').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.index) === activeIndex);
    });
    // Scroll active into view
    resultsEl.querySelector('.cmdk-result.active')?.scrollIntoView({ block: 'nearest' });
  }

  function selectCurrent() {
    const picked = results[activeIndex];
    if (!picked) return;
    close();
    location.hash = picked.hash;
  }

  // Open
  trigger?.addEventListener('click', open);

  // Keyboard shortcut ⌘K / Ctrl+K
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const meta = isMac ? e.metaKey : e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.style.display === 'flex' ? close() : open();
    }
  });

  // Input and navigation
  input.addEventListener('input', updateResults);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); selectCurrent(); }
  });

  // Click result
  resultsEl.addEventListener('click', (e) => {
    const item = e.target.closest('.cmdk-result');
    if (!item) return;
    location.hash = item.dataset.hash;
    close();
  });

  // Click backdrop to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

// Approvals count badge poller — updates the red dot on the Approvals nav
export function initApprovalsBadge() {
  const badge = document.getElementById('nav-approvals-count');
  if (!badge) return;

  async function refresh() {
    try {
      // Try several endpoints — backend shape may vary
      const candidates = [
        '/api/v1/approvals/pending',
        '/agent-api/agent/approvals',
      ];
      let count = 0;
      for (const url of candidates) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) continue;
          const data = await res.json();
          const items = data.actions || data.approvals || data || [];
          if (Array.isArray(items)) count = items.length;
          break;
        } catch { /* try next */ }
      }

      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch { /* ignore */ }
  }

  refresh();
  setInterval(refresh, 15000); // every 15s
}
