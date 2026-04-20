# ============================================================
# Blue WaaS KMS — Development / POC image
#
# Uses SoftHSM2 for local testing. Not for production.
# Production deployments should use Dockerfile.driver with a
# real HSM PKCS#11 library mounted.
# ============================================================

# ── Build stage ──
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# ── Runtime stage ──
FROM node:22-bookworm-slim

# SoftHSM2 for dev/test. For production, use Dockerfile.driver instead.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      softhsm2 curl ca-certificates tini && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r blue --gid 1001 && useradd -r -g blue --uid 1001 -m -s /bin/bash blue

WORKDIR /app
COPY --from=builder --chown=blue:blue /app/dist ./dist
COPY --from=builder --chown=blue:blue /app/node_modules ./node_modules
COPY --from=builder --chown=blue:blue /app/package.json ./
COPY --chown=blue:blue scripts/ ./scripts/

# Give the non-root user ownership of SoftHSM token directory
# Note: the actual PIN is set at runtime via softhsm2-util from an entrypoint, NOT baked in
RUN mkdir -p /var/lib/softhsm/tokens && \
    chown -R blue:blue /var/lib/softhsm/tokens && \
    echo "directories.tokendir = /var/lib/softhsm/tokens" > /etc/softhsm2.conf

# Default dev env — OVERRIDE these for any deployment
ENV HSM_USE_SOFTHSM=true
ENV SOFTHSM_LIB=/usr/lib/softhsm/libsofthsm2.so
ENV SOFTHSM2_CONF=/etc/softhsm2.conf
ENV HSM_SLOT_INDEX=0
ENV HSM_LABEL=waas-dev
ENV PORT=3100
ENV NODE_ENV=production

USER blue

# Initialize the HSM slot at runtime (not build time) so the PIN comes from env
COPY --chown=blue:blue <<'ENTRY' /app/entrypoint.sh
#!/bin/bash
set -e
: "${HSM_PIN:?HSM_PIN env var is required}"
: "${HSM_SO_PIN:?HSM_SO_PIN env var is required}"
# Initialize only if slot is empty
if ! softhsm2-util --show-slots | grep -q "Label: *${HSM_LABEL}"; then
  echo "Initializing SoftHSM slot: ${HSM_LABEL}"
  softhsm2-util --init-token --slot 0 --label "${HSM_LABEL}" \
    --pin "${HSM_PIN}" --so-pin "${HSM_SO_PIN}"
fi
exec node dist/index.js
ENTRY
RUN chmod +x /app/entrypoint.sh

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=60s \
  CMD curl -fs -o /dev/null http://localhost:${PORT:-3100}/health || exit 1

EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
