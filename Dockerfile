# the-relay UI — Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sdk/package.json ./packages/sdk/
COPY tsconfig.json next.config.mjs postcss.config.mjs tailwind.config.ts ./

RUN npm ci

COPY src ./src
COPY public ./public
COPY packages/sdk/src ./packages/sdk/src

# NEXT_PUBLIC_* vars are inlined at build time — pass your server's hostname:
#   docker build --build-arg RELAY_URL=wss://relay.example.com ...
ARG RELAY_URL=ws://localhost:4869
ENV NEXT_PUBLIC_RELAY_URL=$RELAY_URL
ENV DOCKER_BUILD=1

RUN npm run build

# ─── Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Next's standalone server reads HOSTNAME to decide what to bind and how to
# build absolute URLs. Docker defaults it to the container id, which then
# appears in redirects as an unresolvable host over plain http.
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public

EXPOSE 3000

CMD ["node", "server.js"]
