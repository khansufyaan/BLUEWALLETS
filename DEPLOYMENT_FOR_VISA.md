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

## Step 2 — Run the setup script (one command)

This generates `.env` with strong random secrets AND mTLS certificates:

```bash
./setup.sh
```

That's it for setup. The script:
- Generates a 24-char Postgres password
- Generates a 64-hex shared auth key between Driver and Console
- Generates a root CA + leaf certs for mTLS (Driver ↔ Console)
- Writes `.env` with mode 600 (owner-only read)

**If you prefer manual setup:** copy `.env.example` to `.env` and fill in the `REPLACE_ME` values yourself. Then run `./certs/generate-certs.sh`.

**For production:** after running `setup.sh`, edit `.env` to:
- Replace `ETH_RPC_URL` with your Alchemy/Infura key (not the public demo)
- Set `CORS_ORIGIN` to your Console's production URL
- Replace the generated certs with your internal PKI-issued certs

---

## Step 3 — Start the stack

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

## Step 4 — Verify health

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

## Step 5 — First-time setup

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

### Logs show `ECONNREFUSED 192.168.x.x:3200` — "Failed to refresh wallet list from signer"

The Gateway is trying to reach the Driver on its internal mTLS port but can't.
The Gateway itself IS running (look for "Blue Gateway API running on port 3100"
earlier in the log), but the Driver container isn't reachable yet.

Check:
```bash
docker compose ps                    # Is blue-driver Up and Healthy?
docker compose logs blue-driver      # What's its state?
```

Common causes:
- Driver container is still starting up — wait 60s and check again
- Driver failed to start because HSM isn't connected — check Driver logs
- `certs/` directory missing or unreadable — rerun `./setup.sh`
- Wrong `INTERNAL_AUTH_KEY` — must match in both services (both set from same `.env`)

The Gateway will keep retrying every 15s. Once Driver is up, the logs show:
"Signer (Driver) now reachable — resumed wallet list refresh"

### Logs show `ENOTFOUND eth-sepolia.g.alchemy.com` — "Failed to initialize deposit monitor"

Your network blocks outbound DNS/HTTPS to public blockchain RPC providers
(Alchemy, Infura, etc.). This is common in corporate / banking environments.

**Fix:** set `ETH_RPC_URL` in your `.env` to one of:
- Your internal Ethereum node (e.g. `http://eth-node.internal:8545`)
- An allowlisted proxy to Alchemy/Infura
- Leave blank to disable blockchain features entirely:
  ```
  ETH_RPC_URL=
  ```

After editing `.env`:
```bash
docker compose restart blue-console
```

The Gateway now probes RPC endpoints at startup and disables features for
unreachable chains cleanly (no more log spam). You'll see:
"RPC unreachable — blockchain features disabled for this chain"

The Console still works fine for wallet/vault management without RPC —
you just can't see on-chain balances or detect deposits until RPC is wired.

### `INTERNAL_AUTH_KEY is required` on `docker compose up`

The compose file enforces that secrets are set. You forgot to create `.env`.
Run:
```bash
./setup.sh
```
Then try `docker compose up -d` again.

### `POSTGRES_PASSWORD is required`

Same cause as above — missing `.env`. Run `./setup.sh`.

### "No HSM slots with tokens found" when connecting to Luna HSM

The PKCS#11 library loads and initializes successfully, but `C_GetSlotList(true)` returns
zero slots — meaning the Luna client can see slot descriptors but cannot authenticate to
any HSM partition. This was resolved by fixing three issues:

**Root Cause 1 — Missing `ChrystokiConfigurationPath` environment variable**

The Luna PKCS#11 library (`libCryptoki2_64.so`) locates its configuration file
(`Chrystoki.conf`) using the `ChrystokiConfigurationPath` environment variable. Without it,
the library cannot find the server connection details (hostname, port, certificates), so it
sees slots but no tokens. The fix was adding this to `docker-compose.client.yml`:

