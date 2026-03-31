import { api } from '../api.js';

export async function renderApiDocs() {
  try {
    const health = await api.health();
    const baseUrl = window.location.origin;

    const sections = [
      buildOverviewSection(baseUrl, health),
      buildAuthSection(),
      buildVaultsSection(),
      buildWalletsSection(),
      buildTransactionsSection(),
      buildKeysSection(),
      buildPoliciesSection(),
      buildRbacSection(),
      buildHealthSection(),
      buildDashboardSection(),
      buildArchitectureSection(),
      buildErrorsSection(),
    ];

    return `
      <div class="api-docs">
        <div class="api-docs-sidebar">
          <div style="padding:16px 16px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">API Reference</div>
          <nav class="api-docs-nav" id="api-docs-nav">
            <a href="#section-overview" class="api-nav-item active">Overview</a>
            <a href="#section-authentication" class="api-nav-item">Authentication</a>
            <div style="padding:12px 16px 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Core Services</div>
            <a href="#section-vaults" class="api-nav-item">Vaults</a>
            <a href="#section-wallets" class="api-nav-item">Wallets</a>
            <a href="#section-transactions" class="api-nav-item">Transactions</a>
            <a href="#section-keys" class="api-nav-item">Key Management</a>
            <a href="#section-policies" class="api-nav-item">Policy Engine</a>
            <a href="#section-rbac" class="api-nav-item">Roles & Permissions</a>
            <div style="padding:12px 16px 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">System</div>
            <a href="#section-health" class="api-nav-item">Health</a>
            <a href="#section-dashboard" class="api-nav-item">Dashboard & Analytics</a>
            <a href="#section-architecture" class="api-nav-item">Architecture</a>
            <a href="#section-errors" class="api-nav-item">Error Handling</a>
          </nav>
        </div>
        <div class="api-docs-content" id="api-docs-content">
          ${sections.join('')}
        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initApiDocs() {
  // Scroll-spy for nav highlighting
  const content = document.getElementById('api-docs-content');
  const navItems = document.querySelectorAll('.api-nav-item');
  if (!content) return;

  content.addEventListener('scroll', () => {
    const sections = content.querySelectorAll('.api-section');
    let current = '';
    sections.forEach(section => {
      const top = section.offsetTop - content.scrollTop;
      if (top < 120) current = section.id;
    });
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('href') === `#${current}`);
    });
  });

  // Nav click scrolling
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const id = item.getAttribute('href').substring(1);
      const target = document.getElementById(id);
      if (target && content) {
        content.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
      }
    });
  });
}

// ─── Section Builders ────────────────────────────────────────

function buildOverviewSection(baseUrl, health) {
  return section('overview', 'Overview', `
    <p>The Blue Wallets API provides programmatic access to a Wallet-as-a-Service (WaaS) custody platform. All cryptographic operations are performed inside a <strong>FIPS 140-3 Level 3</strong> Hardware Security Module (HSM). Private keys never leave the HSM boundary.</p>

    <div class="api-info-grid">
      <div class="api-info-card">
        <div class="api-info-label">Base URL</div>
        <div class="api-info-value mono">${baseUrl}/api/v1</div>
      </div>
      <div class="api-info-card">
        <div class="api-info-label">Protocol</div>
        <div class="api-info-value">REST / JSON</div>
      </div>
      <div class="api-info-card">
        <div class="api-info-label">HSM Status</div>
        <div class="api-info-value" style="color:${health.hsm?.connected ? 'var(--emerald)' : 'var(--red)'}">${health.hsm?.connected ? 'Connected' : 'Disconnected'}</div>
      </div>
      <div class="api-info-card">
        <div class="api-info-label">Version</div>
        <div class="api-info-value">v1</div>
      </div>
    </div>

    <h3>Core Services</h3>
    <table>
      <thead><tr><th>Service</th><th>Description</th><th>Base Path</th></tr></thead>
      <tbody>
        <tr><td>Vault Service</td><td>Multi-wallet containers for institutional segregation</td><td class="mono">/api/v1/vaults</td></tr>
        <tr><td>Wallet Service</td><td>Address generation, balance management, transfers</td><td class="mono">/api/v1/wallets</td></tr>
        <tr><td>Key Management (KMS)</td><td>HSM key generation, signing, verification</td><td class="mono">/api/v1/keys</td></tr>
        <tr><td>Policy Engine</td><td>Transaction limits, whitelists, velocity rules</td><td class="mono">/api/v1/policies</td></tr>
        <tr><td>RBAC</td><td>Roles, permissions, access control</td><td class="mono">/api/v1/roles</td></tr>
      </tbody>
    </table>

    <h3>Supported Blockchains</h3>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
      ${['bitcoin', 'ethereum', 'solana', 'polygon', 'bsc', 'arbitrum', 'tron', 'avalanche', 'litecoin'].map(c =>
        `<span class="vault-card-chain-pill"><span class="chain-dot chain-dot-${c}"></span>${c}</span>`
      ).join('')}
    </div>
  `);
}

