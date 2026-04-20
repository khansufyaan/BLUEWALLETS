/**
 * Explain This Transaction — inline AI popup
 *
 * Used by transaction tables across the console. Add a button with
 * class "explain-tx-btn" and data-tx-id attribute. This module
 * attaches handlers and renders a popup with the agent's explanation.
 */

const AGENT_BASE = '/agent-api';

function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Reject non-JSON responses (SPA fallback from dev server)
  if (!ct.includes('application/json')) {
    throw new Error('Non-JSON response — agent proxy likely not configured');
  }
  return res.json();
}

async function agentCall(path, opts = {}) {
  try {
    return await jsonFetch(`${AGENT_BASE}${path}`, opts);
  } catch {
    // Fallback: direct to :3500
    const origin = window.location.origin.replace(/:\d+$/, ':3500');
    return await jsonFetch(`${origin}${path}`, opts);
  }
}

function renderMarkdown(text) {
  let html = esc(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre style="background:var(--bg-input);padding:8px;border-radius:6px;font-size:12px"><code>${code}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function showPopup() {
  const overlay = document.createElement('div');
  overlay.className = 'explain-popup-overlay';
  overlay.innerHTML = `
    <div class="explain-popup" onclick="event.stopPropagation()">
      <div class="explain-popup-header">
        <div class="explain-popup-title">
          <span class="explain-popup-icon">&#129302;</span>
          <span>Transaction Explained</span>
        </div>
        <button class="modal-close" id="explain-close">&times;</button>
      </div>
      <div class="explain-popup-body" id="explain-body">
        <div class="explain-popup-loading">
          <span class="agent-dots"><span></span><span></span><span></span></span>
          Analyzing transaction...
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#explain-close').addEventListener('click', () => overlay.remove());
  return overlay.querySelector('#explain-body');
}

async function explainTx(txId) {
  const bodyEl = showPopup();
  try {
    // Create a temporary conversation + ask for explanation
    const conv = await agentCall('/agent/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Explain ${txId}` }),
    });

    const response = await agentCall(`/agent/conversations/${conv.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Explain transaction ${txId} in plain English. Use the explain_transaction tool, then give a 2-3 paragraph summary covering: what happened, who was involved, the outcome, and if it failed, the root cause.`,
      }),
    });

    const assistantMsgs = (response.messages || []).filter(m => m.role === 'assistant' && m.content);
    const lastMsg = assistantMsgs[assistantMsgs.length - 1];
    if (lastMsg?.content) {
      bodyEl.innerHTML = renderMarkdown(lastMsg.content);
    } else {
      bodyEl.innerHTML = '<p>Agent returned no explanation. Try again or check the agent service is running.</p>';
    }

    // Cleanup the temporary conversation
    agentCall(`/agent/conversations/${conv.id}`, { method: 'DELETE' }).catch(() => {});
  } catch (err) {
    bodyEl.innerHTML = `
      <div class="alert alert-error">
        <strong>Could not reach the agent.</strong><br>
        ${esc(err.message || 'Unknown error')}
        <div style="margin-top:8px;font-size:12px">
          Ensure the agent stack is running: <code>docker-compose -f docker-compose.agent.yml up -d</code>
        </div>
      </div>`;
  }
}

export function attachExplainButtons() {
  document.querySelectorAll('.explain-tx-btn').forEach(btn => {
    if (btn.dataset.explainAttached) return;
    btn.dataset.explainAttached = 'true';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const txId = btn.dataset.txId;
      if (txId) explainTx(txId);
    });
  });
}

// Auto-attach on any DOM mutations (handles page re-renders)
if (typeof window !== 'undefined') {
  const observer = new MutationObserver(() => attachExplainButtons());
  observer.observe(document.body, { childList: true, subtree: true });
}
