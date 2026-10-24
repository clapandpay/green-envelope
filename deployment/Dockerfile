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
# Built context is the repository root. Published by .github/workflows/green-envelope.yml on a release.

# ---------------------------------------------------------------------------------------------
# Build: the web bundle. Nothing from this stage reaches the runtime except apps/web/dist.
# The bundle is the same for every platform, so in a multi-platform build this stage runs once,
# natively on the builder, rather than once per platform under emulation.
# ---------------------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:24-slim AS build
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
COPY packages/vault/package.json ./packages/vault/
COPY packages/passkey-signer/package.json ./packages/passkey-signer/
COPY packages/wallet/package.json ./packages/wallet/
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

COPY . .
# Which chain this image is for. Mainnet unless the build says otherwise; a person can still
# open a single link on the other chain with `?net=`, which is what testnet links carry.
ARG VITE_NETWORK=mainnet
# The commit the footer names next to the release number. The context has no .git, so the
# release workflow passes it in.
ARG GIT_COMMIT=unknown
# The faucet behind /hello (docs/faucet.md). Empty means /hello shows the stamped demo envelope
# and never touches the network. These are read at build time, so they belong to the image: set
# the repository variable FAUCET_URL (green-envelope.yml passes it) or build with --build-arg.
ARG VITE_FAUCET_URL=
ARG VITE_FAUCET_ORIGINS=
RUN VITE_NETWORK="$VITE_NETWORK" GIT_COMMIT="$GIT_COMMIT" \
    VITE_FAUCET_URL="$VITE_FAUCET_URL" VITE_FAUCET_ORIGINS="$VITE_FAUCET_ORIGINS" \
    pnpm --filter web build

# ---------------------------------------------------------------------------------------------
# Runtime: sources and production dependencies only. apps/edge and @ge/chia ship as TypeScript —
# Node strips the types itself from 22.15, which is why there is no bundler in the way.
# ---------------------------------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
# No PORT: the server then listens on 80 (what ONCE and other one-click hosts expect) and on
# 8787 (what this image always used). Every setting has a default, so the image starts with none.
ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
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
EXPOSE 80 8787

# /up is a plain 200: it proves the handler is assembled, not just that the port is open.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/edge/src/node.ts"]
