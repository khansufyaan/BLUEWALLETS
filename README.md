# Blue Wallets

**On-premises Hardware Security Module (HSM) Wallet-as-a-Service for banks and financial institutions.**

Blue Wallets provides a self-hosted, FIPS-compliant key management and wallet infrastructure layer. It runs entirely inside your data centre, generates all cryptographic key material inside a FIPS 140-3 Level 3 HSM, and exposes a REST API for multi-chain wallet operations — no cloud custody, no external key exposure.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Blue Wallets Server (Docker · linux/amd64)              │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Auth    │  │  Wallet API  │  │  Ceremony Wizard │   │
│  │  RBAC    │  │  Vault MGMT  │  │  (8-step UI)     │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│              ↓               ↓                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │  KMS Service (BIP-32/39/44 HD derivation)       │     │
│  │  Policy Engine · RBAC · Audit log               │     │
│  └─────────────────────────────────────────────────┘     │
│              ↓                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │  PKCS#11 Interface (pkcs11js)                   │     │
│  └─────────────────────────────────────────────────┘     │
│              ↓                                           │
└──────────────┼───────────────────────────────────────────┘
               ↓ TLS (mTLS via Chrystoki.conf)
┌──────────────────────────────────────┐
│  Thales Luna Cloud HSM (DPoD)        │
│  FIPS 140-3 Level 3                  │
│  Non-extractable key storage         │
└──────────────────────────────────────┘
```

### Key Design Decisions

| Property | Detail |
|---|---|
| Key storage | All private keys sealed inside HSM as non-extractable (`CKA_EXTRACTABLE=false`) |
| HD derivation | BIP-32/39/44 — master key stored in HSM, child keys derived and wrapped |
| Entropy source | HSM hardware RNG via PKCS#11 `C_GenerateRandom` |
| Master key ceremony | Shamir Secret Sharing 3-of-5, dual-officer approval required |
| Compliance | FIPS 140-3 Level 3 (Luna HSM), PKCS#11 v2.40 |
| Multi-chain | Bitcoin, Ethereum, Solana, BNB Chain, Polygon, Avalanche (BIP-44) |

---

## Supported HSMs

| HSM | Mode | Notes |
|---|---|---|
| Thales Luna Cloud HSM / DPoD | Production | Requires Luna client binaries and Chrystoki.conf |
| Thales Luna Network HSM (on-prem) | Production | Same Luna client, different Chrystoki.conf |
| SoftHSM2 | Development / CI | No hardware needed; set `HSM_USE_SOFTHSM=true` |
| Any PKCS#11-compatible HSM | Production | Configure `HSM_PKCS11_LIB` to point at vendor `.so` |

---

## Prerequisites

- Docker (with `linux/amd64` build support)
- Luna client binaries (`cvclient-min.tar`) from Thales DPoD portal
- Luna `Chrystoki.conf` and partition TLS certificates from DPoD portal

---

## Quick Start (SoftHSM2 — Development)

```bash
# Clone the repo
git clone https://github.com/khansufyaan/BLUEWALLETS.git
cd BLUEWALLETS

# Start with the default docker-compose (uses SoftHSM2 inside the container)
docker compose up -d

# Open the UI
open http://localhost:3100
```

Default credentials: `admin` / `Admin1234!`

---

## Quick Start (Luna Cloud HSM — Production)

```bash
# Place Luna client files in luna-client/
cp /path/to/cvclient-min.tar     luna-client/
cp /path/to/Chrystoki.conf       luna-client/
cp /path/to/partition-ca-certificate.pem  luna-client/
cp /path/to/partition-certificate.pem     luna-client/
cp /path/to/server-certificate.pem        luna-client/

# Build and start
docker compose -f docker-compose.luna.yml up -d

# Monitor logs
docker compose -f docker-compose.luna.yml logs -f
```

The server starts on `http://localhost:3100`. Open the UI and follow the Key Ceremony wizard.

