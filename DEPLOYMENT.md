# Blue Wallets — Deployment Guide

## Quick Start (5 minutes)

### Prerequisites
- Docker & Docker Compose
- An HSM (Luna, SoftHSM2, or AWS CloudHSM) with PKCS#11 library
- (Optional) Ethereum RPC endpoint (Alchemy, Infura, or QuickNode)

### Step 1: Pull Docker Images

```bash
docker pull ghcr.io/khansufyaan/blue-driver:latest
docker pull ghcr.io/khansufyaan/blue-console:latest
```

### Step 2: Generate mTLS Certificates

```bash
git clone https://github.com/khansufyaan/BLUEWALLETS.git
cd BLUEWALLETS
chmod +x certs/generate-certs.sh
./certs/generate-certs.sh
```

This creates mutual TLS certificates for secure Driver ↔ Console communication.

### Step 3: Create Environment File

```bash
cat > .env << 'EOF'
POSTGRES_PASSWORD=change-me-to-a-strong-password
INTERNAL_AUTH_KEY=change-me-to-a-random-64-char-string
ETH_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
EOF
```

### Step 4: Start

```bash
docker compose -f docker-compose.client.yml up -d
```

### Step 5: Run Key Ceremony

1. Open **http://localhost:3100** (Blue Driver)
2. Log in: `admin` / `Admin1234!`
3. **Step 1** — Connect HSM: select provider, enter PKCS#11 library path and PIN
4. **Step 2** — Generate Master Key: creates `blue:wrap:v1` on HSM
5. **Step 3** — Verification: automatically tests DB + HSM + wallet creation

### Step 6: Start Operations

1. Open **http://localhost:3400** (Blue Console)
2. Log in: `admin` / `Admin1234!`
3. Create vaults, wallets, and policies

---

## Architecture

```
Your Network
├── Secure Zone (no internet)
│   ├── Blue Driver    :3100 (dashboard) :3200 (internal API, mTLS)
│   ├── PostgreSQL     :5432 (internal only)
│   └── Luna HSM       (PKCS#11)
│
└── DMZ (internet access)
    └── Blue Console   :3300 (bank API) :3400 (ops dashboard)
                       ↓
                       RPC Nodes, Compliance APIs
```

## HSM Configuration

### Luna HSM (On-Premises)
```
Library: /usr/lib/libCryptoki2_64.so
Slot: 0
```

### Luna DPoD (Cloud HSM)
```
Library: /opt/lunaclient/libs/64/libCryptoki2.so
Slot: 0
```
Mount your Luna client directory: `-v /opt/lunaclient:/opt/lunaclient:ro`

### SoftHSM2 (Development/Testing)
```
Library: /usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so
Slot: 0
```
Initialize first: `softhsm2-util --init-token --slot 0 --label "waas-kms"`

### AWS CloudHSM
```
Library: /opt/cloudhsm/lib/libcloudhsm_pkcs11.so
Slot: 0
```

## Default Users

| Username | Password | Role |
|----------|----------|------|
| admin | Admin1234! | Admin |
| officer1 | Officer1234! | Officer |
| officer2 | Officer1234! | Officer |
| auditor | Auditor1234! | Auditor |

**Change these immediately after first login.**

## Ports

| Port | Service | Purpose |
|------|---------|---------|
| 3100 | Blue Driver | Admin dashboard (HSM setup only) |
| 3200 | Blue Driver | Internal API (mTLS, Console only) |
| 3300 | Blue Console | Bank-facing API |
| 3400 | Blue Console | Operations dashboard |
| 5432 | PostgreSQL | Database (internal only) |

## Environment Variables

### Blue Driver
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MTLS_ENABLED` | No | `false` | Enable mTLS on internal API |
| `INTERNAL_AUTH_KEY` | Yes | — | Shared secret for Console auth |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |

### Blue Console
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIGNER_URL` | Yes | — | Driver internal API URL |
| `INTERNAL_AUTH_KEY` | Yes | — | Must match Driver's key |
| `ETH_RPC_URL` | No | demo | Ethereum RPC endpoint |
| `WEBHOOK_URL` | No | — | Deposit notification callback |

## Security Checklist

- [ ] Change all default passwords
- [ ] Generate fresh mTLS certificates
- [ ] Set strong `INTERNAL_AUTH_KEY`
- [ ] Restrict port 3200 to Console only (firewall)
- [ ] Restrict port 5432 to internal network only
- [ ] Configure HSM PIN policy
- [ ] Set up compliance API keys (TRM, Chainalysis, Notabene)
- [ ] Enable audit log monitoring
