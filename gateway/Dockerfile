# ============================================================
# Blue Gateway — Bank-facing API + Ops Console (DMZ tier)
# ============================================================

# ── Build stage ──
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
RUN npm prune --omit=dev

# ── Runtime stage ──
FROM node:20-alpine

# openssl for self-signed TLS, tini for proper signal handling, curl for healthchecks
RUN apk add --no-cache openssl tini curl

# Non-root user
RUN addgroup -S blue && adduser -S blue -G blue -u 1001

WORKDIR /app
COPY --from=builder --chown=blue:blue /app/node_modules ./node_modules
COPY --from=builder --chown=blue:blue /app/dist ./dist
COPY --from=builder --chown=blue:blue /app/package.json ./
COPY --chown=blue:blue public/ ./public/

# Entrypoint: auto-generate self-signed TLS cert if not present, then start server.
# Set OPS_TLS_DISABLE=true to serve the Ops Dashboard over plain HTTP (needed when
# opening the dashboard from a browser that rejects self-signed certs on a VM IP).
COPY --chown=blue:blue <<'ENTRY' /app/entrypoint.sh
#!/bin/sh
set -e

if [ "$OPS_TLS_DISABLE" = "true" ] || [ "$OPS_TLS_DISABLE" = "1" ]; then
  echo "Ops Dashboard TLS disabled (OPS_TLS_DISABLE=$OPS_TLS_DISABLE) — serving plain HTTP on :3400"
  unset OPS_TLS_CERT
  unset OPS_TLS_KEY
else
  TLS_DIR="/tmp/tls"
  TLS_CERT="${TLS_DIR}/console-tls-cert.pem"
  TLS_KEY="${TLS_DIR}/console-tls-key.pem"

  if [ ! -f "$TLS_CERT" ] || [ ! -f "$TLS_KEY" ]; then
    echo "Generating self-signed TLS certificate for Ops Dashboard..."
    mkdir -p "$TLS_DIR"
    openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$TLS_KEY" -out "$TLS_CERT" \
      -days 3650 -subj "/CN=blue-console" \
      -addext "subjectAltName=DNS:localhost,DNS:blue-console,IP:127.0.0.1" \
      2>/dev/null
  fi

  export OPS_TLS_CERT="$TLS_CERT"
  export OPS_TLS_KEY="$TLS_KEY"
fi

exec node dist/index.js
ENTRY
RUN chmod +x /app/entrypoint.sh

# Default to plain HTTP on the Ops Dashboard — self-signed TLS on a VM IP is
# blocked by Chrome. Enterprise deployments fronted by a real cert can set
# OPS_TLS_DISABLE=false to re-enable the in-container TLS path.
ENV OPS_TLS_DISABLE=true

USER blue

EXPOSE 3100 3400

HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=30s \
  CMD curl -fs http://localhost:3100/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/entrypoint.sh"]
