/**
 * Test Exercise — Interactive walkthrough for wallet creation + policy enforcement.
 *
 * Steps:
 *   1. Create an API key
 *   2. Create a vault
 *   3. Create source wallet (with chain selection)
 *   4. Verify the wallet
 *   5. Create a velocity policy + attach to wallet
 *   6. Create destination wallet + attempt two transfers (pass then block)
 */

const API_KEYS_URL = '/ops/api-keys';
const API_BASE = '/api/v1';
const TOTAL_STEPS = 6;

let _state = {
  step: 1,
  apiKey: null,
  vaultId: null,
  walletId: null,
  walletData: null,
  policyId: null,
  destWalletId: null,
  transfer1: null,
  transfer2: null,
};

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': _state.apiKey,
  };
}

export async function renderTestExercise() {
  const origin = location.origin;
  return `
    <div class="card" style="margin-bottom:var(--sp-6)">
      <div class="card-header">
        <div>
          <h2 class="card-title">API Test Exercise</h2>
          <p class="card-subtitle">Create a wallet, attach a velocity policy, and prove it blocks transfers that exceed the limit.</p>
        </div>
        <button class="btn-ghost" id="btn-reset-exercise" style="font-size:12px">Reset</button>
      </div>

      <!-- Progress -->
      <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-6)">
        ${Array.from({length: TOTAL_STEPS}, (_, i) => `
          <div class="exercise-step-indicator" data-step="${i+1}" style="
            flex:1;height:4px;border-radius:2px;
            background:var(--bg-elevated);transition:background 0.3s">
          </div>
        `).join('')}
      </div>

      <!-- Step 1: Create API Key -->
      <div class="exercise-step" id="step-1">
        <div class="exercise-step-header">
          <div class="exercise-step-number">1</div>
          <div>
            <div class="exercise-step-title">Create an API Key</div>
            <div class="exercise-step-desc">Generate a key with full permissions for this test.</div>
          </div>
        </div>
        <div class="exercise-curl"><code>POST /ops/api-keys  { "name": "Test Exercise", "permissions": [...all] }</code></div>
        <div class="exercise-actions">
          <button class="btn-action" id="btn-run-step-1">Run</button>
          <span class="exercise-status" id="status-1"></span>
        </div>
        <pre class="exercise-response" id="response-1" style="display:none"></pre>
      </div>

      <!-- Step 2: Create Vault -->
      <div class="exercise-step" id="step-2" style="opacity:0.4;pointer-events:none">
        <div class="exercise-step-header">
          <div class="exercise-step-number">2</div>
          <div>
            <div class="exercise-step-title">Create a Vault</div>
            <div class="exercise-step-desc">Logical container for wallets.</div>
          </div>
        </div>
        <div class="exercise-curl" id="curl-2"><code>POST /api/v1/vaults</code></div>
        <div class="exercise-actions">
          <button class="btn-action" id="btn-run-step-2">Run</button>
          <span class="exercise-status" id="status-2"></span>
        </div>
        <pre class="exercise-response" id="response-2" style="display:none"></pre>
      </div>

      <!-- Step 3: Create Source Wallet -->
      <div class="exercise-step" id="step-3" style="opacity:0.4;pointer-events:none">
        <div class="exercise-step-header">
          <div class="exercise-step-number">3</div>
          <div>
            <div class="exercise-step-title">Create Source Wallet</div>
            <div class="exercise-step-desc">HSM-backed wallet that will have a policy attached.</div>
          </div>
        </div>
        <div style="margin-bottom:var(--sp-3)">
          <label class="field-label">Blockchain</label>
          <select class="field-input" id="chain-select" style="width:200px">
            <option value="ethereum" selected>Ethereum (Sepolia)</option>
            <option value="polygon">Polygon</option>
            <option value="bsc">BNB Chain</option>
            <option value="arbitrum">Arbitrum</option>
          </select>
        </div>
        <div class="exercise-curl" id="curl-3"><code>POST /api/v1/wallets { chain, name, vaultId }</code></div>
        <div class="exercise-actions">
          <button class="btn-action" id="btn-run-step-3">Run</button>
          <span class="exercise-status" id="status-3"></span>
        </div>
        <pre class="exercise-response" id="response-3" style="display:none"></pre>
      </div>

      <!-- Step 4: Verify Wallet -->
      <div class="exercise-step" id="step-4" style="opacity:0.4;pointer-events:none">
        <div class="exercise-step-header">
          <div class="exercise-step-number">4</div>
          <div>
            <div class="exercise-step-title">Verify the Wallet</div>
            <div class="exercise-step-desc">Confirm HSM-backed key and blockchain address.</div>
          </div>
        </div>
        <div class="exercise-curl" id="curl-4"><code>GET /api/v1/wallets/:id</code></div>
        <div class="exercise-actions">
          <button class="btn-action" id="btn-run-step-4">Run</button>
          <span class="exercise-status" id="status-4"></span>
        </div>
        <pre class="exercise-response" id="response-4" style="display:none"></pre>
      </div>

      <!-- Step 5: Create Policy + Attach -->
      <div class="exercise-step" id="step-5" style="opacity:0.4;pointer-events:none">
        <div class="exercise-step-header">
          <div class="exercise-step-number">5</div>
          <div>
            <div class="exercise-step-title">Create Velocity Policy &amp; Attach to Wallet</div>
            <div class="exercise-step-desc">
              Create a velocity policy that limits the wallet to <strong>500 wei max</strong> in a <strong>60-minute window</strong>,
              then attach it to the source wallet.
            </div>
          </div>
        </div>
        <div class="exercise-curl" id="curl-5a"><code>POST /api/v1/policies { name, rules: [{ type: "velocity", params: { maxAmount: "500", windowMinutes: 60 }}] }
POST /api/v1/wallets/:id/policies { policyId }</code></div>
        <div class="exercise-actions">
          <button class="btn-action" id="btn-run-step-5">Run</button>
          <span class="exercise-status" id="status-5"></span>
        </div>
        <pre class="exercise-response" id="response-5" style="display:none"></pre>
      </div>

      <!-- Step 6: Transfer Test (pass + block) -->
      <div class="exercise-step" id="step-6" style="opacity:0.4;pointer-events:none">
        <div class="exercise-step-header">
          <div class="exercise-step-number">6</div>
          <div>
            <div class="exercise-step-title">Policy Enforcement Test</div>
            <div class="exercise-step-desc">
              Create a destination wallet, then attempt two transfers from the source wallet.<br>
              <strong>Transfer 1</strong> (300 wei) — should <span style="color:var(--emerald)">PASS</span> (under 500 limit).<br>
              <strong>Transfer 2</strong> (300 wei) — should be <span style="color:var(--red)">REJECTED</span> (300+300=600 exceeds 500 limit).
            </div>
          </div>
        </div>
        <div class="exercise-curl" id="curl-6"><code>POST /api/v1/wallets  (destination wallet)
POST /api/v1/wallets/:id/transfer { toWalletId, amount: "300", currency }  (x2)</code></div>
        <div class="exercise-actions">
          <button class="btn-action" id="btn-run-step-6">Run</button>
          <span class="exercise-status" id="status-6"></span>
        </div>
        <pre class="exercise-response" id="response-6" style="display:none"></pre>
      </div>
    </div>

    <style>
      .exercise-step { margin-bottom: var(--sp-5); padding: var(--sp-4); background: var(--bg-elevated); border-radius: var(--r-md); transition: opacity 0.3s; }
      .exercise-step-header { display: flex; align-items: flex-start; gap: var(--sp-3); margin-bottom: var(--sp-3); }
      .exercise-step-number { width: 28px; height: 28px; border-radius: 50%; background: var(--blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0; }
      .exercise-step-number.done { background: var(--emerald); }
      .exercise-step-title { font-weight: 600; font-size: 14px; color: var(--text-primary); }
      .exercise-step-desc { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; line-height: 1.6; }
      .exercise-curl { background: var(--bg-primary); border-radius: var(--r-sm); padding: var(--sp-3); margin-bottom: var(--sp-3); overflow-x: auto; }
      .exercise-curl code { font-size: 11px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; }
      .exercise-actions { display: flex; align-items: center; gap: var(--sp-3); }
      .exercise-status { font-size: 12px; color: var(--text-tertiary); }
      .exercise-response { background: var(--bg-primary); border-radius: var(--r-sm); padding: var(--sp-3); font-size: 11px; color: var(--emerald); white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; margin-top: var(--sp-3); }
      .exercise-response.has-error { color: var(--red); }
    </style>
  `;
}

