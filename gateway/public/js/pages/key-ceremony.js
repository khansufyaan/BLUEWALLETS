/**
 * Key Ceremony Recording
 *
 * Record and view key generation ceremonies for compliance and audit.
 * Tracks participants, HSM slots, key derivation paths, and sign-offs.
 */

import { api } from '../api.js';
import { staggerFadeIn, confetti } from '../animations.js';

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Mock ceremony data
function getMockCeremonies() {
  return [
    {
      id: 'cer-001', name: 'Production HSM Key Init', status: 'completed',
      date: new Date(Date.now() - 86400000 * 7).toISOString(),
      participants: [
        { name: 'Alice Chen', role: 'Key Custodian', signedOff: true },
        { name: 'Bob Kumar', role: 'Compliance Officer', signedOff: true },
        { name: 'Carol Davis', role: 'Security Auditor', signedOff: true },
      ],
      hsmSlot: 3, derivationPath: "m/44'/60'/0'",
      keyType: 'BIP32 HD Master Key', algorithm: 'secp256k1',
      notes: 'Initial production key ceremony. HSM firmware v2.1.3 verified.',
    },
    {
      id: 'cer-002', name: 'Cold Storage Key Rotation', status: 'in_progress',
      date: new Date(Date.now() - 86400000 * 1).toISOString(),
      participants: [
        { name: 'Alice Chen', role: 'Key Custodian', signedOff: true },
        { name: 'David Park', role: 'CTO', signedOff: false },
        { name: 'Eve Wilson', role: 'Compliance Officer', signedOff: false },
      ],
      hsmSlot: 5, derivationPath: "m/44'/60'/1'",
      keyType: 'BIP32 HD Master Key', algorithm: 'secp256k1',
      notes: 'Scheduled key rotation per policy KR-2024-Q1.',
    },
  ];
}

