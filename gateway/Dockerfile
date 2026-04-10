FROM node:20-alpine

# Install openssl for auto-generating self-signed TLS cert
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npx tsc

# Entrypoint: auto-generate self-signed TLS cert if not present, then start server
COPY <<'ENTRYPOINT' /app/entrypoint.sh
#!/bin/sh
set -e

# Auto-generate self-signed TLS cert for Ops Dashboard if not already present
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
  echo "TLS certificate generated at $TLS_CERT"
fi

export OPS_TLS_CERT="$TLS_CERT"
export OPS_TLS_KEY="$TLS_KEY"

exec node dist/index.js
ENTRYPOINT
RUN chmod +x /app/entrypoint.sh

EXPOSE 3100 3400

HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["/app/entrypoint.sh"]