function buildAuthSection() {
  return section('authentication', 'Authentication', `
    <div class="api-notice api-notice-warning">
      <strong>Production Requirement:</strong> In production, all API requests must include authentication. The platform supports JWT Bearer tokens and API key authentication.
    </div>

    <h3>JWT Bearer Token</h3>
    ${codeBlock(`curl -X GET ${window.location.origin}/api/v1/wallets \\
  -H "Authorization: Bearer <your-jwt-token>" \\
  -H "Content-Type: application/json"`, 'bash')}

    <h3>API Key</h3>
    ${codeBlock(`curl -X GET ${window.location.origin}/api/v1/wallets \\
  -H "X-API-Key: <your-api-key>" \\
  -H "Content-Type: application/json"`, 'bash')}

    <h3>Rate Limits</h3>
    <table>
      <thead><tr><th>Tier</th><th>Requests/min</th><th>Burst</th></tr></thead>
      <tbody>
        <tr><td>Standard</td><td>60</td><td>10</td></tr>
        <tr><td>Professional</td><td>300</td><td>50</td></tr>
        <tr><td>Enterprise</td><td>1,000</td><td>200</td></tr>
      </tbody>
    </table>
  `);
}

function buildVaultsSection() {
  return section('vaults', 'Vaults', `
    <p>Vaults are secure containers that group related wallets. Every wallet must belong to a vault. Vaults provide organizational isolation for institutional clients.</p>

    ${endpoint('POST', '/api/v1/vaults', 'Create a new vault',
      `{
  "name": "Treasury Vault",
  "description": "Main institutional holdings"
}`,
      `{
  "id": "bde4aa0e-dc7d-44bd-b402-2ef3b4e26edf",
  "name": "Treasury Vault",
  "description": "Main institutional holdings",
  "walletIds": [],
  "status": "active",
  "createdAt": "2026-03-30T21:11:05.389Z",
  "updatedAt": "2026-03-30T21:11:05.389Z"
}`)}

    ${endpoint('GET', '/api/v1/vaults', 'List all vaults', null,
      `{
  "vaults": [{ ... }],
  "count": 2
}`)}

    ${endpoint('GET', '/api/v1/vaults/:id', 'Get vault by ID')}

    ${endpoint('POST', '/api/v1/vaults/:id/wallets', 'Create wallet inside vault',
      `{
  "name": "ETH Hot Wallet",
  "chain": "ethereum",
  "initialBalance": "0"
}`,
      `{
  "id": "615f9c76-...",
  "vaultId": "bde4aa0e-...",
  "name": "ETH Hot Wallet",
  "chain": "ethereum",
  "algorithm": "EC_SECP256K1",
  "address": "0x88b8f97aAFDDbC6bb874F19a3CbaAC97a0304532",
  "publicKey": "04410421f853...",
  "balance": "0",
  "currency": "ETH",
  "status": "active"
}`)}

    ${endpoint('GET', '/api/v1/vaults/:id/wallets', 'List wallets in vault')}
  `);
}

