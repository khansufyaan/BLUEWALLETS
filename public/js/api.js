const BASE = '/api/v1';

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
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    setSessionToken(null);
    window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
    const res = await fetch('/auth/me', {
      headers: { Authorization: `Bearer ${_sessionToken}` },
    });
    if (!res.ok) { setSessionToken(null); return null; }
    return res.json();
  },
};

export const api = {
  // Health
  health: () => fetch('/health').then(r => r.json()),

  // Vaults
  getVaults: () => request('/vaults').then(d => d.vaults),
  getVault: (id) => request(`/vaults/${id}`),
  createVault: (body) => request('/vaults', { method: 'POST', body: JSON.stringify(body) }),
  getVaultWallets: (vaultId) => request(`/vaults/${vaultId}/wallets`).then(d => d.wallets),
  createWalletInVault: (vaultId, body) => request(`/vaults/${vaultId}/wallets`, { method: 'POST', body: JSON.stringify(body) }),

  // Wallets
  getWallets: () => request('/wallets').then(d => d.wallets),
  getWallet: (id) => request(`/wallets/${id}`),
  createWallet: (body) => request('/wallets', { method: 'POST', body: JSON.stringify(body) }),
  transfer: (walletId, body) => request(`/wallets/${walletId}/transfer`, { method: 'POST', body: JSON.stringify(body) }),
  getTransactions: (walletId) => request(`/wallets/${walletId}/transactions`).then(d => d.transactions),
  attachPolicy: (walletId, policyId) => request(`/wallets/${walletId}/policies`, { method: 'POST', body: JSON.stringify({ policyId }) }),
  detachPolicy: (walletId, policyId) => request(`/wallets/${walletId}/policies/${policyId}`, { method: 'DELETE' }),

  // Policies
  getPolicies: () => request('/policies').then(d => d.policies),
  getPolicy: (id) => request(`/policies/${id}`),
  createPolicy: (body) => request('/policies', { method: 'POST', body: JSON.stringify(body) }),
  updatePolicy: (id, body) => request(`/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePolicy: (id) => request(`/policies/${id}`, { method: 'DELETE' }),

  // Roles
  getRoles: () => request('/roles').then(d => d.roles),
  getRole: (id) => request(`/roles/${id}`),
  createRole: (body) => request('/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateRole: (id, body) => request(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteRole: (id) => request(`/roles/${id}`, { method: 'DELETE' }),

  // Permissions
  getPermissions: () => request('/permissions'),

  // Dashboard
  getStats: () => request('/dashboard/stats'),
  getAllTransactions: (limit = 50) => request(`/dashboard/transactions?limit=${limit}`).then(d => d.transactions),

  // Key Ceremony
  getCeremonyStatus:  () => request('/ceremony/status'),
  initiateCeremony:   (body) => request('/ceremony/initiate', { method: 'POST', body: JSON.stringify({ reason: body.reason }) }),
  approveCeremony:    (body) => request('/ceremony/approve', { method: 'POST', body: JSON.stringify({ requestId: body.requestId }) }),
  demoApprove:        (requestId) => request('/ceremony/demo-approve', { method: 'POST', body: JSON.stringify({ requestId }) }),
  cancelCeremony:     () => request('/ceremony/cancel', { method: 'POST' }),
  getApprovalStatus:  () => request('/ceremony/approval'),
  generateMasterKeys: () => request('/ceremony/generate-keys', { method: 'POST' }),
  completeCeremony:   (coinTypes) => request('/ceremony/complete', { method: 'POST', body: JSON.stringify({ coinTypes }) }),

  // HSM Configuration
  getHsmStatus:     () => request('/hsm/status'),
  connectHsm:       (params) => request('/hsm/connect', { method: 'POST', body: JSON.stringify(params) }),
  disconnectHsm:    () => request('/hsm/disconnect', { method: 'POST' }),
  changeHsmPin:     (currentPin, newPin) => request('/hsm/change-pin', { method: 'POST', body: JSON.stringify({ currentPin, newPin }) }),

  // Health — service controls & logs (auth-protected)
  getServiceLogs:   (service) => request(`/health/logs?service=${encodeURIComponent(service)}`),
  restartService:   (service) => request(`/health/services/${encodeURIComponent(service)}/restart`, { method: 'POST' }),
};
