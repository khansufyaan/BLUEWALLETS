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

async function agentRequest(path, opts = {}) {
  const token = sessionStorage.getItem('blueSessionToken') || '';
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${AGENT_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Fallback: try direct to agent on :3500 if gateway proxy isn't configured
async function agentRequestDirect(path, opts = {}) {
  try {
    return await agentRequest(path, opts);
  } catch (err) {
    // Try direct
    const origin = window.location.origin.replace(/:\d+$/, ':3500');
    const res = await fetch(`${origin}${path}`, opts);
    if (!res.ok) throw err; // propagate original error if direct also fails
    return res.json();
  }
}

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
          <span class="text-xs text-muted">${health?.tools || 0} tools available</span>
          <button class="btn btn-sm btn-primary" id="agent-new-btn">+ New Conversation</button>
        </div>
      </div>

      <div class="agent-layout">
        <!-- Sidebar: conversation list -->
        <aside class="agent-sidebar">
          <div class="agent-sidebar-title">Conversations</div>
          <div class="agent-convo-list" id="agent-convo-list">
            ${conversations.length === 0
              ? '<div class="text-xs text-muted" style="padding:var(--sp-3)">No conversations yet. Start one →</div>'
              : conversations.map(c => `
                  <div class="agent-convo-item" data-id="${esc(c.id)}">
                    <div class="agent-convo-title">${esc(c.title)}</div>
                    <div class="agent-convo-meta">${c.messageCount} msgs · ${fmtTime(c.updatedAt)}</div>
                  </div>
                `).join('')}
          </div>
          <div class="agent-sidebar-footer">
            <button class="btn btn-sm btn-ghost" id="agent-show-tools">View tools</button>
          </div>
        </aside>

        <!-- Main: chat panel -->
        <main class="agent-main">
          <div class="agent-messages" id="agent-messages">
            <div class="agent-welcome">
              <div class="agent-welcome-icon">&#129302;</div>
              <h2>Blue Wallets Assistant</h2>
              <p>Ask questions about wallets, vaults, transactions, HSM status, or system health. I can also perform administrative actions with your approval.</p>
              <div class="agent-suggestions">
                <button class="agent-suggestion" data-prompt="How many wallets do we have and what chains are they on?">How many wallets do we have?</button>
                <button class="agent-suggestion" data-prompt="Show me the most recent 5 transactions">Recent transactions</button>
                <button class="agent-suggestion" data-prompt="What is the HSM status right now?">HSM status</button>
                <button class="agent-suggestion" data-prompt="Are there any failed transactions in the last 24 hours?">Any failures today?</button>
                <button class="agent-suggestion" data-prompt="Create a new vault called Test Ceremony Vault">Create a test vault</button>
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
              <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;margin-right:12px">
                <input type="checkbox" id="agent-tts-toggle" style="margin:0"> Speak responses
              </label>
              ${llmOk
                ? `<span>All queries run on-prem · No data leaves your infrastructure</span>`
                : `<span class="text-red">Start the agent stack: <code>docker-compose -f docker-compose.agent.yml up -d</code></span>`}
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

  // Load existing conversation
  document.querySelectorAll('.agent-convo-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      try {
        const data = await agentRequestDirect(`/agent/conversations/${id}`);
        _conversationId = id;
        messagesEl.innerHTML = '';
        data.messages.forEach(m => appendMessage(m));
        document.querySelectorAll('.agent-convo-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      } catch (err) {
        alert('Failed to load: ' + err.message);
      }
    });
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

    try {
      const convId = await ensureConversation();
      const data = await agentRequestDirect(`/agent/conversations/${convId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });

      thinking.remove();

      // Render new messages (skip the user message we already added)
      data.messages.forEach(m => {
        if (m.role === 'user' && m.content === text) return;
        appendMessage(m);
      });

      // Handle pending approvals
      if (data.pendingApprovals && data.pendingApprovals.length > 0) {
        _pendingApprovals = data.pendingApprovals;
        renderApprovals(data.pendingApprovals);
      }

      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      thinking.remove();
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
  const ttsToggle = document.getElementById('agent-tts-toggle');

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

  // TTS — use free browser Web Speech API (works offline on most browsers)
  function speak(text) {
    if (!ttsToggle?.checked) return;
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text.replace(/[*_`#]/g, '').slice(0, 500));
    utter.rate = 1.05;
    utter.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }
  // Stop speaking when user starts typing
  input?.addEventListener('input', () => { if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel(); });

  // Attach speak() to assistant messages
  const origAppendMessage = appendMessage;
  window._speak = speak;

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
