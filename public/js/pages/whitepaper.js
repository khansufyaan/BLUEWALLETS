import { api } from '../api.js';

export async function renderWhitepaper() {
  try {
    const health = await api.health();
    const hsm = health.hsm || {};
    const token = hsm.tokenInfo || {};

    return `
      <div class="wp">
        <div class="wp-sidebar">
          <div style="padding:16px 16px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">Contents</div>
          <nav class="api-docs-nav" id="wp-nav">
            <a href="#wp-abstract" class="api-nav-item active">Abstract</a>
            <a href="#wp-architecture" class="api-nav-item">Platform Architecture</a>
            <a href="#wp-clients" class="api-nav-item">Client Layer</a>
            <a href="#wp-api-gateway" class="api-nav-item">API Gateway</a>
            <a href="#wp-core-services" class="api-nav-item">Core Services</a>
            <a href="#wp-hsm" class="api-nav-item">HSM Cluster</a>
            <a href="#wp-data-layer" class="api-nav-item">Data Layer</a>
            <a href="#wp-security" class="api-nav-item">Security Model</a>
            <a href="#wp-transaction-flow" class="api-nav-item">Transaction Lifecycle</a>
            <a href="#wp-chains" class="api-nav-item">Chain Support</a>
            <a href="#wp-policy" class="api-nav-item">Policy Framework</a>
            <a href="#wp-deployment" class="api-nav-item">Deployment</a>
          </nav>
        </div>
        <div class="wp-content" id="wp-content">

          ${wpSection('abstract', 'Blue Wallets — Technical Whitepaper', `
            <div class="wp-meta">
              <span>Version 1.0</span>
              <span>&middot;</span>
              <span>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</span>
              <span>&middot;</span>
              <span>Confidential</span>
            </div>

            <div class="wp-abstract-box">
              <h3>Abstract</h3>
              <p>Blue Wallets is an enterprise Wallet-as-a-Service (WaaS) platform that provides institutional-grade digital asset custody. The platform enables fintechs and banks to create, manage, and secure blockchain wallets without building cryptographic infrastructure from scratch.</p>
              <p>All private keys are generated and stored exclusively within FIPS 140-3 Level 3 certified Hardware Security Modules (HSMs). Keys are non-extractable — signing operations occur inside the HSM secure boundary, ensuring that key material is never exposed to application code, memory, or network.</p>
              <p>The platform provides a layered microservices architecture with an API gateway, four core services (Client, Wallet, Signing, Policy), an HSM cluster with active-active replication, and a persistent data layer with read replicas.</p>
            </div>

            <h3>Design Principles</h3>
            <div class="wp-principles">
              <div class="wp-principle">
                <div class="wp-principle-num">01</div>
                <div>
                  <h4>HSM-First Security</h4>
                  <p>Private keys never exist outside the HSM. All cryptographic operations — key generation, signing, verification — happen within the FIPS 140-3 certified secure boundary. The application layer only handles public keys and signatures.</p>
                </div>
              </div>
              <div class="wp-principle">
                <div class="wp-principle-num">02</div>
                <div>
                  <h4>Policy Before Signing</h4>
                  <p>Every transaction is evaluated against configurable policy rules before the HSM is invoked. Spending limits, velocity controls, whitelists, time windows, and approval thresholds are enforced at the service layer, creating a programmable governance framework.</p>
                </div>
              </div>
              <div class="wp-principle">
                <div class="wp-principle-num">03</div>
                <div>
                  <h4>Separation of Concerns</h4>
                  <p>Each core service owns a single domain: key management, wallet operations, transaction signing, and policy evaluation. Services communicate through well-defined interfaces, enabling independent scaling and failure isolation.</p>
                </div>
              </div>
              <div class="wp-principle">
                <div class="wp-principle-num">04</div>
                <div>
                  <h4>Non-Extractable Key Architecture</h4>
                  <p>HSM keys are created with the <code>CKA_EXTRACTABLE = false</code> attribute. This is enforced at the PKCS#11 level, meaning even a compromised application server cannot export private key material. Address derivation uses only the public key component.</p>
                </div>
              </div>
              <div class="wp-principle">
                <div class="wp-principle-num">05</div>
                <div>
                  <h4>Immutable Audit Trail</h4>
                  <p>Every transaction records the HSM signature, signed payload, policy evaluation results, and failure reasons. This creates a tamper-evident chain of custody for every operation.</p>
                </div>
              </div>
            </div>
          `)}

          ${wpSection('architecture', 'Platform Architecture', `
            <p>The platform follows a four-layer architecture designed for institutional custody workloads. Each layer has distinct security boundaries and scaling characteristics.</p>

            <div class="wp-layers">
              <div class="wp-layer">
                <div class="wp-layer-label">Layer 1</div>
                <div class="wp-layer-title">Client Layer</div>
                <div class="wp-layer-desc">Fintechs, banks, and institutional clients connect via REST APIs or broadcast signed transactions directly to blockchain networks.</div>
              </div>
              <div class="wp-layer">
                <div class="wp-layer-label">Layer 2</div>
                <div class="wp-layer-title">API Gateway</div>
                <div class="wp-layer-desc">Authentication, rate limiting, request routing, and input validation. Single entry point for all client traffic.</div>
              </div>
              <div class="wp-layer">
                <div class="wp-layer-label">Layer 3</div>
                <div class="wp-layer-title">Core Services</div>
                <div class="wp-layer-desc">Four microservices: Client Service (onboarding, key management), Wallet Service (address generation), Signing Service (transaction signing), Policy Engine (limits, rules, approvals).</div>
              </div>
              <div class="wp-layer">
                <div class="wp-layer-label">Layer 4</div>
                <div class="wp-layer-title">Infrastructure</div>
                <div class="wp-layer-desc">HSM Cluster (active-active with standby) for cryptographic operations. Primary database with read replicas for persistent storage.</div>
              </div>
            </div>
          `)}

          ${wpSection('clients', 'Client Layer', `
            <p>The platform serves two primary client types, each with distinct integration patterns:</p>

            <h3>Fintech Clients</h3>
            <p>Fintech companies integrate via REST API to programmatically create wallets, execute transfers, and manage policies. Typical use cases include neobanks offering crypto custody to end users, payment processors settling cross-border transactions, and DeFi platforms requiring institutional-grade key management.</p>

            <h3>Banking Clients</h3>
            <p>Traditional financial institutions connect through the same REST API but with enhanced compliance requirements. Banks typically require multi-signature approval workflows, segregated vault structures per business unit, and comprehensive audit trails for regulatory reporting.</p>

            <h3>Integration Patterns</h3>
            <table>
              <thead><tr><th>Pattern</th><th>Description</th><th>Use Case</th></tr></thead>
              <tbody>
                <tr><td>REST API</td><td>Standard HTTP JSON endpoints for wallet and transaction management</td><td>General-purpose integration</td></tr>
                <tr><td>Broadcast Signed Tx</td><td>Client receives signed transaction payload, broadcasts to blockchain network independently</td><td>Clients with existing node infrastructure</td></tr>
                <tr><td>Webhook Callbacks</td><td>Platform notifies client of transaction status changes</td><td>Asynchronous settlement workflows</td></tr>
              </tbody>
            </table>
          `)}

          ${wpSection('api-gateway', 'API Gateway', `
            <p>The API Gateway is the single entry point for all client traffic. It enforces security policies before requests reach core services.</p>

            <h3>Responsibilities</h3>
            <table>
              <thead><tr><th>Function</th><th>Implementation</th><th>Details</th></tr></thead>
              <tbody>
                <tr><td><strong>Authentication</strong></td><td>JWT Bearer / API Key</td><td>Validates identity on every request. Tokens issued by identity provider with configurable expiry.</td></tr>
                <tr><td><strong>Rate Limiting</strong></td><td>Per-client throttling</td><td>Standard: 60 req/min. Enterprise: 1,000 req/min. Burst allowance for peak operations.</td></tr>
                <tr><td><strong>Routing</strong></td><td>Path-based routing</td><td>Routes to core services based on URL path prefix (<code>/vaults</code>, <code>/wallets</code>, <code>/keys</code>, <code>/policies</code>).</td></tr>
                <tr><td><strong>Validation</strong></td><td>Zod schema validation</td><td>Request bodies validated against strict schemas. Rejects malformed input with detailed field-level errors.</td></tr>
                <tr><td><strong>Security Headers</strong></td><td>Helmet middleware</td><td>CSP, X-Frame-Options, HSTS, X-Content-Type-Options enforced on all responses.</td></tr>
              </tbody>
            </table>
          `)}

          ${wpSection('core-services', 'Core Services', `
            <p>The platform is composed of four core services, each responsible for a single domain. Services are deployed as independent processes that communicate through internal interfaces.</p>

            <div class="wp-service-grid">
              <div class="wp-service-card">
                <div class="wp-service-header">
                  <div class="wp-service-icon" style="background:rgba(37,99,235,0.15);color:var(--blue-400)">C</div>
                  <div>
                    <h4>Client Service</h4>
                    <p class="text-xs text-tertiary">Onboarding &amp; Key Management</p>
                  </div>
                </div>
                <ul>
                  <li>Client onboarding and identity management</li>
                  <li>HSM key pair generation (EC, RSA, EdDSA)</li>
                  <li>Key lifecycle: create, list, rotate, delete</li>
                  <li>Public key extraction for address derivation</li>
                  <li>Supported algorithms: EC_SECP256K1, EC_P256, EC_P384, ED25519, RSA_2048, RSA_4096</li>
                </ul>
              </div>
              <div class="wp-service-card">
                <div class="wp-service-header">
                  <div class="wp-service-icon" style="background:rgba(16,185,129,0.15);color:var(--emerald)">W</div>
                  <div>
                    <h4>Wallet Service</h4>
                    <p class="text-xs text-tertiary">Address Generation &amp; Balance Management</p>
                  </div>
                </div>
                <ul>
                  <li>Blockchain address derivation from HSM public keys</li>
                  <li>Multi-chain support: Bitcoin (P2WPKH), Ethereum (EIP-55), Solana (Base58), Tron, EVM chains</li>
                  <li>Balance tracking and transfer execution</li>
                  <li>Vault-based wallet organization</li>
                  <li>Policy attachment and enforcement</li>
                </ul>
              </div>
              <div class="wp-service-card">
                <div class="wp-service-header">
                  <div class="wp-service-icon" style="background:rgba(124,58,237,0.15);color:#A78BFA">S</div>
                  <div>
                    <h4>Signing Service</h4>
                    <p class="text-xs text-tertiary">Transaction Signing</p>
                  </div>
                </div>
                <ul>
                  <li>Transaction hash signing inside HSM boundary</li>
                  <li>ECDSA (secp256k1, P-256, P-384) and EdDSA signing</li>
                  <li>Signature verification against stored public keys</li>
                  <li>Signed payload persistence for audit trail</li>
                  <li>PKCS#11 mechanisms: CKM_ECDSA, CKM_EDDSA, CKM_RSA_PKCS</li>
                </ul>
              </div>
              <div class="wp-service-card">
                <div class="wp-service-header">
                  <div class="wp-service-icon" style="background:rgba(245,158,11,0.15);color:var(--amber)">P</div>
                  <div>
                    <h4>Policy Engine</h4>
                    <p class="text-xs text-tertiary">Limits, Rules &amp; Approvals</p>
                  </div>
                </div>
                <ul>
                  <li>Per-transaction spending limits</li>
                  <li>Daily aggregate volume limits</li>
                  <li>Whitelist / blacklist destination controls</li>
                  <li>Velocity controls (max N transactions per window)</li>
                  <li>Time-window restrictions (business hours only)</li>
                  <li>Multi-signature approval thresholds</li>
                </ul>
              </div>
            </div>
          `)}

          ${wpSection('hsm', 'HSM Cluster', `
            <p>The Hardware Security Module (HSM) cluster is the cryptographic foundation of the platform. All private key operations occur within the HSM's tamper-resistant boundary.</p>

            <h3>Cluster Topology</h3>
            <table>
              <thead><tr><th>Node</th><th>Role</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><strong>HSM Node 1</strong></td><td>Active</td><td>Primary node for key generation and signing operations</td></tr>
                <tr><td><strong>HSM Node 2</strong></td><td>Active</td><td>Load-balanced active node for high throughput</td></tr>
                <tr><td><strong>HSM Node 3</strong></td><td>Standby</td><td>Hot standby with replicated key material for disaster recovery</td></tr>
              </tbody>
            </table>

            <h3>Key Properties</h3>
            <table>
              <thead><tr><th>Attribute</th><th>Value</th><th>Significance</th></tr></thead>
              <tbody>
                <tr><td class="mono">CKA_EXTRACTABLE</td><td>FALSE</td><td>Private keys cannot be exported from HSM</td></tr>
                <tr><td class="mono">CKA_SENSITIVE</td><td>TRUE</td><td>Key material is marked as sensitive</td></tr>
                <tr><td class="mono">CKA_TOKEN</td><td>TRUE</td><td>Keys persist across HSM sessions</td></tr>
                <tr><td class="mono">CKA_SIGN</td><td>TRUE</td><td>Key can be used for signing</td></tr>
                <tr><td class="mono">CKA_VERIFY</td><td>TRUE</td><td>Public key can verify signatures</td></tr>
              </tbody>
            </table>

            <h3>Current Deployment</h3>
            <div class="wp-info-row">
              <span class="stat-label">HSM Status</span>
              <span class="stat-value" style="color:${hsm.connected ? 'var(--emerald)' : 'var(--red)'}">${hsm.connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div class="wp-info-row">
              <span class="stat-label">Partition</span>
              <span class="stat-value">${token.label || 'N/A'}</span>
            </div>
            <div class="wp-info-row">
              <span class="stat-label">Model</span>
              <span class="stat-value">${token.model || 'N/A'}</span>
            </div>
            <div class="wp-info-row">
              <span class="stat-label">Compliance</span>
              <span class="stat-value">FIPS 140-3 Level 3</span>
            </div>
            <div class="wp-info-row">
              <span class="stat-label">Interface</span>
              <span class="stat-value">PKCS#11 v2.40</span>
            </div>

            <h3>Replication</h3>
            <p>Key material is replicated between active HSM nodes using the vendor's built-in cloning mechanism. The standby node receives asynchronous replicas and can be promoted to active in under 30 seconds during a failover event. Key IDs and labels are consistent across all nodes.</p>
          `)}

          ${wpSection('data-layer', 'Data Layer', `
            <p>The data layer provides persistent storage for all platform entities. The architecture uses a primary-replica topology for high availability and read scaling.</p>

            <h3>Database Architecture</h3>
            <table>
              <thead><tr><th>Component</th><th>Role</th><th>Stored Data</th></tr></thead>
              <tbody>
                <tr><td><strong>Primary DB</strong></td><td>Read/Write</td><td>Clients, customers, addresses, key metadata, wallets, transactions, policies, roles</td></tr>
                <tr><td><strong>Replica DB</strong></td><td>Read Only</td><td>Synchronized copy for read-heavy queries (dashboards, analytics, auditing)</td></tr>
              </tbody>
            </table>

            <h3>Data Entities</h3>
            <table>
              <thead><tr><th>Entity</th><th>Key Fields</th><th>Relationships</th></tr></thead>
              <tbody>
                <tr><td>Vault</td><td>id, name, description, status</td><td>Contains N wallets</td></tr>
                <tr><td>Wallet</td><td>id, vaultId, chain, address, balance, keyId</td><td>Belongs to vault, references HSM key, has N policies</td></tr>
                <tr><td>Transaction</td><td>id, from, to, amount, status, signature</td><td>Between wallets, includes policy evaluations</td></tr>
                <tr><td>Policy</td><td>id, name, rules[], enabled</td><td>Attached to N wallets</td></tr>
                <tr><td>Role</td><td>id, name, permissions[]</td><td>Assigned to N users</td></tr>
              </tbody>
            </table>

            <h3>Current Implementation</h3>
            <p>The development environment uses in-memory stores for rapid iteration. Production deployments target PostgreSQL with connection pooling and automated failover.</p>
          `)}

          ${wpSection('security', 'Security Model', `
            <p>Security is enforced at every layer of the platform. The architecture follows a defense-in-depth strategy with multiple independent security boundaries.</p>

            <div class="wp-security-layers">
              <div class="wp-security-layer">
                <h4>Network Layer</h4>
                <ul>
                  <li>TLS 1.3 for all client connections</li>
                  <li>mTLS for service-to-service communication</li>
                  <li>HSM accessible only from private subnet</li>
                  <li>API gateway as single ingress point</li>
                </ul>
              </div>
              <div class="wp-security-layer">
                <h4>Application Layer</h4>
                <ul>
                  <li>JWT/API key authentication on every request</li>
                  <li>RBAC with 25 granular permissions</li>
                  <li>Zod schema validation on all inputs</li>
                  <li>Helmet security headers (CSP, HSTS, X-Frame)</li>
                  <li>Rate limiting per client</li>
                </ul>
              </div>
              <div class="wp-security-layer">
                <h4>Cryptographic Layer</h4>
                <ul>
                  <li>FIPS 140-3 Level 3 HSM for all key operations</li>
                  <li>Non-extractable private keys (CKA_EXTRACTABLE=false)</li>
                  <li>Signing occurs only inside HSM boundary</li>
                  <li>Public key-only address derivation</li>
                  <li>Transaction signatures as immutable audit trail</li>
                </ul>
              </div>
              <div class="wp-security-layer">
                <h4>Data Layer</h4>
                <ul>
                  <li>Encryption at rest for database storage</li>
                  <li>No plaintext key material in application memory</li>
                  <li>Audit logging for all state mutations</li>
                  <li>Separate read replica for analytics (no write access)</li>
                </ul>
              </div>
            </div>
          `)}

          ${wpSection('transaction-flow', 'Transaction Lifecycle', `
            <p>Every transfer follows a deterministic pipeline that ensures balance integrity, policy compliance, and cryptographic accountability.</p>

            <div class="wp-flow-steps">
              <div class="wp-flow-step">
                <div class="wp-flow-num">1</div>
                <div>
                  <h4>Request Validation</h4>
                  <p>API gateway validates the transfer request schema: toWalletId, amount, currency, and optional memo. Invalid requests are rejected with 400 status.</p>
                </div>
              </div>
              <div class="wp-flow-step">
                <div class="wp-flow-num">2</div>
                <div>
                  <h4>Balance Verification</h4>
                  <p>Wallet Service checks that the source wallet has sufficient balance for the requested transfer amount. Insufficient balance returns an error without invoking the HSM.</p>
                </div>
              </div>
              <div class="wp-flow-step">
                <div class="wp-flow-num">3</div>
                <div>
                  <h4>Policy Evaluation</h4>
                  <p>Policy Engine evaluates all policies attached to the source wallet. Each rule type is checked independently. If any rule fails, the transaction is recorded as <code>rejected</code> with the specific failure reason.</p>
                </div>
              </div>
              <div class="wp-flow-step">
                <div class="wp-flow-num">4</div>
                <div>
                  <h4>HSM Signing</h4>
                  <p>The transaction hash is sent to the HSM for signing using the wallet's private key. The HSM returns the signature without exposing key material. The signing mechanism is determined by the key algorithm (ECDSA for secp256k1, EdDSA for Ed25519).</p>
                </div>
              </div>
              <div class="wp-flow-step">
                <div class="wp-flow-num">5</div>
                <div>
                  <h4>State Update</h4>
                  <p>Source wallet balance is decremented and destination wallet balance is incremented atomically. The transaction record is persisted with the signature, signed payload, policy evaluation results, and completion timestamp.</p>
                </div>
              </div>
              <div class="wp-flow-step">
                <div class="wp-flow-num">6</div>
                <div>
                  <h4>Response</h4>
                  <p>Client receives the completed transaction with status, signature, and all evaluation metadata. For rejected transactions, the response includes the specific policy rule that blocked the transfer.</p>
                </div>
              </div>
            </div>
          `)}

          ${wpSection('chains', 'Chain Support', `
            <p>The platform supports 9 blockchain networks through a unified address derivation layer. Each chain maps to a specific elliptic curve algorithm and address encoding scheme.</p>

            <table>
              <thead><tr><th>Chain</th><th>Algorithm</th><th>Address Format</th><th>Derivation Method</th></tr></thead>
              <tbody>
                <tr><td>Bitcoin</td><td>EC_SECP256K1</td><td>bech32 (bc1...)</td><td>Hash160 &rarr; 5-bit conversion &rarr; bech32 encode</td></tr>
                <tr><td>Ethereum</td><td>EC_SECP256K1</td><td>EIP-55 (0x...)</td><td>Keccak256 of uncompressed public key &rarr; last 20 bytes &rarr; checksum</td></tr>
                <tr><td>Solana</td><td>ED25519</td><td>Base58</td><td>Raw public key &rarr; Base58 encode</td></tr>
                <tr><td>Polygon</td><td>EC_SECP256K1</td><td>EIP-55 (0x...)</td><td>Same as Ethereum (EVM compatible)</td></tr>
                <tr><td>BSC</td><td>EC_SECP256K1</td><td>EIP-55 (0x...)</td><td>Same as Ethereum (EVM compatible)</td></tr>
                <tr><td>Arbitrum</td><td>EC_SECP256K1</td><td>EIP-55 (0x...)</td><td>Same as Ethereum (EVM compatible)</td></tr>
                <tr><td>Tron</td><td>EC_SECP256K1</td><td>Base58Check (T...)</td><td>Keccak256 &rarr; 0x41 prefix &rarr; double SHA256 checksum</td></tr>
                <tr><td>Avalanche</td><td>EC_SECP256K1</td><td>EIP-55 (0x...)</td><td>Same as Ethereum (EVM compatible)</td></tr>
                <tr><td>Litecoin</td><td>EC_SECP256K1</td><td>bech32 (ltc1...)</td><td>Same as Bitcoin with ltc prefix</td></tr>
              </tbody>
            </table>

            <p>All address derivation uses only the <strong>public key</strong> component. The private key remains inside the HSM and is never accessed during address generation.</p>
          `)}

          ${wpSection('policy', 'Policy Framework', `
            <p>The policy framework provides configurable governance rules that are evaluated before every transaction is signed. Policies are composable — multiple rules can be combined within a single policy, and multiple policies can be attached to a single wallet.</p>

            <h3>Rule Types</h3>
            <div class="wp-rule-grid">
              <div class="wp-rule-card">
                <h4>Spending Limit</h4>
                <p>Caps the maximum amount per individual transaction. Prevents unauthorized large transfers.</p>
                <div class="wp-rule-param">maxAmount: string (smallest unit)</div>
              </div>
              <div class="wp-rule-card">
                <h4>Daily Limit</h4>
                <p>Caps the aggregate transfer volume within a 24-hour rolling window.</p>
                <div class="wp-rule-param">dailyMax: string (smallest unit)</div>
              </div>
              <div class="wp-rule-card">
                <h4>Whitelist</h4>
                <p>Restricts transfers to a pre-approved set of destination wallet IDs.</p>
                <div class="wp-rule-param">walletIds: string[]</div>
              </div>
              <div class="wp-rule-card">
                <h4>Blacklist</h4>
                <p>Blocks transfers to specific wallet IDs. Useful for sanctions compliance.</p>
                <div class="wp-rule-param">walletIds: string[]</div>
              </div>
              <div class="wp-rule-card">
                <h4>Velocity</h4>
                <p>Limits the number of transactions allowed within a time window.</p>
                <div class="wp-rule-param">maxCount: number, windowHours: number</div>
              </div>
              <div class="wp-rule-card">
                <h4>Time Window</h4>
                <p>Restricts transfers to specific hours of the day (e.g., business hours only).</p>
                <div class="wp-rule-param">startHour: number, endHour: number</div>
              </div>
            </div>

            <h3>Evaluation Logic</h3>
            <p>When a transfer is initiated, all policies attached to the source wallet are retrieved. Each policy's rules are evaluated independently. If <strong>any single rule</strong> fails across any policy, the entire transaction is rejected. The failure reason identifies the specific policy and rule that blocked the transfer.</p>
          `)}

          ${wpSection('deployment', 'Deployment Architecture', `
            <p>The platform is containerized and deployable across cloud environments with infrastructure-as-code.</p>

            <h3>Container Architecture</h3>
            <table>
              <thead><tr><th>Container</th><th>Image</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td>waas-kms</td><td>Node.js 22 Alpine</td><td>API server + core services</td></tr>
                <tr><td>luna-client</td><td>Luna HSM Client</td><td>PKCS#11 library + HSM connectivity</td></tr>
              </tbody>
            </table>

            <h3>Environment Configuration</h3>
            <table>
              <thead><tr><th>Variable</th><th>Description</th><th>Example</th></tr></thead>
              <tbody>
                <tr><td class="mono">HSM_USE_SOFTHSM</td><td>Use SoftHSM for development</td><td>true</td></tr>
                <tr><td class="mono">SOFTHSM_LIB</td><td>Path to PKCS#11 library</td><td>/opt/homebrew/lib/softhsm/libsofthsm2.so</td></tr>
                <tr><td class="mono">HSM_SLOT_INDEX</td><td>HSM slot index</td><td>0</td></tr>
                <tr><td class="mono">HSM_PIN</td><td>HSM partition PIN</td><td>****</td></tr>
                <tr><td class="mono">HSM_LABEL</td><td>HSM token label</td><td>waas-dev</td></tr>
                <tr><td class="mono">PORT</td><td>Server port</td><td>3100</td></tr>
              </tbody>
            </table>

            <h3>Production Considerations</h3>
            <ul style="color:var(--text-secondary);font-size:13px;line-height:2">
              <li>Replace SoftHSM with Luna Cloud HSM or AWS CloudHSM</li>
              <li>Switch in-memory stores to PostgreSQL with connection pooling</li>
              <li>Enable TLS termination at load balancer</li>
              <li>Deploy HSM client containers in private subnet</li>
              <li>Configure automated key backup and disaster recovery</li>
              <li>Enable audit logging to immutable storage (S3, CloudWatch)</li>
            </ul>
          `)}

        </div>
      </div>
    `;
  } catch (err) {
    return `<div class="alert alert-error">${err.message}</div>`;
  }
}

export function initWhitepaper() {
  const content = document.getElementById('wp-content');
  const navItems = document.querySelectorAll('#wp-nav .api-nav-item');
  if (!content) return;

  content.addEventListener('scroll', () => {
    const sections = content.querySelectorAll('.wp-section');
    let current = '';
    sections.forEach(s => {
      if (s.offsetTop - content.scrollTop < 120) current = s.id;
    });
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('href') === `#${current}`);
    });
  });

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

function wpSection(id, title, content) {
  return `<div class="wp-section" id="wp-${id}">
    <h2 class="wp-section-title">${title}</h2>
    ${content}
  </div>`;
}
