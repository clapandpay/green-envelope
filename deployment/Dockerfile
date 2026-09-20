# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 the Clap and Pay authors
#
# Green Envelope as one deployable image: the built web app plus the edge handler that writes the
# per-link Open Graph tags, on Node's own HTTP server.
#
# Cloudflare Workers stays the documented deployment (apps/edge/README.md, wrangler.sample.toml).
# This is the alternative for anyone who would rather run it themselves, and it is the same
# handler either way — apps/edge is written to web-standard Request/Response precisely so that
# the runtime is a choice.
#
# Built context is green-envelope/. Published by .github/workflows/release.yml on a release.

# ---------------------------------------------------------------------------------------------
# Build: the web bundle. Nothing from this stage reaches the runtime except apps/web/dist.
# ---------------------------------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# The manifests first: this layer is what the dependency cache hangs on, and it only changes
# when a dependency does, not when a component does.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/edge/package.json ./apps/edge/
COPY apps/web/package.json ./apps/web/
COPY packages/chain/package.json ./packages/chain/
COPY packages/chia/package.json ./packages/chia/
COPY packages/envelope/package.json ./packages/envelope/
COPY packages/handoff/package.json ./packages/handoff/
COPY packages/wallet/package.json ./packages/wallet/
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

COPY . .
# apps/web/public/og/*.png are copied into dist by Vite, which is where the preview images have
# to end up for WhatsApp and the rest to find them.
RUN pnpm --filter web build

# ---------------------------------------------------------------------------------------------
# Runtime: sources and production dependencies only. apps/edge and @ge/chia ship as TypeScript —
# Node strips the types itself from 22.15, which is why there is no bundler in the way.
# ---------------------------------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PORT=8787
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/edge ./apps/edge
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
# --prod leaves out vite, vitest, biome and TypeScript: what is left is @noble/curves and
# @noble/hashes, the only things @ge/chia needs at runtime.
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile --prod \
 && rm -rf /root/.cache

COPY --from=build /app/apps/web/dist ./apps/web/dist

# The server reads no secrets and writes no files.
USER node
EXPOSE 8787

# /healthz is a plain 200: it proves the handler is assembled, not just that the port is open.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/edge/src/node.ts"]
