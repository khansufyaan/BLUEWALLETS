# Blue Agent — on-prem AI agent for Wallets Console
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S blue && adduser -S blue -G blue
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER blue
EXPOSE 3500
CMD ["node", "dist/index.js"]