export async function renderKeyCeremony() {
  let ceremonies;
  try {
    const data = await api.getKeyCeremonies?.();
    ceremonies = data?.ceremonies || data || [];
  } catch {
    ceremonies = getMockCeremonies();
  }

  return `
    <div class="kc-page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-5)">
        <span class="count-badge">${ceremonies.length} ceremonies</span>
        <button class="btn btn-primary" id="kc-new-btn">+ New Ceremony</button>
      </div>

      <!-- Ceremony List -->
      <div class="kc-list" id="kc-list">
        ${ceremonies.map(c => {
          const signedCount = c.participants.filter(p => p.signedOff).length;
          const totalParts = c.participants.length;
          const progressPct = totalParts > 0 ? (signedCount / totalParts * 100) : 0;
          return `
            <div class="card kc-card" style="margin-bottom:var(--sp-4)" data-id="${c.id}">
              <div class="kc-card-header">
                <div>
                  <h3 style="font-size:15px;font-weight:600">${c.name}</h3>
                  <div class="text-xs text-muted" style="margin-top:2px">${fmtDate(c.date)}</div>
                </div>
                <span class="badge ${c.status === 'completed' ? 'badge-confirmed' : 'badge-pending'}">${c.status}</span>
              </div>

              <!-- Key Details -->
              <div class="kc-details">
                <div class="kc-detail-item">
                  <span class="text-xs text-muted">HSM Slot</span>
                  <span class="mono">${c.hsmSlot}</span>
                </div>
                <div class="kc-detail-item">
                  <span class="text-xs text-muted">Derivation Path</span>
                  <span class="mono">${c.derivationPath}</span>
                </div>
                <div class="kc-detail-item">
                  <span class="text-xs text-muted">Key Type</span>
                  <span>${c.keyType}</span>
                </div>
                <div class="kc-detail-item">
                  <span class="text-xs text-muted">Algorithm</span>
                  <span class="mono">${c.algorithm}</span>
                </div>
              </div>

              <!-- Participants & Sign-offs -->
              <div style="margin-top:var(--sp-4)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-2)">
                  <span class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.05em">Participants (${signedCount}/${totalParts})</span>
                  <div class="kc-progress-bar">
                    <div class="kc-progress-fill" style="width:${progressPct}%"></div>
                  </div>
                </div>
                ${c.participants.map(p => `
                  <div class="kc-participant">
                    <div style="display:flex;align-items:center;gap:var(--sp-2)">
                      <div class="kc-signoff-icon ${p.signedOff ? 'kc-signed' : 'kc-unsigned'}">${p.signedOff ? '&#10003;' : '&#9711;'}</div>
                      <div>
                        <div style="font-size:13px;font-weight:500">${p.name}</div>
                        <div class="text-xs text-muted">${p.role}</div>
                      </div>
                    </div>
                    ${!p.signedOff && c.status !== 'completed' ? `<button class="btn btn-sm btn-primary kc-signoff-btn" data-cer="${c.id}" data-name="${p.name}">Sign Off</button>` : ''}
                  </div>
                `).join('')}
              </div>

              ${c.notes ? `<div class="kc-notes"><span class="text-xs text-muted">Notes:</span> ${c.notes}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <!-- New Ceremony Modal -->
      <div class="modal-overlay" id="kc-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>New Key Ceremony</h3>
            <button class="modal-close" id="kc-modal-close">&times;</button>
          </div>
          <form id="kc-form">
            <div class="form-group">
              <label class="form-label">Ceremony Name</label>
              <input type="text" id="kc-name" class="form-input" placeholder="e.g., Production Key Rotation Q1" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">HSM Slot</label>
                <input type="number" id="kc-slot" class="form-input" min="1" max="16" placeholder="Slot #">
              </div>
              <div class="form-group">
                <label class="form-label">Derivation Path</label>
                <input type="text" id="kc-path" class="form-input mono" placeholder="m/44'/60'/0'">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Key Type</label>
                <select id="kc-keytype" class="form-input">
                  <option>BIP32 HD Master Key</option>
                  <option>Ed25519 Signing Key</option>
                  <option>ECDSA secp256k1</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Algorithm</label>
                <select id="kc-algo" class="form-input">
                  <option>secp256k1</option>
                  <option>ed25519</option>
                  <option>secp256r1</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Participants (one per line: Name — Role)</label>
              <textarea id="kc-participants" class="form-input" rows="3" placeholder="Alice Chen — Key Custodian&#10;Bob Kumar — Compliance Officer"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea id="kc-notes" class="form-input" rows="2" placeholder="Optional ceremony notes..."></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn" id="kc-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Ceremony</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

export function initKeyCeremony() {
  const page = document.querySelector('.kc-page');
  if (!page) return;
  staggerFadeIn(page, '.kc-card');

  const modal = document.getElementById('kc-modal');
  document.getElementById('kc-new-btn')?.addEventListener('click', () => modal?.classList.add('active'));
  document.getElementById('kc-modal-close')?.addEventListener('click', () => modal?.classList.remove('active'));
  document.getElementById('kc-cancel')?.addEventListener('click', () => modal?.classList.remove('active'));

  // Sign-off buttons
  document.querySelectorAll('.kc-signoff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const icon = btn.parentElement.querySelector('.kc-signoff-icon');
      icon.className = 'kc-signoff-icon kc-signed';
      icon.innerHTML = '&#10003;';
      btn.remove();

      // Check if all signed off → confetti
      const card = btn.closest('.kc-card');
      const unsigned = card.querySelectorAll('.kc-unsigned');
      if (unsigned.length === 0) {
        const badge = card.querySelector('.badge');
        badge.className = 'badge badge-confirmed';
        badge.textContent = 'completed';
        confetti();
      }

      // Update progress bar
      const participants = card.querySelectorAll('.kc-participant');
      const signed = card.querySelectorAll('.kc-signed');
      const fill = card.querySelector('.kc-progress-fill');
      if (fill) fill.style.width = `${(signed.length / participants.length) * 100}%`;
    });
  });

  // Form submit
  document.getElementById('kc-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    modal?.classList.remove('active');
  });
}
