# Blue Wallets — Visa Deployment Guide

**Target audience:** Visa infrastructure team deploying Blue Wallets for evaluation / PoC.
**Last updated:** April 2026
**Release tag:** `v1.0.0-visa-poc`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│   DMZ (Internet-Facing)                                     │
│                                                             │
│   blue-console  ──── ports 3300 (API), 3400 (dashboard)     │
│       │                                                     │
│       │ mTLS over port 3200                                 │
│       ▼                                                     │
├─────────────────────────────────────────────────────────────┤
│   Secure Zone (No Internet)                                 │
│                                                             │
│   blue-driver  ──── port 3100 (HTTPS dashboard / ceremony)  │
│       │                                                     │
│       │ PKCS#11                                             │
│       ▼                                                     │
│   Luna HSM or SoftHSM (dev)                                 │
│                                                             │
│   postgres    ──── bluewallets DB                           │
└─────────────────────────────────────────────────────────────┘

Optional:
┌─────────────────────────────────────────────────────────────┐
│   AI Layer (Optional — same secure zone)                    │
│                                                             │
│   blue-agent  ──── port 3500 (tool-calling orchestrator)    │
│   ollama      ──── LLM inference (CPU or GPU)               │
│   whisper     ──── voice transcription (CPU)                │
└─────────────────────────────────────────────────────────────┘
```

**Three-tier model:**
1. **Secure zone** (no internet): `blue-driver`, `postgres`, HSM client libraries
2. **DMZ** (bank-facing + internet for blockchain RPC): `blue-console`
3. **Optional AI layer** (secure zone): `blue-agent`, `ollama`, `whisper`

---

## Requirements

### Hardware

| Component | CPU | RAM | Disk | Notes |
|-----------|-----|-----|------|-------|
| blue-driver | 2 cores | 2 GB | 10 GB | + HSM client |
| blue-console | 1 core | 1 GB | 5 GB | |
| postgres | 2 cores | 2 GB | 50 GB | grow with tx volume |
| blue-agent | 1 core | 512 MB | 1 GB | |
| ollama (CPU) | 4 cores | 16 GB | 10 GB | Qwen 7B |
| ollama (GPU) | 4 cores | 16 GB + 48 GB VRAM | 50 GB | Llama 70B |
| whisper | 2 cores | 2 GB | 1 GB | base.en model |

### Software

- Docker 24.0+ (we tested with 28.5.2)
- Docker Compose v2.20+
- OpenSSL 3.0+ (for generating mTLS certs)
- (optional) NVIDIA Container Toolkit for GPU inference

### Network

- **Driver and Postgres** must be able to talk to each other (internal network).
- **Console** needs outbound HTTPS to the blockchain RPC provider of your choice (Alchemy, Infura, or internal node).
- **Console** exposes 3400 (dashboard) and 3300 (bank API) — these should sit behind your load balancer with TLS termination.
- **No outbound internet** required from the secure zone after initial image pull.

### HSM

The Driver speaks **PKCS#11 v2.40**. We've validated against:
- **Thales Luna Network HSM 7** (hardware + DPoD cloud)
- **SoftHSM2** (for local testing only, not production)

You'll mount the HSM client library at `/opt/hsm/libCryptoki2_64.so` or similar and set `HSM_PKCS11_LIBRARY` pointing to it.

---

## Step 1 — Pull images

Images are published to GitHub Container Registry. Pull them:

```bash
docker pull ghcr.io/khansufyaan/blue-driver:v1.0.0-visa-poc
docker pull ghcr.io/khansufyaan/blue-console:v1.0.0-visa-poc
docker pull ghcr.io/khansufyaan/blue-agent:v1.0.0-visa-poc   # optional

# Also pull third-party dependencies:
docker pull postgres:16.4-alpine
docker pull ollama/ollama:0.3.14                             # optional
docker pull onerahmet/openai-whisper-asr-webservice:v1.4.1   # optional
```

### Air-gapped alternative

If your environment has no access to ghcr.io or docker.io, we can provide image tarballs:

```bash
docker load -i blue-driver-v1.0.0.tar
docker load -i blue-console-v1.0.0.tar
docker load -i blue-agent-v1.0.0.tar
```

---

## Step 2 — Generate credentials

These MUST be set before starting any containers:

```bash
cat > .env <<EOF
# Strong passwords (use a password manager — 16+ chars mixed case + symbols)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+' | head -c 24)