function buildWalletsSection() {
  return section('wallets', 'Wallets', `
    <p>Wallets represent blockchain addresses with HSM-backed private keys. Each wallet is bound to a specific chain and vault. The private key is generated inside the HSM and <strong>never leaves</strong> the secure enclave.</p>

    <h3>Wallet Lifecycle</h3>
    <ol style="color:var(--text-secondary);font-size:13px;line-height:1.8">
      <li>Key pair generated in HSM (non-extractable)</li>
      <li>Public key extracted, blockchain address derived</li>
      <li>Wallet record created with address, chain, vault association</li>
      <li>Policies attached for transfer governance</li>
      <li>Transfers signed inside HSM after policy evaluation</li>
    </ol>

    ${endpoint('POST', '/api/v1/wallets', 'Create a standalone wallet',
      `{
  "name": "BTC Cold Storage",
  "chain": "bitcoin",
  "vaultId": "bde4aa0e-...",
  "initialBalance": "0"
}`)}

    ${endpoint('GET', '/api/v1/wallets', 'List all wallets', null,
      `{
  "wallets": [{
    "id": "f5626c4c-...",
    "name": "BTC Hot Wallet",
    "chain": "bitcoin",
    "address": "bc1q8yy0s8waz65dcgnwf7uyumx2wx8hfglndv6fa2",
    "balance": "100000000",
    "currency": "BTC",
    "status": "active",
    "policyIds": []
  }],
  "count": 1
}`)}

    ${endpoint('GET', '/api/v1/wallets/:id', 'Get wallet details')}

    ${endpoint('POST', '/api/v1/wallets/:id/policies', 'Attach policy to wallet',
      `{ "policyId": "5801704f-..." }`)}

    ${endpoint('DELETE', '/api/v1/wallets/:id/policies/:policyId', 'Detach policy from wallet')}
  `);
}

function buildTransactionsSection() {
  return section('transactions', 'Transactions', `
    <p>Transfers move value between wallets. Every transfer goes through: <strong>balance check &rarr; policy evaluation &rarr; HSM signing &rarr; state update</strong>. If any policy fails, the transaction is recorded as <code>rejected</code> with the failure reason.</p>

    <h3>Transaction States</h3>
    <div style="display:flex;gap:8px;margin:12px 0">
      <span class="badge badge-pending">pending</span>
      <span class="badge badge-completed">completed</span>
      <span class="badge badge-rejected">rejected</span>
      <span class="badge badge-rejected">failed</span>
    </div>

    ${endpoint('POST', '/api/v1/wallets/:id/transfer', 'Execute a transfer',
      `{
  "toWalletId": "615f9c76-...",
  "amount": "100000000000000000",
  "currency": "ETH",
  "memo": "Treasury rebalance"
}`,
      `{
  "id": "tx-a1b2c3...",
  "fromWalletId": "f5626c4c-...",
  "toWalletId": "615f9c76-...",
  "amount": "100000000000000000",
  "currency": "ETH",
  "status": "completed",
  "signature": "304402206d2f...",
  "policyEvaluations": [
    { "policyId": "...", "policyName": "Standard Limits", "passed": true }
  ],
  "memo": "Treasury rebalance",
  "createdAt": "2026-03-30T22:01:18.300Z"
}`)}

    ${endpoint('GET', '/api/v1/wallets/:id/transactions', 'Get wallet transaction history', null,
      `{
  "transactions": [{ ... }],
  "count": 5
}`)}

    <h3>Transfer Flow</h3>
    ${codeBlock(`1. Client sends POST /wallets/:id/transfer
2. Server validates: balance >= amount
3. Policy Engine evaluates all attached policies:
   - spending_limit: amount <= maxAmount
   - daily_limit: today's total + amount <= dailyMax
   - whitelist: toWalletId in allowed list
   - blacklist: toWalletId not in blocked list
   - velocity: tx count in window <= max
   - time_window: current time within allowed hours
4. If any policy fails → status: "rejected", failureReason logged
5. If all pass → HSM signs transaction hash
6. Balances updated atomically
7. Transaction persisted with signature + evaluations`, 'text')}
  `);
}

