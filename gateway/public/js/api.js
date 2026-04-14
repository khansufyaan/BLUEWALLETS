/**
 * Blue Console — API client.
 *
 * Talks to the Console's own API (:3300) which proxies to the Driver.
 * Also talks to the ops API (:3400) for compliance/blockchain data.
 */

const BASE = '/api/v1';
const OPS_BASE = '/ops';

let _sessionToken = sessionStorage.getItem('blueSessionToken') || null;

export function setSessionToken(token) {
  _sessionToken = token;
  if (token) sessionStorage.setItem('blueSessionToken', token);
  else sessionStorage.removeItem('blueSessionToken');
}

export function getSessionToken() { return _sessionToken; }

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_sessionToken) headers['Authorization'] = `Bearer ${_sessionToken}`;

  // Add timeout to prevent hanging on slow/dead backends
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${BASE}${path}`, { ...options, headers, signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 401) {
      setSessionToken(null);
      window.dispatchEvent(new CustomEvent('session-expired'));
      throw new Error('Session expired. Please log in again.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Request timed out — backend may be unreachable');
    throw err;
  }
}

async function opsRequest(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(path, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Request timed out — backend may be unreachable');
    throw err;
  }
}

export const auth = {
  login: async (username, password) => {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setSessionToken(data.token);
    return data;
  },
  logout: async () => {
    if (_sessionToken) {
      await fetch('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${_sessionToken}` },
      }).catch(() => {});
    }
    setSessionToken(null);
  },
  me: async () => {
    if (!_sessionToken) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/auth/me', {
        headers: { Authorization: `Bearer ${_sessionToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return null; // Don't clear token here — let the router decide
      return res.json();
    } catch {
      clearTimeout(timeout);
      return null; // Network error — don't clear token, might be transient
    }
  },
};

export const api = {
  // Health
  health: () => fetch('/health').then(r => r.json()),

  // Vaults (proxied to Driver)
  getVaults: () => request('/vaults').then(d => d.vaults),
  getVault: (id) => request(`/vaults/${id}`),
  createVault: (body) => request('/vaults', { method: 'POST', body: JSON.stringify(body) }),
  getVaultWallets: (vaultId) => request(`/vaults/${vaultId}/wallets`).then(d => d.wallets),
  createWalletInVault: (vaultId, body) => request(`/vaults/${vaultId}/wallets`, { method: 'POST', body: JSON.stringify(body) }),

  // Wallets (proxied to Driver)
  getWallets: () => request('/wallets').then(d => d.wallets),
  getWallet: (id) => request(`/wallets/${id}`),
  createWallet: (body) => request('/wallets', { method: 'POST', body: JSON.stringify(body) }),
  transfer: (walletId, body) => request(`/wallets/${walletId}/transfer`, { method: 'POST', body: JSON.stringify(body) }),
  executeWithdrawal: (body) => request('/transfers', { method: 'POST', body: JSON.stringify(body) }),
  getTransactions: (walletId) => request(`/wallets/${walletId}/transactions`).then(d => d.transactions),
  attachPolicy: (walletId, policyId) => request(`/wallets/${walletId}/policies`, { method: 'POST', body: JSON.stringify({ policyId }) }),
  detachPolicy: (walletId, policyId) => request(`/wallets/${walletId}/policies/${policyId}`, { method: 'DELETE' }),

  // Policies (proxied to Driver)
  getPolicies: () => request('/policies').then(d => d.policies),
  getPolicy: (id) => request(`/policies/${id}`),
  createPolicy: (body) => request('/policies', { method: 'POST', body: JSON.stringify(body) }),
  updatePolicy: (id, body) => request(`/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePolicy: (id) => request(`/policies/${id}`, { method: 'DELETE' }),

  // Roles (proxied to Driver)
  getRoles: () => request('/roles').then(d => d.roles),
  getPermissions: () => request('/permissions'),

  // Dashboard (proxied to Driver)
  getStats: () => request('/dashboard/stats'),
  getAllTransactions: (limit = 50) => request(`/dashboard/transactions?limit=${limit}`).then(d => d.transactions),

  // Ops (direct to Console ops API)
  getOpsStats:        () => opsRequest(`${OPS_BASE}/stats`),
  getOpsTransactions: () => opsRequest(`${OPS_BASE}/transactions`),
  getOpsDeposits:     () => opsRequest(`${OPS_BASE}/deposits`),
  getOpsWallets:      () => opsRequest(`${OPS_BASE}/wallets`),
  getOpsChains:       () => opsRequest(`${OPS_BASE}/chains`),
  getOpsHealth:       () => opsRequest(`${OPS_BASE}/health`),

  // Audit log
  getAuditLog:        (params) => opsRequest(`${OPS_BASE}/audit-log${params ? '?' + new URLSearchParams(params) : ''}`),

  // Webhooks
  getWebhooks:        () => opsRequest(`${OPS_BASE}/webhooks`),
  createWebhook:      (body) => fetch(`${OPS_BASE}/webhooks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  deleteWebhook:      (id) => fetch(`${OPS_BASE}/webhooks/${id}`, { method: 'DELETE' }).then(r => r.json()),
  testWebhook:        (id) => fetch(`${OPS_BASE}/webhooks/${id}/test`, { method: 'POST' }).then(r => r.json()),

  // Risk
  getRiskData:        () => opsRequest(`${OPS_BASE}/risk`),

  // Key Ceremonies
  getKeyCeremonies:   () => opsRequest(`${OPS_BASE}/key-ceremonies`),
  createKeyCeremony:  (body) => fetch(`${OPS_BASE}/key-ceremonies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),

  // Multi-sig Approvals
  getApprovals:       () => opsRequest(`${OPS_BASE}/approvals`),
  approveRequest:     (id) => fetch(`${OPS_BASE}/approvals/${id}/approve`, { method: 'POST' }).then(r => r.json()),
  rejectRequest:      (id) => fetch(`${OPS_BASE}/approvals/${id}/reject`, { method: 'POST' }).then(r => r.json()),

  // Automations
  getAutomations:     () => opsRequest(`${OPS_BASE}/automations`),
  createAutomation:   (body) => fetch(`${OPS_BASE}/automations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  updateAutomation:   (id, body) => fetch(`${OPS_BASE}/automations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  deleteAutomation:   (id) => fetch(`${OPS_BASE}/automations/${id}`, { method: 'DELETE' }).then(r => r.json()),
};
