# Multi-stage build for WaaS KMS Service
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production image
FROM node:22-bookworm-slim

# Install SoftHSM2 for dev/test (for production, mount Luna Client libs instead)
RUN apt-get update && \
    apt-get install -y --no-install-recommends softhsm2 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY scripts/ ./scripts/

# SoftHSM setup for container dev mode
RUN mkdir -p /var/lib/softhsm/tokens && \
    echo "directories.tokendir = /var/lib/softhsm/tokens" > /etc/softhsm2.conf && \
    softhsm2-util --init-token --slot 0 --label "waas-dev" --pin 1234 --so-pin 5678

ENV HSM_USE_SOFTHSM=true
ENV SOFTHSM_LIB=/usr/lib/softhsm/libsofthsm2.so
ENV SOFTHSM2_CONF=/etc/softhsm2.conf
ENV HSM_SLOT_INDEX=0
ENV HSM_PIN=1234
ENV HSM_LABEL=waas-dev
ENV PORT=3100
ENV NODE_ENV=production

EXPOSE 3100
CMD ["node", "dist/index.js"]