function buildKeysSection() {
  return section('keys', 'Key Management', `
    <p>The KMS service manages cryptographic keys stored in the Luna Cloud HSM. Keys are generated inside the HSM as <strong>non-extractable</strong> objects. All signing operations happen within the HSM secure boundary.</p>

    <h3>Supported Algorithms</h3>
    <table>
      <thead><tr><th>Algorithm</th><th>Use Case</th><th>Curve/Size</th></tr></thead>
      <tbody>
        <tr><td class="mono">EC_SECP256K1</td><td>Bitcoin, Ethereum, EVM chains</td><td>secp256k1</td></tr>
        <tr><td class="mono">EC_P256</td><td>General purpose, TLS</td><td>NIST P-256</td></tr>
        <tr><td class="mono">EC_P384</td><td>High security</td><td>NIST P-384</td></tr>
        <tr><td class="mono">ED25519</td><td>Solana</td><td>Ed25519</td></tr>
        <tr><td class="mono">RSA_2048</td><td>Legacy systems</td><td>2048-bit</td></tr>
        <tr><td class="mono">RSA_4096</td><td>High security RSA</td><td>4096-bit</td></tr>
      </tbody>
    </table>

    ${endpoint('POST', '/api/v1/keys', 'Generate key pair in HSM',
      `{
  "algorithm": "EC_SECP256K1",
  "label": "eth-signing-key"
}`,
      `{
  "keyId": "8daa9a4f-...",
  "algorithm": "EC_SECP256K1",
  "publicKey": "04410458ee1cd6e6ad366d...",
  "createdAt": "2026-03-30T21:59:12.478Z"
}`)}

    ${endpoint('POST', '/api/v1/keys/:keyId/sign', 'Sign data with HSM key',
      `{
  "data": "f3e4e87290ae250f1c02b4e2b9c7f3a82de62a91...",
  "algorithm": "EC_SECP256K1"
}`,
      `{
  "signature": "79d4872f2d6ef585f03ae02b...",
  "keyId": "8daa9a4f-...",
  "algorithm": "EC_SECP256K1",
  "mechanism": "CKM_ECDSA"
}`)}

    ${endpoint('POST', '/api/v1/keys/:keyId/verify', 'Verify signature',
      `{
  "data": "f3e4e87290ae250f...",
  "signature": "79d4872f2d6ef585..."
}`,
      `{ "valid": true, "keyId": "8daa9a4f-..." }`)}

    ${endpoint('GET', '/api/v1/keys', 'List all keys')}
    ${endpoint('DELETE', '/api/v1/keys/:keyId', 'Delete key pair from HSM')}
  `);
}

function buildPoliciesSection() {
  return section('policies', 'Policy Engine', `
    <p>Policies define rules that govern wallet transfers. When a transfer is initiated, all policies attached to the source wallet are evaluated. If <strong>any rule fails</strong>, the transfer is rejected and the failure reason is recorded.</p>

    <h3>Rule Types</h3>
    <table>
      <thead><tr><th>Rule</th><th>Description</th><th>Parameters</th></tr></thead>
      <tbody>
        <tr><td class="mono">spending_limit</td><td>Max amount per transaction</td><td><code>maxAmount</code></td></tr>
        <tr><td class="mono">daily_limit</td><td>Max total amount per 24h</td><td><code>dailyMax</code></td></tr>
        <tr><td class="mono">whitelist</td><td>Only allow transfers to listed wallets</td><td><code>walletIds[]</code></td></tr>
        <tr><td class="mono">blacklist</td><td>Block transfers to listed wallets</td><td><code>walletIds[]</code></td></tr>
        <tr><td class="mono">velocity</td><td>Max transaction count in time window</td><td><code>maxCount, windowHours</code></td></tr>
        <tr><td class="mono">approval_threshold</td><td>Require N approvals for large transfers</td><td><code>threshold, amount</code></td></tr>
        <tr><td class="mono">time_window</td><td>Allow transfers only during set hours</td><td><code>startHour, endHour, timezone</code></td></tr>
      </tbody>
    </table>

    ${endpoint('POST', '/api/v1/policies', 'Create policy',
      `{
  "name": "Standard Limits",
  "description": "Max 5000 per transaction",
  "rules": [
    { "type": "spending_limit", "params": { "maxAmount": "5000000000" } },
    { "type": "daily_limit", "params": { "dailyMax": "50000000000" } }
  ]
}`,
      `{
  "id": "5801704f-...",
  "name": "Standard Limits",
  "rules": [{ ... }],
  "enabled": true
}`)}

    ${endpoint('GET', '/api/v1/policies', 'List policies')}
    ${endpoint('GET', '/api/v1/policies/:id', 'Get policy')}
    ${endpoint('PUT', '/api/v1/policies/:id', 'Update policy')}
    ${endpoint('DELETE', '/api/v1/policies/:id', 'Delete policy')}
  `);
}