# Shared secret between Driver and Console (must be 64 hex chars)
INTERNAL_AUTH_KEY=$(openssl rand -hex 32)

# Blockchain RPC provider (get your own key)
ETH_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY_HERE
ETH_CHAIN_ID=11155111

# CORS — restrict to your Console hostname
CORS_ORIGIN=https://console.yourbank.internal

# Optional: production log level
LOG_LEVEL=info
EOF

chmod 600 .env
```

---

## Step 3 — Generate mTLS certificates

The Driver and Console communicate over mTLS on port 3200. Generate a root CA and leaf certs:

```bash
./certs/generate-certs.sh
```

This creates:
- `certs/ca.pem` (root CA)
- `certs/driver-cert.pem` + `certs/driver-key.pem`
- `certs/console-cert.pem` + `certs/console-key.pem`

**For production:** use your internal PKI instead. Place your certificates in the `certs/` directory with the same filenames.

---

## Step 4 — Start the stack

### Minimal stack (Driver + Console + Postgres)

```bash
docker compose -f docker-compose.client.yml up -d
```

This launches:
- `blue-postgres` on port 5432 (internal only)
- `blue-driver` on ports 443 (dashboard), 3200 (mTLS)
- `blue-console` on ports 3300 (bank API), 3400 (ops dashboard)

### With AI Agent (optional)

```bash
docker compose \
  -f docker-compose.client.yml \
  -f docker-compose.agent.yml \
  up -d
```

This adds:
- `blue-ollama` on port 11434 (LLM inference — default Qwen 7B, CPU)
- `blue-whisper` on port 8081 (speech-to-text, CPU)
- `blue-agent` on port 3500 (orchestrator)

First boot will pull the LLM model (~5 GB). This takes 5–15 min depending on disk speed.

### With GPU for production LLM

```bash
cp .env.agent.production .env.agent

docker compose \
  -f docker-compose.client.yml \
  -f docker-compose.agent.yml \
  -f docker-compose.agent.gpu.yml \
  up -d
```

This enables Llama 3.1 70B (needs 48 GB+ VRAM).

---

## Step 5 — Verify health

Wait ~60 seconds for all containers to pass their healthchecks, then:

```bash
# All containers should show "healthy"
docker compose ps

# Driver health (expect 200 with HSM, 503 degraded without)
curl -fsk https://localhost:443/health

# Console health
curl -fs http://localhost:3400/health

# Agent health (if deployed)
curl -fs http://localhost:3500/health
```

Expected Driver health output:
```json
{
  "service": "blue-driver",
  "status": "healthy",
  "hsm": { "connected": true, "tokenInfo": {...} },
  "database": { "type": "postgresql", "connected": true },
  "internalApi": { "transport": "HTTPS", "mtls": true }
}
```

---

## Step 6 — First-time setup

1. **Open the Driver**: `https://localhost:443`
   - Accept the self-signed cert warning (or use your real cert)
   - Sign in as `admin` with the password you set in `.env`
   - Go to **HSM** → **Connect**
   - Enter your HSM PIN and confirm the slot label
2. **Run the Key Ceremony** (one-time):
   - Driver → **Key Ceremony** → **Generate Master Seed**
   - Requires 2-of-3 officer signatures (use the `officer1`, `officer2`, `officer3` accounts or invite real ones)
   - This creates the HD master seed that wraps all subsequent wallet keys
3. **Open the Console**: `http://localhost:3400`
   - Sign in with the same credentials
   - Create a Vault
   - Create Wallets (HD mode is auto-enabled after the ceremony)
4. **(Optional) Try the AI Agent**: Console → sidebar → **AI Agent**
   - Ask "How many wallets do we have?" to verify read tools work
   - Ask "Create a new vault called Test" to verify the approval workflow

---

## Verified Fixes & Hardening (April 2026)

This release includes:

### Security fixes (from Visa pre-audit)
- [x] XSS sanitization on all dynamic HTML rendering
- [x] Path traversal prevention in HSM config endpoint
- [x] Removed all hardcoded credentials from login UIs
- [x] CORS restricted to `CORS_ORIGIN` env var (default: none)
- [x] Session tokens use `crypto.randomBytes(32)` (not UUID)
- [x] Rate limiting on `/auth/login` (10 req/min per IP)
- [x] Internal auth required (no silent bypass)
- [x] Request body size limited to 1 MB

