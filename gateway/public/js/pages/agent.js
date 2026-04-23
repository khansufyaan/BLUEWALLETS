/**
 * Blue Agent — AI Chat UI
 *
 * Natural language interface to Blue Wallets Console.
 * Supports tool calls, approval workflow, and streaming responses.
 */

import { api } from '../api.js';
import { staggerFadeIn, shakeElement } from '../animations.js';

const AGENT_BASE = '/agent-api'; // Reverse-proxied to blue-agent service

let _conversationId = null;
let _pendingApprovals = [];

function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtTime(d) {
  const dt = new Date(d);
  return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Perform a JSON fetch — throws if response is not OK OR not JSON.
// Non-JSON responses typically mean the request hit the SPA fallback
// (static dev server) instead of the real agent service.
async function jsonFetch(url, opts = {}) {
  const token = sessionStorage.getItem('blueSessionToken') || '';
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const body = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (!ct.includes('application/json')) {
    // Not an agent response — caller should try the fallback
    throw new Error('Non-JSON response (likely SPA fallback — agent proxy not configured)');
  }
  return res.json();
}

// Try /agent-api first (real gateway proxy). If it returns non-JSON,
// fall back to direct http://host:3500/agent/* (dev mode with no proxy).
async function agentRequestDirect(path, opts = {}) {
  try {
    return await jsonFetch(`${AGENT_BASE}${path}`, opts);
  } catch (proxyErr) {
    try {
      const origin = window.location.origin.replace(/:\d+$/, ':3500');
      return await jsonFetch(`${origin}${path}`, opts);
    } catch (directErr) {
      // Surface the more useful error (usually the direct one has the real problem)
      throw directErr;
    }
  }
}

// Back-compat alias
const agentRequest = agentRequestDirect;

export async function renderAgent() {
  let health = null;
  let conversations = [];
  try {
    health = await agentRequestDirect('/health');
    const data = await agentRequestDirect('/agent/conversations');
    conversations = data.conversations || [];
  } catch {}

  const llmOk = health?.llm?.ok;
  const llmModel = health?.llm?.model || health?.model || 'not connected';

  return `
    <div class="agent-page">
      <!-- Status bar -->
      <div class="agent-status-bar">
        <div class="agent-status-left">
          <div class="agent-status-dot ${llmOk ? 'agent-dot-ok' : 'agent-dot-err'}"></div>
          <div>
            <div class="agent-status-title">${llmOk ? 'Agent Online' : 'Agent Offline'}</div>
            <div class="agent-status-sub">${llmOk ? `Model: ${esc(llmModel)}` : 'LLM server unreachable — start the ollama container'}</div>
          </div>
        </div>
        <div class="agent-status-right">
          <button class="btn btn-sm btn-ghost" id="agent-show-tools">${health?.tools || 0} tools</button>
          <button class="btn btn-sm btn-primary" id="agent-new-btn">+ New</button>
        </div>
      </div>

      <div class="agent-layout agent-layout-solo">
        <!-- Main: chat panel (full width — no sidebar) -->
        <main class="agent-main">
          <div class="agent-messages" id="agent-messages">
            <div class="agent-welcome">
              <div class="agent-welcome-logo">
                <!-- Visa wordmark -->
                <svg viewBox="0 0 1000 324" xmlns="http://www.w3.org/2000/svg" aria-label="Visa">
                  <path fill="#1434CB" d="M433.4 220.4h-52.5L413.5 31.5h52.5L433.4 220.4zM641.3 36.2c-10.4-4.1-26.7-8.5-47-8.5-51.9 0-88.5 27.6-88.8 67.2-.3 29.2 26.1 45.5 46 55.3 20.4 10 27.3 16.4 27.2 25.3-.1 13.6-16.4 19.8-31.5 19.8-21.1 0-32.3-3.1-49.6-10.6l-6.8-3.2-7.4 45.6c12.3 5.6 35 10.5 58.6 10.7 55.2 0 91.1-27.2 91.5-69.5.2-23.1-13.9-40.7-44.4-55.3-18.5-9.4-29.8-15.7-29.7-25.3 0-8.5 9.7-17.6 30.6-17.6 17.5-.3 30.2 3.7 40.1 7.9l4.8 2.4 7.3-44.2M740.1 31.5c-11.7 0-20.5 3.4-25.7 15.7L638.3 220.4h55.3l11-30.5h67.5l6.4 30.5H828L787.4 31.5h-47.3m-20.8 138.5c4.3-11.6 20.9-56.3 20.9-56.3-.3.5 4.3-11.6 6.9-19.2l3.6 17.3s10 48.4 12.1 58.2h-43.5zM329.3 31.5L277.8 160.7l-5.5-27.7c-9.6-31.9-39.8-66.4-73.7-83.7l47.1 170.9 55.8-.1 83-189.6h-55.2"/>
                  <path fill="#1434CB" d="M226.2 31.5H141.2l-.7 4.1c66.2 16.4 109.9 56 128.1 103.7L250.2 47.5c-3.2-12.5-12.3-15.6-23.5-16h-.5"/>
                </svg>
              </div>
              <h2>Blue Wallet Agent</h2>
              <div class="agent-suggestions">
                <button class="agent-suggestion" data-prompt="How many wallets do we have and what chains are they on?">How many wallets do we have?</button>
                <button class="agent-suggestion" data-prompt="Show me the most recent 5 transactions">Recent transactions</button>
                <button class="agent-suggestion" data-prompt="What is the HSM status right now?">HSM status</button>
                <button class="agent-suggestion" data-prompt="Are there any failed transactions in the last 24 hours?">Any failures today?</button>
                <button class="agent-suggestion" data-prompt="Create a new vault called Test Vault">Create a test vault</button>
                <button class="agent-suggestion" data-prompt="Create 20 ETH wallets in the default vault named hot-1 through hot-20">Create 20 ETH wallets</button>
                <button class="agent-suggestion" data-prompt="Draft a policy that blocks any outbound transfer over 10 ETH unless 2 admins approve">Draft a spending policy</button>
                <button class="agent-suggestion" data-prompt="Explain what happened with the most recent failed transaction">Explain last failure</button>
              </div>
            </div>
          </div>

          <!-- Pending approvals banner -->
          <div class="agent-approvals" id="agent-approvals" style="display:none"></div>

          <!-- Input -->
          <div class="agent-input-wrap">
            <div class="agent-input-row">
              <textarea id="agent-input" class="agent-input" rows="1" placeholder="Ask the agent... (Cmd+Enter to send, hold mic for voice)" ${llmOk ? '' : 'disabled'}></textarea>
              <button class="agent-mic-btn" id="agent-mic" title="Hold to record voice input" ${llmOk ? '' : 'disabled'}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="6" y="2" width="6" height="10" rx="3"/>
                  <path d="M3 9a6 6 0 0012 0M9 15v2M6 17h6"/>
                </svg>
              </button>
              <button class="btn btn-primary" id="agent-send" ${llmOk ? '' : 'disabled'}>Send</button>
            </div>
            <div class="agent-input-hint">
              ${llmOk
                ? `<span>All queries run on-prem · No data leaves your infrastructure</span>`
                : `<span class="text-red">Start the agent stack: <code>docker compose -f docker-compose.client.yml -f docker-compose.agent.yml up -d</code></span>`}
            </div>
          </div>
        </main>
      </div>

      <!-- Tools modal -->
      <div class="modal-overlay" id="agent-tools-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>Available Tools</h3>
            <button class="modal-close" id="agent-tools-close">&times;</button>
          </div>
          <div id="agent-tools-body"><div class="loading">Loading...</div></div>
        </div>
      </div>
    </div>
  `;
}

export function initAgent() {
  const page = document.querySelector('.agent-page');
  if (!page) return;

  const input = document.getElementById('agent-input');
  const sendBtn = document.getElementById('agent-send');
  const messagesEl = document.getElementById('agent-messages');

  // Auto-resize textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });

  // Keyboard shortcut
  input?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn?.addEventListener('click', sendMessage);

  // Suggestion chips
  document.querySelectorAll('.agent-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.prompt;
      sendMessage();
    });
  });

  // New conversation
  document.getElementById('agent-new-btn')?.addEventListener('click', async () => {
    _conversationId = null;
    messagesEl.innerHTML = `
      <div class="agent-welcome">
        <div class="agent-welcome-icon">&#129302;</div>
        <h2>New conversation started</h2>
        <p>Ask anything about the system.</p>
      </div>`;
  });

  // Tools modal
  document.getElementById('agent-show-tools')?.addEventListener('click', async () => {
    const modal = document.getElementById('agent-tools-modal');
    const body = document.getElementById('agent-tools-body');
    modal.classList.add('active');
    try {
      const data = await agentRequestDirect('/agent/tools');
      body.innerHTML = `
        <div class="agent-tool-list">
          ${data.tools.map(t => `
            <div class="agent-tool-item ${t.kind === 'write' ? 'agent-tool-write' : ''}">
              <div class="agent-tool-head">
                <code class="agent-tool-name">${esc(t.name)}</code>
                <span class="badge ${t.kind === 'write' ? 'badge-pending' : 'badge-confirmed'}">${t.kind}${t.kind === 'write' ? ' · requires approval' : ''}</span>
              </div>
              <div class="agent-tool-desc">${esc(t.description)}</div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  });
  document.getElementById('agent-tools-close')?.addEventListener('click', () => {
    document.getElementById('agent-tools-modal').classList.remove('active');
  });

  async function ensureConversation() {
    if (_conversationId) return _conversationId;
    const data = await agentRequestDirect('/agent/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'New conversation' }),
    });
    _conversationId = data.id;
    return _conversationId;
  }

  /**
   * Try the SSE streaming endpoint. Returns true on success, false on failure
   * (so caller can fall back to non-streaming).
   */
  async function tryStreamChat(convId, text, handlers) {
    const paths = [
      `${AGENT_BASE}/agent/conversations/${convId}/chat/stream`,
      `${window.location.origin.replace(/:\d+$/, ':3500')}/agent/conversations/${convId}/chat/stream`,
    ];
    for (const url of paths) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify({ message: text }),
        });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('event-stream') || !res.body) continue; // try next URL

        // Parse SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let started = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Split on \n\n (SSE message separator)
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || '';
          for (const msg of messages) {
            if (!msg.trim()) continue;
            let event = 'message', data = '';
            for (const line of msg.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            let payload = null;
            try { payload = data ? JSON.parse(data) : {}; } catch { /* skip */ }
            if (payload === null) continue;

            if (event === 'assistant_start') {
              if (!started) { handlers.onStart(); started = true; }
              else { handlers.onAssistantDone({ role: 'assistant', content: '' }); handlers.onStart(); }
            }
            else if (event === 'assistant_delta' && payload.content) handlers.onDelta(payload.content);
            else if (event === 'assistant_done') handlers.onAssistantDone(payload.message);
            else if (event === 'tool_result') handlers.onToolResult(payload);
            else if (event === 'approval_needed') handlers.onApproval(payload.approval);
            else if (event === 'error') throw new Error(payload.error || 'stream error');
            else if (event === 'done') { /* end of stream */ }
          }
        }
        return true;
      } catch (err) {
        console.warn('Stream attempt failed:', err.message);
        continue;
      }
    }
    return false; // all paths failed
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    // Clear welcome if present
    const welcome = messagesEl.querySelector('.agent-welcome');
    if (welcome) welcome.remove();

    appendMessage({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;

    // Show thinking indicator
    const thinking = document.createElement('div');
    thinking.className = 'agent-msg agent-msg-assistant agent-thinking';
    thinking.innerHTML = `<div class="agent-msg-body"><span class="agent-dots"><span></span><span></span><span></span></span> Thinking...</div>`;
    messagesEl.appendChild(thinking);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    let streamingBubble = null; // The DIV for the current streaming assistant message
    let streamingText = '';

    try {
      const convId = await ensureConversation();

      // Try streaming endpoint first; fall back to non-streaming on failure
      const streamOk = await tryStreamChat(convId, text, {
        onStart: () => {
          thinking.remove();
          // Create an empty assistant bubble we'll fill as tokens arrive
          streamingBubble = document.createElement('div');
          streamingBubble.className = 'agent-msg agent-msg-assistant';
          streamingBubble.innerHTML = `<div class="agent-msg-body"><span class="agent-streaming-cursor">▍</span></div>`;
          messagesEl.appendChild(streamingBubble);
          streamingText = '';
        },
        onDelta: (content) => {
          if (!streamingBubble) return;
          streamingText += content;
          const body = streamingBubble.querySelector('.agent-msg-body');
          body.innerHTML = renderMarkdown(streamingText) + '<span class="agent-streaming-cursor">▍</span>';
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
        onAssistantDone: (msg) => {
          if (!streamingBubble) return;
          // Remove cursor, render final markdown + any tool calls
          const toolCalls = (msg.tool_calls || []).map(tc => `
            <div class="agent-tool-call">
              <div class="agent-tool-call-head">Calling <code>${esc(tc.function.name)}</code></div>
              <pre>${esc(tc.function.arguments)}</pre>
            </div>
          `).join('');
          const body = streamingBubble.querySelector('.agent-msg-body');
          body.innerHTML = (msg.content ? renderMarkdown(msg.content) : '<em style="opacity:0.6">Planning...</em>') + toolCalls;
          if (msg.content && window._speak) window._speak(msg.content);
          streamingBubble = null;
          streamingText = '';
        },
        onToolResult: (evt) => {
          let parsed;
          try { parsed = JSON.parse(evt.content); } catch { parsed = evt.content; }
          const isError = evt.error || (parsed && parsed.error);
          const preview = typeof parsed === 'object' ? JSON.stringify(parsed, null, 2).slice(0, 500) : String(parsed).slice(0, 500);
          const div = document.createElement('div');
          div.className = 'agent-msg agent-msg-tool';
          div.innerHTML = `
            <div class="agent-msg-body agent-tool-result ${isError ? 'agent-tool-error' : ''}">
              <details>
                <summary>${isError ? '&#9888; Tool error' : '&#10003; Tool result'}</summary>
                <pre>${esc(preview)}</pre>
              </details>
            </div>`;
          messagesEl.appendChild(div);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
        onApproval: (approval) => {
          _pendingApprovals.push(approval);
          renderApprovals(_pendingApprovals);
        },
      });

      if (!streamOk) {
        // Fallback to non-streaming
        const data = await agentRequestDirect(`/agent/conversations/${convId}/chat`, {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
        thinking.remove();
        data.messages.forEach(m => {
          if (m.role === 'user' && m.content === text) return;
          appendMessage(m);
        });
        if (data.pendingApprovals && data.pendingApprovals.length > 0) {
          _pendingApprovals = data.pendingApprovals;
          renderApprovals(data.pendingApprovals);
        }
      }

      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      thinking.remove();
      if (streamingBubble) streamingBubble.remove();
      appendMessage({ role: 'assistant', content: `⚠️ Error: ${err.message}` });
      shakeElement(sendBtn);
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function decideApproval(approvalId, decision) {
    try {
      const data = await agentRequestDirect(`/agent/approvals/${approvalId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      // Remove approval card
      document.querySelector(`[data-approval-id="${approvalId}"]`)?.remove();
      _pendingApprovals = _pendingApprovals.filter(a => a.id !== approvalId);
      if (_pendingApprovals.length === 0) {
        document.getElementById('agent-approvals').style.display = 'none';
      }

      // Append any new messages (result + LLM response)
      if (data.messages) {
        data.messages.forEach(m => appendMessage(m));
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    } catch (err) {
      alert('Approval failed: ' + err.message);
    }
  }

  function renderApprovals(approvals) {
    const container = document.getElementById('agent-approvals');
    container.style.display = '';
    container.innerHTML = approvals.map(a => `
      <div class="agent-approval" data-approval-id="${esc(a.id)}">
        <div class="agent-approval-head">
          <span class="badge badge-pending">Pending Approval</span>
          <code>${esc(a.toolName)}</code>
        </div>
        <div class="agent-approval-args">
          <pre>${esc(JSON.stringify(a.args, null, 2))}</pre>
        </div>
        <div class="agent-approval-actions">
          <button class="btn btn-sm btn-danger" data-approval="${esc(a.id)}" data-decision="rejected">Reject</button>
          <button class="btn btn-sm btn-primary" data-approval="${esc(a.id)}" data-decision="approved">Approve & Execute</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('button[data-approval]').forEach(btn => {
      btn.addEventListener('click', () => {
        decideApproval(btn.dataset.approval, btn.dataset.decision);
      });
    });
  }

  function appendMessage(msg) {
    const div = document.createElement('div');

    if (msg.role === 'user') {
      div.className = 'agent-msg agent-msg-user';
      div.innerHTML = `<div class="agent-msg-body">${esc(msg.content)}</div>`;
    } else if (msg.role === 'assistant') {
      div.className = 'agent-msg agent-msg-assistant';
      const content = msg.content ? renderMarkdown(msg.content) : '';
      const toolCalls = (msg.tool_calls || []).map(tc => `
        <div class="agent-tool-call">
          <div class="agent-tool-call-head">Calling <code>${esc(tc.function.name)}</code></div>
          <pre>${esc(tc.function.arguments)}</pre>
        </div>
      `).join('');
      // Skip empty assistant messages (only tool calls, no text) — render just the tool call card
      if (!content && !toolCalls) return;
      const bodyContent = content || '<em style="opacity:0.6">Planning next action...</em>';
      div.innerHTML = `<div class="agent-msg-body">${bodyContent}${toolCalls}</div>`;
      // Speak if TTS enabled
      if (msg.content && window._speak) window._speak(msg.content);
    } else if (msg.role === 'tool') {
      div.className = 'agent-msg agent-msg-tool';
      let parsed;
      try { parsed = JSON.parse(msg.content); } catch { parsed = msg.content; }
      const isError = parsed && typeof parsed === 'object' && parsed.error;
      const preview = typeof parsed === 'object'
        ? JSON.stringify(parsed, null, 2).slice(0, 500)
        : String(parsed).slice(0, 500);
      div.innerHTML = `
        <div class="agent-msg-body agent-tool-result ${isError ? 'agent-tool-error' : ''}">
          <details>
            <summary>${isError ? '&#9888; Tool error' : '&#10003; Tool result'}</summary>
            <pre>${esc(preview)}</pre>
          </details>
        </div>`;
    } else {
      return;
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Voice (STT + TTS) ────────────────────────────────────────────────
  let _mediaRecorder = null;
  let _audioChunks = [];
  let _isRecording = false;

  const micBtn = document.getElementById('agent-mic');

  async function startRecording() {
    if (_isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _audioChunks = [];
      _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _audioChunks.push(e.data); };
      _mediaRecorder.onstop = async () => {
        const blob = new Blob(_audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        if (blob.size < 500) return; // Too short
        micBtn.classList.add('agent-mic-processing');

        // Try /agent-api first (real gateway proxy), fall back to direct :3500 (dev server)
        async function doTranscribe(url) {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'audio/webm' },
            body: blob,
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
          // Reject non-JSON responses (e.g. SPA fallback HTML from dev server)
          const ct = r.headers.get('content-type') || '';
          if (!ct.includes('application/json')) throw new Error('Not a JSON response');
          return r.json();
        }

        try {
          let data;
          try {
            data = await doTranscribe(`${AGENT_BASE}/agent/voice/transcribe`);
          } catch {
            // Fallback: direct to agent on :3500
            const origin = window.location.origin.replace(/:\d+$/, ':3500');
            data = await doTranscribe(`${origin}/agent/voice/transcribe`);
          }
          if (data.text) {
            input.value = (input.value ? input.value + ' ' : '') + data.text;
            input.focus();
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 200) + 'px';
          } else {
            alert('No speech detected — please try again and speak clearly.');
          }
        } catch (err) {
          console.warn('Voice transcription failed:', err);
          alert('Voice transcription unavailable. Start the whisper container.');
        } finally {
          micBtn.classList.remove('agent-mic-processing');
        }
      };
      _mediaRecorder.start();
      _isRecording = true;
      micBtn.classList.add('agent-mic-recording');
    } catch (err) {
      console.warn('Microphone access denied:', err);
      alert('Microphone permission required for voice input.');
    }
  }

  function stopRecording() {
    if (_mediaRecorder && _isRecording) {
      _mediaRecorder.stop();
      _isRecording = false;
      micBtn.classList.remove('agent-mic-recording');
    }
  }

  // Press-and-hold behavior
  micBtn?.addEventListener('mousedown', startRecording);
  micBtn?.addEventListener('mouseup', stopRecording);
  micBtn?.addEventListener('mouseleave', stopRecording);
  micBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
  micBtn?.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

  // TTS removed — was rarely used and cluttered the input hint line.
  // If speak-response is needed in the future, add back via a mic-menu popover.
  window._speak = () => {};

  function renderMarkdown(text) {
    // Minimal safe markdown: code blocks, inline code, bold, italic, links, line breaks
    let html = esc(text);
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="agent-code"><code>${code}</code></pre>`);
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }
}