function buildRbacSection() {
  return section('rbac', 'Roles & Permissions', `
    <p>Role-Based Access Control (RBAC) defines what actions users can perform. Three managed roles are seeded by default and cannot be deleted.</p>

    <h3>Default Roles</h3>
    <table>
      <thead><tr><th>Role</th><th>Description</th><th>Permissions</th></tr></thead>
      <tbody>
        <tr><td><strong>Admin</strong></td><td>Full access to all operations</td><td>All 25 permissions</td></tr>
        <tr><td><strong>Operator</strong></td><td>Manage wallets, execute transfers</td><td>Create/Read wallets, Transfer, Sign, Read policies</td></tr>
        <tr><td><strong>Viewer</strong></td><td>Read-only access</td><td>Read vaults, wallets, keys, policies, roles</td></tr>
      </tbody>
    </table>

    <h3>Permission Groups</h3>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
      ${['Vaults', 'Wallets', 'Keys', 'Policies', 'Roles', 'Users', 'AuditLogs'].map(g =>
        `<span class="vault-card-chain-pill">${g}</span>`
      ).join('')}
    </div>

    ${endpoint('GET', '/api/v1/roles', 'List all roles')}
    ${endpoint('POST', '/api/v1/roles', 'Create custom role',
      `{
  "name": "Compliance Officer",
  "description": "Review transactions and policies",
  "permissions": ["Wallets:Read", "Policies:Read", "Policies:Approve", "AuditLogs:Read"]
}`)}
    ${endpoint('GET', '/api/v1/permissions', 'List all available permissions')}
  `);
}

function buildHealthSection() {
  return section('health', 'Health', `
    <p>The health endpoint returns the operational status of the API server and HSM connection. Use this for monitoring and load balancer health checks.</p>

    ${endpoint('GET', '/health', 'System health check', null,
      `{
  "service": "waas-kms",
  "status": "healthy",
  "hsm": {
    "connected": true,
    "slotInfo": {
      "slotDescription": "SoftHSM slot ID 0x...",
      "manufacturerId": "SoftHSM project",
      "firmwareVersion": "2.7"
    },
    "tokenInfo": {
      "label": "waas-dev",
      "model": "SoftHSM v2",
      "serialNumber": "f2e7c809b4afaa97"
    }
  },
  "timestamp": "2026-03-30T21:53:42.614Z"
}`)}

    <h3>Status Codes</h3>
    <table>
      <thead><tr><th>Code</th><th>Status</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td class="mono">200</td><td>healthy</td><td>All systems operational, HSM connected</td></tr>
        <tr><td class="mono">503</td><td>degraded</td><td>HSM disconnected or service issue</td></tr>
      </tbody>
    </table>
  `);
}

function buildDashboardSection() {
  return section('dashboard', 'Dashboard & Analytics', `
    <p>Dashboard endpoints provide aggregated analytics and a global transaction feed across all wallets and vaults.</p>

    ${endpoint('GET', '/api/v1/dashboard/stats', 'Get platform analytics', null,
      `{
  "vaults": 2,
  "wallets": 4,
  "chains": 3,
  "activePolicies": 1,
  "totalPolicies": 1,
  "roles": 3,
  "transactionsToday": 6,
  "completedToday": 5,
  "rejectedToday": 1,
  "pendingApprovals": 0,
  "volumeToday": "500000000000000000",
  "volumeByCurrency": { "ETH": "500000000000000000" },
  "aumByCurrency": { "BTC": "100000000", "ETH": "15000000000000000000" },
  "totalTransactions": 6
}`)}

    ${endpoint('GET', '/api/v1/dashboard/transactions?limit=50&offset=0', 'Global transaction feed', null,
      `{
  "transactions": [{ ... }],
  "count": 50
}`)}
  `);
}

function buildArchitectureSection() {
  return section('architecture', 'Architecture', `
    <h3>Platform Architecture</h3>
    <p>The WaaS platform follows a layered microservices architecture with HSM-first security.</p>

    <table>
      <thead><tr><th>Layer</th><th>Component</th><th>Technology</th></tr></thead>
      <tbody>
        <tr><td>API Layer</td><td>API Gateway</td><td>Express.js, Helmet, CORS, Zod validation</td></tr>
        <tr><td rowspan="5">Core Services</td><td>Wallet Service</td><td>Address generation, balance management</td></tr>
        <tr><td>KMS Service</td><td>HSM key ops via PKCS#11</td></tr>
        <tr><td>Signing Service</td><td>Transaction signing in HSM</td></tr>
        <tr><td>Policy Engine</td><td>7 rule types, inline evaluation</td></tr>
        <tr><td>RBAC Service</td><td>25 permissions, 3 default roles</td></tr>
        <tr><td>Security Layer</td><td>Luna Cloud HSM</td><td>FIPS 140-3, non-extractable keys, PKCS#11</td></tr>
        <tr><td>Data Layer</td><td>Data Store</td><td>In-memory (dev) / PostgreSQL (prod)</td></tr>
      </tbody>
    </table>

    <h3>Security Model</h3>
    <ul style="color:var(--text-secondary);font-size:13px;line-height:2">
      <li>Private keys generated and stored exclusively in HSM (non-extractable)</li>
      <li>All signing operations performed within HSM secure boundary</li>
      <li>Public key extraction only for address derivation</li>
      <li>Policy evaluation before every transfer</li>
      <li>Transaction signatures stored as audit trail</li>
      <li>RBAC enforces least-privilege access</li>
    </ul>

    <h3>Supported Chains & Algorithms</h3>
    <table>
      <thead><tr><th>Chain</th><th>Algorithm</th><th>Address Format</th></tr></thead>
      <tbody>
        <tr><td>Bitcoin</td><td>EC_SECP256K1</td><td>P2WPKH (bech32)</td></tr>
        <tr><td>Ethereum</td><td>EC_SECP256K1</td><td>EIP-55 checksum</td></tr>
        <tr><td>Solana</td><td>ED25519</td><td>Base58</td></tr>
        <tr><td>Polygon, BSC, Arbitrum</td><td>EC_SECP256K1</td><td>EIP-55 (EVM)</td></tr>
        <tr><td>Tron</td><td>EC_SECP256K1</td><td>Base58Check</td></tr>
        <tr><td>Litecoin</td><td>EC_SECP256K1</td><td>P2WPKH (bech32)</td></tr>
        <tr><td>Avalanche</td><td>EC_SECP256K1</td><td>EIP-55 (EVM)</td></tr>
      </tbody>
    </table>
  `);
}

