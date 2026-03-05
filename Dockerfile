# ── Stage 1: build the React frontend ───────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies for the proxy server
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy proxy server source
COPY server.ts ./
COPY tsconfig.json ./

# tsx is needed to run server.ts directly (it's a devDep, install it explicitly)
RUN npm install tsx

EXPOSE 3001

# Serve static files from dist/ AND proxy /api/* to ClickHouse
CMD ["node", "--import", "tsx/esm", "server.ts"]
