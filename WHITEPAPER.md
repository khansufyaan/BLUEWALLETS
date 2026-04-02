# Blue Wallets — Technical White Paper

**The World's First Fully On-Premises Wallet-as-a-Service**

Version 1.0 | April 2026

---

## Executive Summary

Blue Wallets is an on-premises Wallet-as-a-Service (WaaS) platform built for regulated financial institutions. Unlike cloud-based MPC or smart wallet solutions, Blue Wallets runs entirely within the bank's own infrastructure, using FIPS 140-3 Level 3 certified Hardware Security Modules (HSMs) for all cryptographic operations.

Private key material never leaves the HSM boundary. Not in plaintext, not encrypted, not at any point in the lifecycle.

---

## 1. The Problem

Banks and regulated financial institutions face a fundamental conflict when offering digital asset custody:

- **Cloud custody solutions** (MPC wallets, smart wallets) store key material outside the institution's control, violating regulatory requirements for data sovereignty
- **Self-custody** requires deep cryptographic engineering expertise that most banks lack
- **Existing HSM solutions** don't scale — hardware key slots are limited to thousands, not the millions a bank needs

Blue Wallets solves all three: institutional-grade HSM security, fully on-premises, scaling to millions of wallets.

---

## 2. Architecture Overview

Blue Wallets uses a two-tier architecture that mirrors how banks already separate critical systems:

```
                    BANK'S INFRASTRUCTURE
    ┌─────────────────────────────────────────────────────┐
    │                                                     │
    │   SECURE ZONE (No Internet)     DMZ (Internet)      │
    │   ┌─────────────────────┐    ┌──────────────────┐   │
    │   │                     │    │                  │   │
    │   │   BLUE DRIVER       │    │  BLUE CONSOLE    │   │
    │   │   :3100 Dashboard   │◄──►│  :3300 Bank API  │──►│── RPC Nodes
    │   │   :3200 Internal API│mTLS│  :3400 Ops Portal│   │
    │   │                     │    │                  │   │
    │   │   ┌─────────────┐   │    │  Compliance      │   │
    │   │   │  Luna HSM   │   │    │  Gas Station     │   │
    │   │   │  PKCS#11    │   │    │  Deposit Monitor │   │
    │   │   │  FIPS 140-3 │   │    │  EVM Tx Builder  │   │
    │   │   └─────────────┘   │    │                  │   │
    │   │                     │    └──────────────────┘   │
    │   │   ┌─────────────┐   │                           │
    │   │   │ PostgreSQL  │   │                           │
    │   │   │ 8 tables    │   │                           │
    │   │   └─────────────┘   │                           │
    │   └─────────────────────┘                           │
    └─────────────────────────────────────────────────────┘
```

### Why Two Tiers?

**Blue Driver** sits in the bank's secure zone — the same network segment where core banking systems, HSMs, and databases live. It has no internet access. Its only job: manage keys and sign transactions.

**Blue Console** sits in the DMZ — it has internet access to reach blockchain RPC nodes, compliance APIs, and serves as the single API endpoint for the bank's applications.

They communicate over a dedicated internal network channel secured by mutual TLS (mTLS).

---

## 3. Blue Driver — The Secure Zone

### 3.1 What It Does

Blue Driver is the HSM connector and signing engine. It manages:

- HSM connection via PKCS#11
- Master wrap key generation (AES-256)
- Wallet key generation (EC secp256k1)
- Transaction signing
- User authentication (WebAuthn + password)
- Audit logging (HSM-signed, hash-chained)

### 3.2 Port Architecture

| Port | Purpose | Access |
|------|---------|--------|
| :3100 | Driver Dashboard | Admin only (HSM setup) |
| :3200 | Internal API | Console only (mTLS enforced) |
| :5432 | PostgreSQL | Internal network only |

### 3.3 HSM Integration