---

## Key Ceremony Walkthrough

The 8-step wizard initialises the HSM and derives the BIP-32 master key. This must be completed before any wallets can be created.

| Step | Action |
|---|---|
| 1. Connect HSM | Enter the PKCS#11 library path and partition PIN to verify connectivity |
| 2. Initiate Ceremony | Provide a reason; your identity is taken from the admin session |
| 3. Officer Approval | Two independent officers log in sequentially to approve the request |
| 4. Generate Entropy | 256-bit entropy pulled from HSM hardware RNG (`C_GenerateRandom`) |
| 5. Distribute Shares | Five Shamir shares are displayed one at a time for five custodians |
| 6. Reconstruct & Seal | Enter any 3 shares to reconstruct entropy, derive master key, seal into HSM |
| 7. Account Structure | Select BIP-44 coin types (BTC, ETH, SOL, etc.) |
| 8. Complete | Master key is non-extractable in HSM; system is production-ready |

---

## API Reference

All `/api/v1/*` endpoints require `Authorization: Bearer <token>`.

### Authentication — `/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Obtain a session token |
| POST | `/auth/logout` | Invalidate the session token |
| GET | `/auth/me` | Get current user profile |

### Wallets — `/api/v1/wallets`

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/wallets` | List all wallets |
| POST | `/api/v1/wallets` | Create a wallet (BIP-44 derived) |
| GET | `/api/v1/wallets/:id` | Get wallet detail |
| POST | `/api/v1/wallets/:id/transfer` | Create a transfer (policy-checked) |
| GET | `/api/v1/wallets/:id/transactions` | Get wallet transactions |

### Vaults — `/api/v1/vaults`

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/vaults` | List vaults |
| POST | `/api/v1/vaults` | Create vault |
| GET | `/api/v1/vaults/:id` | Get vault detail |
| POST | `/api/v1/vaults/:id/wallets` | Create wallet inside vault |

### Ceremony — `/api/v1/ceremony`

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/ceremony/initiate` | Start approval request |
| POST | `/api/v1/ceremony/approve` | Officer approves request |
| GET | `/api/v1/ceremony/approval` | Get active approval |
| POST | `/api/v1/ceremony/entropy` | Generate entropy from HSM |
| GET | `/api/v1/ceremony/shares/:index` | Get Shamir share |
| POST | `/api/v1/ceremony/shares/:index/acknowledge` | Acknowledge share |
| POST | `/api/v1/ceremony/reconstruct` | Reconstruct and seal master key |
| POST | `/api/v1/ceremony/complete` | Finalise ceremony |

### HSM Config — `/api/v1/hsm`

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/hsm/status` | Get HSM connection status |
| POST | `/api/v1/hsm/connect` | Connect to HSM dynamically |
| POST | `/api/v1/hsm/disconnect` | Disconnect from HSM |

---

## Default Credentials

> **Change all default passwords before production use.**

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin1234!` | Administrator |
| `officer1` | `Officer1234!` | Officer (ceremony approval) |
| `officer2` | `Officer1234!` | Officer (ceremony approval) |
| `officer3` | `Officer1234!` | Officer (ceremony approval) |
| `auditor` | `Auditor1234!` | Read-only auditor |

---

## Security Model

| Control | Implementation |
|---|---|
| Key non-extractability | `CKA_EXTRACTABLE=false` on all HSM key objects |
| Master key ceremony | Shamir 3-of-5, dual-officer approval (2 of N officers required) |
| Session management | 8-hour JWT-like tokens, invalidated on new login |
| Role-based access | admin / officer / auditor roles; ceremony routes require officer or admin |
| FIPS compliance | Thales Luna Cloud HSM — FIPS 140-3 Level 3 validated |
| Transport | TLS mutual authentication to HSM via Chrystoki.conf certificates |
| No cloud exposure | Server runs entirely on-premises; no external API calls |

---

## License

MIT
