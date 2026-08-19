# the-relay Relay — Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files (workspace config)
COPY package.json package-lock.json ./
COPY packages/relay/package.json ./packages/relay/
COPY packages/relay/tsconfig.json ./packages/relay/
COPY packages/sdk/package.json    ./packages/sdk/

# Install all workspace deps (relay + sdk share noble/hashes)
RUN npm ci --workspace=packages/relay --workspace=packages/sdk

# Copy source
COPY packages/relay/src ./packages/relay/src
COPY packages/sdk/src   ./packages/sdk/src

# Build relay TypeScript → JavaScript
WORKDIR /app/packages/relay
RUN npx tsc

# ─── Runtime image ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy compiled output and production deps
COPY --from=builder /app/packages/relay/dist ./dist
COPY --from=builder /app/node_modules         ./node_modules
COPY --from=builder /app/packages/relay/package.json ./

# Operator scripts. These run against the database in the volume, which only
# exists inside a container — an image without them means copying a script into
# a running relay by hand before anything can be looked at.
COPY packages/relay/scripts ./scripts

# sql.js WASM file must be accessible
# (it's in node_modules/sql.js/dist — already copied above)

# Data volume for the SQLite database
VOLUME ["/data"]

ENV PORT=4869
ENV DB_PATH=/data/relay.db

EXPOSE 4869

CMD ["node", "dist/index.js"]