### Runtime bug fixes (from overnight audit)
- [x] **HD derivation race condition** — concurrent wallet creates can no longer collide on the same BIP-44 index (was a **cryptographic risk**)
- [x] Database connection leak on migration failure
- [x] PKCS#11 session auto-reconnect retry on stale handle during signing
- [x] Error objects serialize properly in logs (was `{}` before)
- [x] Agent conversation store bounded (1000 convos × 200 messages max)
- [x] Agent approval race condition (atomic compare-and-swap)
- [x] Agent tool result safe-stringify (handles BigInt, circular refs)
- [x] Webhook retries bounded to 5 (was infinite loop)
- [x] Deposit monitor retries bounded to 5
- [x] parseInt with explicit radix everywhere
- [x] Input validation ranges on pagination limits (1-1000)
- [x] Frontend null-dereferences fixed (wallets, transactions, vault-detail)

### Docker hardening
- [x] All images run as **non-root user** (uid 1001, `blue`)
- [x] All base images **pinned to specific versions** (no `:latest`)
- [x] Multi-stage builds — smaller final images (no compilers in runtime)
- [x] `tini` as PID 1 for proper signal handling + zombie reaping
- [x] Healthchecks on every service
- [x] Resource limits (memory + CPU) on every service
- [x] Restart policies (`unless-stopped`) everywhere
- [x] All `.dockerignore` files present (no secrets leaked into images)

### Compose hardening
- [x] Required env vars use `:?` to fail-fast if missing
- [x] Internal networks isolated from internet (`internal`/`internet` split)
- [x] mTLS between Driver and Console
- [x] Volumes for persistent data (postgres, ollama models)
- [x] Named containers for log aggregation

---

## Operational Guide

### Logs

```bash
docker compose logs -f blue-driver       # Driver
docker compose logs -f blue-console      # Gateway/Console
docker compose logs -f blue-agent        # AI agent
docker compose logs -f blue-postgres     # Database
```

For production, wire these to Splunk/ELK via Docker's `gelf` or `fluentd` log driver.

### Backups

```bash
# Daily backup of the wallet DB
docker compose exec postgres pg_dump -U blue bluewallets | \
  gpg --encrypt -r ops@yourbank.internal > backup-$(date +%Y%m%d).sql.gpg
```

### Metrics

Prometheus metrics are exposed at `/metrics` on each service (port 3100, 3400, 3500).

### Updates

```bash
docker compose pull
docker compose up -d
```

### Rollback

```bash
docker compose stop
docker tag blue-driver:previous blue-driver:latest   # revert tag
docker compose up -d
```

---

## Security Checklist Before Production

- [ ] Replace all self-signed certs with your PKI-issued certs
- [ ] Change default admin password on first login (forced by the UI)
- [ ] Change default officer passwords
- [ ] Set `HSM_PIN` and `HSM_SO_PIN` via secrets manager (not `.env`)
- [ ] Enable `internal: true` on the `internal` network
- [ ] Deploy behind a WAF / API gateway
- [ ] Enable audit log shipping to SIEM
- [ ] Configure backup encryption keys
- [ ] Run pen test against exposed endpoints
- [ ] Review compliance provider keys (TRM / Chainalysis)

---

## Troubleshooting

### "HSM signing failed" in logs

Check the Driver logs for the actual error (fixed in this release — errors now include stack traces):
```bash
docker compose logs blue-driver | grep -i "HSM signing"
```

Common causes:
- **PIN expired**: use the HSM page to change it
- **Session stale**: fixed — retries automatically on the next call
- **Wrap key missing**: run the key ceremony again

### "Cannot connect to Driver" in Console

```bash
docker compose exec blue-console curl -fsk https://blue-driver:3200/health
```

If this fails, check mTLS certs are mounted on both sides.

### AI Agent says "LLM not reachable"

```bash
docker compose logs blue-ollama
docker compose exec blue-agent curl http://ollama:11434/v1/models
```

First-time boot takes 10 min to pull the model.

---

## Support

- **Code**: https://github.com/khansufyaan/BLUEWALLETS
- **Issues**: Private — contact Sufyaan Khan
- **Demo credentials (DEV ONLY — NEVER use in prod)**:
  - admin / Admin1234! (change on first login)
  - officer1 / Officer1234! (must change on first login)
  - auditor / Auditor1234!

---

**Release `v1.0.0-visa-poc` is production-ready for a controlled evaluation.**
For a full production deployment, please engage with us to complete the security hardening checklist above.
