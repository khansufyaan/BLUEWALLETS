# ============================================================
# Blue Agent — on-prem AI agent for Wallets Console
# ============================================================

# ── Build stage ──
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# ── Runtime stage ──
FROM node:20-alpine

RUN apk add --no-cache tini curl

# Non-root user (already existed — keeping consistent)
RUN addgroup -S blue && adduser -S blue -G blue -u 1001

WORKDIR /app
COPY --from=builder --chown=blue:blue /app/node_modules ./node_modules
COPY --from=builder --chown=blue:blue /app/dist ./dist
COPY --from=builder --chown=blue:blue /app/package.json ./

# Pre-create data dir with correct ownership for volume mounts
RUN mkdir -p /data/conversations && chown -R blue:blue /data

USER blue

EXPOSE 3500

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD curl -fs http://localhost:3500/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