```
┌──────────────────────────────────────────────────┐
│                    Luna HSM                       │
│                 FIPS 140-3 Level 3                │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  blue:wrap:v1 (AES-256)                    │   │
│  │  CKA_SENSITIVE=true                        │   │
│  │  CKA_EXTRACTABLE=false                     │   │
│  │  CKA_WRAP=true / CKA_UNWRAP=true           │   │
│  │  CKA_TOKEN=true (permanent)                │   │
│  │                                            │   │
│  │  This is the ONLY permanent key.           │   │
│  │  All wallet keys are session objects.       │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  Wallet Keys (session objects)              │   │
│  │  Generated per-wallet via C_GenerateKeyPair │   │
│  │  EC secp256k1 for EVM chains               │   │
│  │  Wrapped → stored in DB → destroyed         │   │
│  │  Unwrapped only during C_Sign               │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

The HSM communicates with Blue Driver via the PKCS#11 C API (`libCryptoki2.so`). All cryptographic operations happen inside the HSM boundary:

- `C_GenerateKey` — creates the master wrap key
- `C_GenerateKeyPair` — creates wallet EC keypairs
- `C_WrapKey` — encrypts wallet private keys
- `C_UnwrapKey` — decrypts wallet private keys (temporarily)
- `C_Sign` — signs transaction hashes
- `C_DestroyObject` — removes temporary keys

### 3.4 Key Ceremony

The Key Ceremony is a 3-step initialization process performed once:

```
Step 1: Connect HSM          Step 2: Generate Master Key    Step 3: Verification
┌─────────────────────┐     ┌─────────────────────┐       ┌─────────────────────┐
│ Select HSM provider │     │ C_GenerateKey        │       │ ✓ Database Connected │
│ Set PKCS#11 path    │────►│ AES-256, non-extract │──────►│ ✓ Wrap Key Verified  │
│ Enter PIN           │     │ blue:wrap:v1 created │       │ ✓ Test Wallet Created│
│ Open session        │     │                      │       │ ✓ Key Stored in DB   │
└─────────────────────┘     └─────────────────────┘       └─────────────────────┘
```

The verification step creates an actual Ethereum wallet to prove the entire pipeline works: HSM key generation, database storage, and address derivation.

### 3.5 Wallet Key Lifecycle

```
1. GENERATE                    2. WRAP & STORE                3. SIGN & DESTROY
┌─────────────┐               ┌─────────────┐               ┌─────────────┐
│ C_Generate   │               │ C_WrapKey    │               │ C_UnwrapKey  │
│ KeyPair      │               │ (AES-256)    │               │ → temp key   │
│              │               │              │               │              │
│ EC secp256k1 │──────────────►│ Private key  │               │ C_Sign       │
│ session obj  │               │ encrypted    │──── DB ──────►│ → signature  │
│ CKA_TOKEN=   │               │ stored in PG │               │              │
│ false        │               │              │               │ C_Destroy    │
│              │               │ Public key   │               │ Object       │
│              │               │ extracted    │               │ → key gone   │
└─────────────┘               └─────────────┘               └─────────────┘
    Inside HSM                   HSM → DB                      DB → HSM → Gone
```

**Critical security property:** The private key exists in HSM memory only during generation (Step 1) and signing (Step 3). At all other times, it exists only as AES-256 ciphertext in the database. The ciphertext is useless without the master wrap key, which cannot be extracted from the HSM.

### 3.6 Database Schema

PostgreSQL stores all operational data in 8 tables:

| Table | Purpose |
|-------|---------|
| `wallets` | Wallet metadata, wrapped private keys, addresses |
| `transactions` | Transaction records and signatures |
| `policies` | Spending limits, velocity rules, whitelists |
| `vaults` | Wallet groupings for organizational structure |
| `roles` | RBAC role definitions with permissions |
| `users` | Operator accounts with bcrypt passwords |
| `webauthn_credentials` | Passkey credentials for passwordless login |
| `audit_log` | HSM-signed, hash-chained audit trail |

### 3.7 Audit Logging

Every sensitive action is recorded in a tamper-evident audit log:

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Entry 1  │───►│ Entry 2  │───►│ Entry 3  │───►│ Entry 4  │
│          │    │          │    │          │    │          │
│ SHA-256  │    │ SHA-256  │    │ SHA-256  │    │ SHA-256  │
│ hash     │    │ hash     │    │ hash     │    │ hash     │
│          │    │ prevHash │    │ prevHash │    │ prevHash │
│ HMAC sig │    │ HMAC sig │    │ HMAC sig │    │ HMAC sig │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │               │
     └───────────────┴───────────────┴───────────────┘
                  Hash chain — any tampering
                  breaks the chain and is detectable
```

Each entry includes:
- Action performed (key generation, signing, login, etc.)
- Actor (user ID, IP address)
- Timestamp
- SHA-256 hash linking to previous entry (chain integrity)
- HMAC-SHA256 signature using HSM key (authenticity)

---

## 4. Blue Console — The DMZ

### 4.1 What It Does

Blue Console is the operations layer. It handles everything that needs internet access:

- **Bank API** (:3300) — single front door for bank applications
- **Ops Dashboard** (:3400) — daily operations portal for operators
- **Blockchain** — EVM transaction building, broadcasting, deposit detection
- **Compliance** — pre-signing screening via TRM Labs, Chainalysis, Notabene
- **Gas Station** — automatic wallet funding for gas fees

### 4.2 Port Architecture

| Port | Purpose | Access |
|------|---------|--------|
| :3300 | Bank-facing API | Bank apps, external systems |
| :3400 | Ops Dashboard | Operators, compliance team |

### 4.3 Proxy Architecture

The Console is the **single API surface** for all external consumers. It proxies secure operations to the Driver:

