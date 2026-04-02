FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npx tsc

EXPOSE 3100 3400

HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["node", "dist/index.js"]