function buildErrorsSection() {
  return section('errors', 'Error Handling', `
    <p>All API errors return a consistent JSON format with an <code>error</code> field and optional <code>details</code> array for validation errors.</p>

    <h3>Error Response Format</h3>
    ${codeBlock(`{
  "error": "Validation failed",
  "details": [
    { "field": "name", "message": "Required" },
    { "field": "chain", "message": "Invalid enum value" }
  ]
}`, 'json')}

    <h3>HTTP Status Codes</h3>
    <table>
      <thead><tr><th>Code</th><th>Meaning</th><th>Example</th></tr></thead>
      <tbody>
        <tr><td class="mono">200</td><td>Success</td><td>Resource returned or updated</td></tr>
        <tr><td class="mono">201</td><td>Created</td><td>New resource created</td></tr>
        <tr><td class="mono">400</td><td>Bad Request</td><td>Validation error, missing fields</td></tr>
        <tr><td class="mono">404</td><td>Not Found</td><td>Resource does not exist</td></tr>
        <tr><td class="mono">409</td><td>Conflict</td><td>Duplicate resource</td></tr>
        <tr><td class="mono">500</td><td>Internal Error</td><td>HSM failure, store error</td></tr>
        <tr><td class="mono">503</td><td>Service Unavailable</td><td>HSM disconnected</td></tr>
      </tbody>
    </table>

    <h3>Common Errors</h3>
    <table>
      <thead><tr><th>Error</th><th>Cause</th><th>Resolution</th></tr></thead>
      <tbody>
        <tr><td>Insufficient balance</td><td>Transfer amount exceeds wallet balance</td><td>Check balance, reduce amount</td></tr>
        <tr><td>Policy violation</td><td>Transfer blocked by attached policy</td><td>Review policy rules, request approval</td></tr>
        <tr><td>Wallet not found</td><td>Invalid wallet ID</td><td>Verify ID with GET /wallets</td></tr>
        <tr><td>HSM signing failed</td><td>HSM session issue</td><td>Check /health, restart if needed</td></tr>
      </tbody>
    </table>
  `);
}

// ─── Helpers ─────────────────────────────────────────────────

function section(id, title, content) {
  return `<div class="api-section" id="section-${id}">
    <h2 class="api-section-title">${title}</h2>
    ${content}
  </div>`;
}

function endpoint(method, path, description, requestBody, responseBody) {
  const methodClass = method.toLowerCase();
  return `
    <div class="api-endpoint">
      <div class="api-endpoint-header">
        <span class="api-method api-method-${methodClass}">${method}</span>
        <code class="api-path">${path}</code>
      </div>
      <p class="api-endpoint-desc">${description}</p>
      ${requestBody ? `<div class="api-body-label">Request Body</div>${codeBlock(requestBody, 'json')}` : ''}
      ${responseBody ? `<div class="api-body-label">Response</div>${codeBlock(responseBody, 'json')}` : ''}
    </div>`;
}

function codeBlock(code, lang) {
  return `<pre class="api-code"><code>${escapeHtml(code)}</code></pre>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