export function initTestExercise() {
  setTimeout(() => {
    updateProgress();

    // Reset
    document.getElementById('btn-reset-exercise')?.addEventListener('click', () => {
      _state = { step: 1, apiKey: null, vaultId: null, walletId: null, walletData: null, policyId: null, destWalletId: null, transfer1: null, transfer2: null };
      const container = document.getElementById('page-content');
      if (container) { renderTestExercise().then(html => { container.innerHTML = html; initTestExercise(); }); }
    });

    // Step 1: Create API Key
    document.getElementById('btn-run-step-1')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-step-1');
      const status = document.getElementById('status-1');
      btn.disabled = true;
      status.textContent = 'Creating API key...';
      try {
        const res = await fetch(API_KEYS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Exercise', permissions: ['wallets:read', 'wallets:create', 'vaults:read', 'vaults:create', 'transfers:execute', 'policies:read', 'policies:write'] }),
        });
        const data = await res.json();
        if (!res.ok || !data.key) throw new Error(data.error || 'Failed');
        showResponse('response-1', data);
        _state.apiKey = data.key;
        advance(1, status, 'API key created');
      } catch (e) { fail(btn, status, e); }
    });

    // Step 2: Create Vault
    document.getElementById('btn-run-step-2')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-step-2');
      const status = document.getElementById('status-2');
      btn.disabled = true;
      status.textContent = 'Creating vault...';
      try {
        const res = await fetch(`${API_BASE}/vaults`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ name: 'Test Vault', description: 'Policy test exercise' }) });
        const data = await res.json();
        if (!res.ok || !data.id) throw new Error(data.error || 'Failed');
        showResponse('response-2', data);
        _state.vaultId = data.id;
        advance(2, status, `Vault ${data.id.slice(0,8)}...`);
      } catch (e) { fail(btn, status, e); }
    });

    // Step 3: Create Source Wallet
    document.getElementById('btn-run-step-3')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-step-3');
      const status = document.getElementById('status-3');
      btn.disabled = true;
      const chain = document.getElementById('chain-select')?.value || 'ethereum';
      status.textContent = `Creating ${chain} wallet...`;
      try {
        const res = await fetch(`${API_BASE}/wallets`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ chain, name: 'Source Wallet (policy test)', vaultId: _state.vaultId, initialBalance: '1000' }) });
        const data = await res.json();
        if (!res.ok || !data.id) throw new Error(data.error || 'Failed');
        showResponse('response-3', data);
        _state.walletId = data.id;
        const mode = data.hdVersion ? `HD ${data.derivationPath}` : 'Legacy';
        advance(3, status, `Wallet: ${data.address?.slice(0,10)}... (${mode})`);
      } catch (e) { fail(btn, status, e); }
    });

    // Step 4: Verify Wallet
    document.getElementById('btn-run-step-4')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-step-4');
      const status = document.getElementById('status-4');
      btn.disabled = true;
      status.textContent = 'Fetching wallet...';
      try {
        const res = await fetch(`${API_BASE}/wallets/${_state.walletId}`, { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        showResponse('response-4', data);
        _state.walletData = data;
        const hdInfo = data.hdVersion
          ? `HD wallet confirmed — path: ${data.derivationPath}, key encrypted by HSM, 0 HSM slots used`
          : `Legacy wallet — key stored as permanent HSM token object`;
        advance(4, status, hdInfo);
      } catch (e) { fail(btn, status, e); }
    });

    // Step 5: Create Policy + Attach
    document.getElementById('btn-run-step-5')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-step-5');
      const status = document.getElementById('status-5');
      btn.disabled = true;
      status.textContent = 'Creating velocity policy...';
      try {
        // Create the policy
        const pRes = await fetch(`${API_BASE}/policies`, {
          method: 'POST', headers: apiHeaders(),
          body: JSON.stringify({
            name: 'Test Velocity Limit',
            description: 'Max 500 wei per 60-minute window',
            rules: [{ type: 'velocity', params: { maxAmount: '500', windowMinutes: 60 } }],
          }),
        });
        const policy = await pRes.json();
        if (!pRes.ok || !policy.id) throw new Error(policy.error || 'Failed to create policy');
        _state.policyId = policy.id;

        status.textContent = 'Attaching policy to wallet...';

        // Attach to source wallet
        const aRes = await fetch(`${API_BASE}/wallets/${_state.walletId}/policies`, {
          method: 'POST', headers: apiHeaders(),
          body: JSON.stringify({ policyId: policy.id }),
        });
        const attach = await aRes.json();
        if (!aRes.ok) throw new Error(attach.error || 'Failed to attach policy');

        showResponse('response-5', { policy, attached: { walletId: _state.walletId, policyId: policy.id, result: 'attached' } });
        advance(5, status, `Policy ${policy.id.slice(0,8)}... attached to wallet`);
      } catch (e) { fail(btn, status, e); }
    });

    // Step 6: Transfer Test
    document.getElementById('btn-run-step-6')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-step-6');
      const status = document.getElementById('status-6');
      btn.disabled = true;
      const chain = document.getElementById('chain-select')?.value || 'ethereum';
      const results = {};

      try {
        // Create destination wallet
        status.textContent = 'Creating destination wallet...';
        const dRes = await fetch(`${API_BASE}/wallets`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ chain, name: 'Destination Wallet', vaultId: _state.vaultId }) });
        const dest = await dRes.json();
        if (!dRes.ok || !dest.id) throw new Error(dest.error || 'Failed to create destination wallet');
        _state.destWalletId = dest.id;
        results.destinationWallet = { id: dest.id, address: dest.address };

        // Transfer 1: 300 wei (should PASS — under 500 limit)
        status.textContent = 'Transfer 1: 300 wei (should pass)...';
        const t1Res = await fetch(`${API_BASE}/wallets/${_state.walletId}/transfer`, {
          method: 'POST', headers: apiHeaders(),
          body: JSON.stringify({ toWalletId: dest.id, amount: '300', currency: _state.walletData?.currency || 'ETH' }),
        });
        const t1 = await t1Res.json();
        results.transfer1 = { amount: '300', status: t1.status, policyEvaluations: t1.policyEvaluations || [] };
        _state.transfer1 = t1;

        // Transfer 2: 300 wei (should be REJECTED — 300+300=600 > 500 limit)
        status.textContent = 'Transfer 2: 300 wei (should be blocked)...';
        const t2Res = await fetch(`${API_BASE}/wallets/${_state.walletId}/transfer`, {
          method: 'POST', headers: apiHeaders(),
          body: JSON.stringify({ toWalletId: dest.id, amount: '300', currency: _state.walletData?.currency || 'ETH' }),
        });
        const t2 = await t2Res.json();
        results.transfer2 = { amount: '300', status: t2.status, failureReason: t2.failureReason || null, policyEvaluations: t2.policyEvaluations || [] };
        _state.transfer2 = t2;

        showResponse('response-6', results);

        // Determine outcome
        const t1Pass = t1.status === 'completed';
        const t2Block = t2.status === 'rejected';

        if (t1Pass && t2Block) {
          status.innerHTML = '<strong style="color:var(--emerald)">Policy enforcement verified!</strong> Transfer 1 passed, Transfer 2 was blocked by velocity policy.';
          status.style.color = 'var(--emerald)';
          markStepDone(6);
        } else if (!t1Pass) {
          status.textContent = `Unexpected: Transfer 1 was ${t1.status} (expected completed). Check if initial balance is sufficient.`;
          status.style.color = 'var(--amber)';
        } else {
          status.textContent = `Unexpected: Transfer 2 was ${t2.status} (expected rejected). Policy may not be enforcing.`;
          status.style.color = 'var(--amber)';
        }
        _state.step = TOTAL_STEPS + 1;
        updateProgress();
      } catch (e) { fail(btn, status, e); }
    });

  }, 50);
}

// ── Helpers ────────────────────────────────────────────────────────

function advance(stepDone, statusEl, msg) {
  _state.step = stepDone + 1;
  statusEl.textContent = msg;
  statusEl.style.color = 'var(--emerald)';
  markStepDone(stepDone);
  enableStep(stepDone + 1);
  updateProgress();
}

function fail(btn, statusEl, err) {
  statusEl.textContent = `Error: ${err.message}`;
  statusEl.style.color = 'var(--red)';
  btn.disabled = false;
}

function showResponse(id, data) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  el.textContent = JSON.stringify(data, null, 2);
}

function markStepDone(n) {
  const numEl = document.querySelector(`#step-${n} .exercise-step-number`);
  if (numEl) { numEl.classList.add('done'); numEl.textContent = '\u2713'; }
}

function enableStep(n) {
  const el = document.getElementById(`step-${n}`);
  if (el) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; }
}

function updateProgress() {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const ind = document.querySelector(`.exercise-step-indicator[data-step="${i}"]`);
    if (ind) ind.style.background = i < _state.step ? 'var(--emerald)' : 'var(--bg-elevated)';
  }
}