```yaml
environment:
  - ChrystokiConfigurationPath=/etc
```

This tells the Luna library to look for `/etc/Chrystoki.conf`, which is bind-mounted from
the host.

**Root Cause 2 — Certificate file permissions**

The container runs as non-root user `blue` (uid 1001), but the Luna client certificates on
the host are owned by `root:hsmusers` (gid 986) with restrictive permissions. The Luna
library needs to read the client private key and certificate to establish the mTLS connection
to the HSM appliance. Without read access, the mTLS handshake fails silently and no tokens
appear.

Fix — add the `hsmusers` group to the container user:
```yaml
group_add:
  - "986"    # hsmusers group on the host
```

And ensure group-read permissions on the host:
```bash
chmod g+r  /usr/safenet/lunaclient/cert/client/10.207.217.22.pem
chmod g+r  /usr/safenet/lunaclient/cert/client/10.207.217.22Key.pem
chmod g+rx /usr/safenet/lunaclient/cert/client/
chmod g+rx /usr/safenet/lunaclient/cert/
chmod o+r  /etc/Chrystoki.conf
```

**Root Cause 3 — Container not recreated after compose changes**

Docker Compose only applies environment and volume changes when containers are recreated,
not just restarted. After editing `docker-compose.client.yml`, always use:

```bash
docker compose -f docker-compose.client.yml down
docker compose -f docker-compose.client.yml up -d --force-recreate
```

**Verification — confirm the fix inside the container:**
```bash
# Env var is set
docker exec blue-driver env | grep -i chrystoki
# → ChrystokiConfigurationPath=/etc

# User has the hsmusers group
docker exec blue-driver id
# → uid=1001(blue) gid=1001(blue) groups=1001(blue),986

# Config file is readable
docker exec blue-driver cat /etc/Chrystoki.conf

# Certs are readable
docker exec blue-driver ls -la /usr/safenet/lunaclient/cert/client/
docker exec blue-driver ls -la /usr/safenet/lunaclient/cert/server/

# Slots now show tokens
docker exec blue-driver node -e "
const p = require('pkcs11js');
const pk = new p.PKCS11();
pk.load('/usr/safenet/lunaclient/lib/libCryptoki2_64.so');
pk.C_Initialize();
console.log('Slots with tokens:', pk.C_GetSlotList(true).length);
pk.C_Finalize();
"
# → Slots with tokens: 1 (or more)
```

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

### AI Agent is very slow (>60s per response)

Likely cause: running Ollama in Docker on Mac/Windows without GPU. Docker
on those platforms runs inside a VM that can't access Metal/CUDA.

**On Mac**: run Ollama natively outside Docker to use Metal GPU:
```bash
# Install and run Ollama natively
brew install ollama
ollama serve &
ollama pull qwen2.5:3b-instruct
printf 'FROM qwen2.5:3b-instruct\nPARAMETER num_ctx 8192\n' | ollama create blue-qwen-fast -f -

# Point the agent container at host Ollama
# Edit docker-compose.agent.yml — remove the `ollama` service and change
# LLM_URL in blue-agent to http://host.docker.internal:11434/v1
```

**On Linux with GPU**: use `docker-compose.agent.gpu.yml`. Ollama in Docker
*can* access NVIDIA GPUs via nvidia-container-toolkit on Linux.

**On Linux CPU-only**: expect 20-60s response times for the 7B model with
18 tool definitions. Consider switching to a smaller model (3B or 1.5B)
or upgrading to a GPU host.

### "input truncated" in Ollama logs

The default context window is 2048 tokens, too small for our system prompt
+ tool definitions. Create a custom model with larger context:
```bash
ollama create blue-qwen-fast -f - <<EOF
FROM qwen2.5:7b-instruct
PARAMETER num_ctx 8192
EOF
```
Then set `LLM_MODEL=blue-qwen-fast:latest`.

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