```
Bank App ──► Console :3300
               │
               ├─► /api/v1/wallets     ──► Driver :3200 (mTLS) ──► PostgreSQL
               ├─► /api/v1/vaults      ──► Driver :3200 (mTLS) ──► PostgreSQL
               ├─► /api/v1/policies    ──► Driver :3200 (mTLS) ──► PostgreSQL
               ├─► /api/v1/transfers   ──► Compliance Screen
               │                            │ PASS ──► Build TX ──► Driver Sign ──► Broadcast
               │                            │ FAIL ──► 403 BLOCKED
               └─► /auth/login         ──► Driver :3200 (mTLS) ──► User Store
```

### 4.4 Withdrawal Flow

```
┌─────────┐    ┌───────────────┐    ┌──────────────┐    ┌────────────┐    ┌──────────┐
│ Bank App │───►│ Compliance    │───►│ Build        │───►│ HSM Sign   │───►│ Broadcast│
│ POST     │    │ Screen        │    │ Unsigned TX  │    │ via Driver │    │ to Chain │
│ /transfer│    │               │    │              │    │            │    │          │
│          │    │ TRM Labs      │    │ EIP-1559     │    │ C_UnwrapKey│    │ eth_send │
│          │    │ Chainalysis   │    │ Nonce mgmt   │    │ C_Sign     │    │ RawTx    │
│          │    │ Notabene      │    │ Gas estimate  │    │ C_Destroy  │    │          │
│          │    │               │    │ RLP encode   │    │            │    │ Poll for │
│          │    │ Fail = BLOCK  │    │              │    │ Returns    │    │ receipt  │
│          │    │ (never signs) │    │ keccak256    │    │ r,s values │    │          │
└─────────┘    └───────────────┘    └──────────────┘    └────────────┘    └──────────┘
```

**Key security property:** The compliance screen runs BEFORE the transaction reaches the signing service. If any compliance check fails (sanctions match, risk score too high, or API error), the transaction is blocked and never reaches the HSM. This is fail-closed: API errors block, not allow.

### 4.5 Deposit Detection

```
┌─────────────────────────────────────────────┐
│            Block Scanner (15s poll)          │
│                                             │
│  For each new block:                        │
│    For each transaction:                    │
│      If tx.to is a monitored wallet:        │
│        Record deposit                       │
│        Wait for N confirmations             │
│        Update wallet balance via Driver     │
│        Fire webhook to bank callback URL    │
└─────────────────────────────────────────────┘
```

### 4.6 Compliance Screening

Three compliance providers run in parallel on every outbound transfer:

| Provider | Check | Action |
|----------|-------|--------|
| TRM Labs | Sanctions screening | Block if sanctioned address |
| Chainalysis KYT | Risk scoring | Block if risk > threshold |
| Notabene | Travel Rule | Collect originator/beneficiary info |

All three must pass. If any provider's API is unreachable, the transfer is blocked (fail-closed).

### 4.7 Gas Station

The Gas Station monitors wallet gas balances and auto-funds them from a treasury wallet:

- Configurable minimum gas threshold
- Configurable top-up amount
- Daily spending cap to prevent runaway funding
- Uses the same tx-building pipeline as regular withdrawals

---

## 5. Security Architecture

### 5.1 mTLS Between Driver and Console

```
┌─────────────────┐                    ┌─────────────────────┐
│  Blue Console    │     TLS 1.3       │  Blue Driver         │
│                  │                    │                     │
│  console-cert.pem│◄──────────────────►│ driver-cert.pem     │
│  console-key.pem │  Mutual verify    │ driver-key.pem      │
│  ca.pem          │  EC P-256 certs   │ ca.pem              │
│                  │                    │                     │
│  Must present    │  Both signed by   │ requestCert: true    │
│  valid client    │  same internal CA │ rejectUnauthorized   │
│  certificate     │                    │                     │
└─────────────────┘                    └─────────────────────┘
         │                                       │
         │  Without valid cert → SSL REJECTED     │
         └────────────────────────────────────────┘
```

The CA is self-signed and internal — no external certificate authority. Certificates are EC P-256 with 365-day validity. The Driver requires client certificates (`requestCert: true`) and rejects connections not signed by the internal CA (`rejectUnauthorized: true`).

### 5.2 Authentication

**WebAuthn Passkeys (Primary)**
- FIDO2 hardware key or platform authenticator
- No passwords transmitted — challenge/response only
- Credential stored in `webauthn_credentials` table
- Uses `@simplewebauthn/server` library

**Password (Fallback)**
- bcrypt (12 rounds) for password hashing
- Session tokens (UUID v4) with 8-hour expiry
- `mustChangePassword` flag for initial setup

### 5.3 Defense in Depth

