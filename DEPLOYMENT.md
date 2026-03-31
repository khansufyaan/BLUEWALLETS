# Blue Wallets — Deployment Guide

For bank IT teams and infrastructure engineers deploying Blue Wallets in a production environment.

---

## Hardware Requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU (x86_64) | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 10 GB | 20 GB SSD |
| OS | Ubuntu 22.04 LTS (linux/amd64) | Ubuntu 22.04 LTS |
| Docker | 24.x | 26.x |
| Network | Outbound HTTPS (443) to DPoD endpoint | Dedicated network segment |

The Docker image is built for `linux/amd64`. Apple Silicon Macs and ARM hosts require Docker's Rosetta emulation layer (set in Docker Desktop settings).

---

## Luna Client Setup

### Step 1 — Obtain Luna Client Binaries from DPoD Portal

1. Log in to the Thales DPoD portal for your HSM partition.
2. Download the Luna Network HSM client package: `cvclient-min.tar` (the minimal client).
3. Download your partition certificates:
   - `partition-ca-certificate.pem`
   - `partition-certificate.pem`
   - `server-certificate.pem`
4. Download or generate `Chrystoki.conf` — this is the primary Luna client configuration file. It must reference the hostname and port of your DPoD endpoint (typically `na.hsm.dpondemand.io:1792`).

### Step 2 — Place Files in `luna-client/`

```
luna-client/
├── cvclient-min.tar              # Luna client binaries (tar archive)
├── Chrystoki.conf                # HSM partition configuration
├── partition-ca-certificate.pem  # CA cert for mTLS
├── partition-certificate.pem     # Client cert for mTLS
└── server-certificate.pem        # Server cert for mTLS
```

These files are excluded from version control via `.gitignore`. They contain customer-specific credentials and must never be committed to git.

### Step 3 — Verify Chrystoki.conf

Open `Chrystoki.conf` and confirm:
- `ServerName00` points to your DPoD endpoint hostname (e.g. `na.hsm.dpondemand.io`)
- `ServerPort00` is set to `1792`
- Certificate paths in the conf will be rewritten to `/opt/lunaclient/` by `setenv` during build

---

## Docker Deployment Steps

### 1. Clone the Repository

```bash
git clone https://github.com/khansufyaan/BLUEWALLETS.git
cd BLUEWALLETS
```

### 2. Place Luna Client Files

```bash
cp /secure/path/cvclient-min.tar             luna-client/
cp /secure/path/Chrystoki.conf               luna-client/
cp /secure/path/partition-ca-certificate.pem luna-client/
cp /secure/path/partition-certificate.pem    luna-client/
cp /secure/path/server-certificate.pem       luna-client/
```

### 3. Build the Docker Image

```bash
docker compose -f docker-compose.luna.yml build
```

The build process:
- Compiles TypeScript in a multi-stage builder
- Copies Luna client binaries into `/opt/lunaclient/`
- Runs `source setenv` at build time to rewrite absolute paths in `Chrystoki.conf`
- Sets `ChrystokiConfigurationPath=/opt/lunaclient` as a permanent ENV variable

### 4. Start the Service

```bash
docker compose -f docker-compose.luna.yml up -d
```

### 5. Verify Health

```bash
curl http://localhost:3100/health
```

Expected response includes `"hsm": { "connected": true }` once the ceremony is complete.

---

## First-Time Setup Checklist

After starting the service, complete the following before going to production:

- [ ] Open `http://your-server:3100` in a browser
- [ ] Log in with `admin` / `Admin1234!`
- [ ] Navigate to `#/ceremony` to run the Key Ceremony wizard
- [ ] **Step 1 — Connect HSM**: Enter the PKCS#11 library path (`/opt/lunaclient/libs/64/libCryptoki2.so`) and partition CO PIN
- [ ] **Step 3 — Officer Approval**: Have two officers log in and approve (using officer1/2/3 accounts)
- [ ] Complete all 8 ceremony steps to seal the master key into the HSM
- [ ] Change all default passwords immediately after first login:
  - `admin` → strong unique password
  - `officer1`, `officer2`, `officer3` → individual strong passwords
  - `auditor` → strong unique password
- [ ] Verify HSM is connected: green indicator in the UI header
- [ ] Create your first vault and wallet to confirm end-to-end operation

---

## Health Check Endpoint

```
GET /health
```

Returns JSON with HSM connection status, token info, and PKCS#11 slot details.

```json
{
  "status": "ok",
  "hsm": {
    "connected": true,
    "tokenInfo": {
      "label": "your-partition-label",
      "model": "Luna Cloud HSM",
      "serialNumber": "1234567"
    }
  }
}
```

The Docker Compose health check polls this endpoint every 10 seconds with a 5-second timeout.

---

## Firewall and Network Requirements

| Direction | Protocol | Port | Destination | Purpose |
|---|---|---|---|---|
| Outbound | HTTPS/TLS | 443 | `na.hsm.dpondemand.io` | DPoD HSM partition connection |
| Outbound | TCP | 1792 | DPoD endpoint IP | Luna Network HSM NTLS |
| Inbound | HTTP | 3100 | Internal network | Blue Wallets UI and API |

> For air-gapped deployments with an on-premises Luna Network HSM, replace the DPoD endpoint with your internal HSM appliance hostname/IP.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | HTTP port the server listens on |
| `NODE_ENV` | `production` | Node environment |
| `LOG_LEVEL` | `info` | Winston log level (error/warn/info/debug) |
| `ChrystokiConfigurationPath` | `/opt/lunaclient` | Luna client config directory (set at build time) |
| `HSM_PKCS11_LIB` | `/opt/lunaclient/libs/64/libCryptoki2.so` | Path to PKCS#11 shared library |
| `HSM_SLOT_INDEX` | `0` | HSM slot index (usually 0 for single partition) |
| `HSM_PIN` | — | HSM partition CO/User PIN (set at runtime via UI or env) |
| `HSM_USE_SOFTHSM` | `false` | Set `true` for SoftHSM2 development mode |

> Do not set `HSM_PIN` in docker-compose files or environment files that are committed to git. Enter it via the ceremony wizard UI or pass it as a Docker secret.

---

## Backup and Recovery

The master key exists in two forms:
1. **Sealed in HSM** — non-extractable, lives only in the partition
2. **Shamir shares (3-of-5)** — five physical shares distributed to five custodians

To recover the master key after an HSM failure:
1. Provision a new HSM partition
2. Run the Key Ceremony again (new key) — the old key is irrecoverable unless the HSM partition backup was exported via Luna Backup HSM
3. Collect 3 of the 5 Shamir shares and enter them in the Reconstruct step

> For production: set up Luna HSM partition backup to a Luna Backup HSM appliance before running the ceremony. Consult Thales documentation for partition backup procedures.

---

## Log Management

Logs are written to stdout in JSON format. Collect them with your existing log aggregation pipeline (ELK, Splunk, Datadog, etc.):

```bash
# Tail logs
docker compose -f docker-compose.luna.yml logs -f

# Export logs
docker compose -f docker-compose.luna.yml logs > blue-wallets-$(date +%Y%m%d).log
```

Log level can be set to `debug` for troubleshooting HSM connectivity issues. **Do not run `debug` in production** — it produces verbose PKCS#11 call logs.
