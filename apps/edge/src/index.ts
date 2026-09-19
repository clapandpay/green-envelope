// SPDX-License-Identifier: AGPL-3.0-or-later
// The worker entry. Nothing here is specific to one runtime: `env` is a bag of strings plus an
// optional `ASSETS` binding that answers requests for static files.
import { createChainLookup } from './chain';
import { type Config, configFromEnv, type Env } from './config';
import { createHandler, type Handler } from './handler';
import { sharePuzzleHashes } from './shares';

const handlers = new WeakMap<Env, Handler>();

function notFound(): Promise<Response> {
  return Promise.resolve(new Response('not found', { status: 404 }));
}

// A lone endpoint may use the whole preview budget; with a fallback configured, the first one
// gets two thirds so that the second still has a chance.
function attemptTimeoutMs(config: Config): number {
  const share = config.chainEndpoints.length > 1 ? 2 / 3 : 1;
  return Math.ceil(config.shareLookupBudgetMs * share);
}

/** Builds a handler with the real dependencies for one environment. */
export function handlerFromEnv(env: Env): Handler {
  const config = configFromEnv(env);
  const assets = env.ASSETS;
  return createHandler({
    config,
    shares: sharePuzzleHashes,
    chain: createChainLookup({
      endpoints: config.chainEndpoints,
      fetch: (input, init) => fetch(input, init),
      attemptTimeoutMs: attemptTimeoutMs(config),
    }),
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    assets: assets === undefined ? notFound : (request) => assets.fetch(request),
  });
}

// The caches of a handler (price, shell, share state) must outlive a request, so there is one
// handler per `env` object.
function handlerFor(env: Env): Handler {
  const existing = handlers.get(env);
  if (existing !== undefined) return existing;
  const created = handlerFromEnv(env);
  handlers.set(env, created);
  return created;
}

export default {
  /** The module-worker entry point (Cloudflare Workers, Deno, Bun). */
  fetch(request: Request, env: Env): Promise<Response> {
    return handlerFor(env)(request);
  },
};