```
Layer 1: Network Segmentation
  └─ Driver in secure zone (no internet)
  └─ Console in DMZ
  └─ PostgreSQL on internal network only

Layer 2: mTLS
  └─ Console must present client cert to talk to Driver
  └─ Self-signed CA — no external trust chain

Layer 3: Internal Auth Key
  └─ Shared secret (X-Internal-Key header) for API calls
  └─ Belt-and-suspenders with mTLS

Layer 4: HSM Boundary
  └─ Private keys never leave HSM in plaintext
  └─ Master wrap key is non-extractable
  └─ Session keys destroyed after use

Layer 5: Compliance Screening
  └─ Pre-signing check on all outbound transfers
  └─ Fail-closed (errors = block, not allow)

Layer 6: Audit Trail
  └─ HSM-signed hash chain
  └─ Tamper-evident — broken chain = detected
```

### 5.4 FIPS 140-3 Level 3 Compliance

The Luna HSM provides FIPS 140-3 Level 3 certification, which means:

- Physical tamper-evidence (epoxy coating, tamper-evident seals)
- Identity-based operator authentication
- Key material zeroization on tamper detection
- Roles-based access (Security Officer, User, Auditor)
- Approved cryptographic algorithms only

Blue Wallets leverages all of these through the PKCS#11 interface without weakening any guarantees.

---

## 6. Supported Blockchains

| Chain | Algorithm | Status |
|-------|-----------|--------|
| Ethereum | EC secp256k1 | Production |
| BSC | EC secp256k1 | Production |
| Polygon | EC secp256k1 | Production |
| Arbitrum | EC secp256k1 | Production |
| Avalanche | EC secp256k1 | Production |
| Bitcoin | EC secp256k1 | Planned (UTXO model) |
| Solana | Ed25519 | Planned (requires Luna FM) |
| TRON | EC secp256k1 | Planned (protobuf format) |

All EVM-compatible chains use the same transaction builder with different chain IDs.

---

## 7. Deployment

### 7.1 Docker Compose

Blue Wallets ships as three Docker containers:

```yaml
services:
  postgres:       # PostgreSQL 16 — persistent storage
  blue-driver:    # HSM connector — secure zone
  blue-console:   # Operations — DMZ
```

Two Docker networks enforce segmentation:
- `internal` — Driver, Console, PostgreSQL (no internet)
- `internet` — Console only (RPC nodes, compliance APIs)

### 7.2 Certificate Generation

```bash
./certs/generate-certs.sh
# Creates: ca.pem, driver-cert.pem, driver-key.pem,
#          console-cert.pem, console-key.pem
```

### 7.3 Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `MTLS_ENABLED` | Driver | Enable mTLS on internal API |
| `INTERNAL_AUTH_KEY` | Both | Shared secret for API auth |
| `DATABASE_URL` | Driver | PostgreSQL connection string |
| `SIGNER_URL` | Console | Driver's internal API URL |
| `ETH_RPC_URL` | Console | Ethereum RPC endpoint |

---

## 8. Comparison with Alternatives

| Feature | Blue Wallets | MPC Wallets | Smart Wallets |
|---------|-------------|-------------|---------------|
| Key storage | On-prem HSM | Cloud shards | On-chain contract |
| FIPS certification | Level 3 | None | None |
| Data sovereignty | Full (on-prem) | Cloud provider | Public blockchain |
| Regulatory compliance | Bank-grade | Limited | Limited |
| Key extraction possible | No (HSM enforced) | Yes (shard recombination) | N/A (code-controlled) |
| Scales to millions | Yes (wrapped keys in DB) | Yes | Yes |
| Internet required | Console only | Always | Always |
| Single point of compromise | None (HSM + mTLS + compliance) | Cloud provider | Smart contract bug |

---

## 9. Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 / TypeScript |
| HSM Interface | PKCS#11 via `pkcs11js` |
| Database | PostgreSQL 16 |
| Web Framework | Express.js |
| Authentication | WebAuthn (`@simplewebauthn/server`) + bcrypt |
| Blockchain | ethers.js v6 (EVM chains) |
| TLS | Node.js native `https` + `crypto` |
| Containers | Docker + Docker Compose |
| UI | Vanilla JS (ES Modules) + CSS custom properties |

---

## 10. Roadmap

- [ ] BTC/LTC support (UTXO transaction model)
- [ ] Solana support (Ed25519 via Luna Functionality Module)
- [ ] ERC-20 token support in deposit monitor
- [ ] Wrapped key support (pending Luna DPoD policy change)
- [ ] Key rotation (re-wrap with new master key)
- [ ] Multi-HSM failover
- [ ] Automated security scanning
- [ ] SOC 2 Type II audit preparation

---

**Blue Wallets** — Because your customers' digital assets deserve the same security as their fiat deposits.

*For inquiries: contact@bluewallets.io*
