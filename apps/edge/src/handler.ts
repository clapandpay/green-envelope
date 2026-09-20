// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChainLookup } from './chain';
import type { Config } from './config';
import { readHandleQuestion, screenHandle } from './handle-screen';
import { type AssetsFn, createPages } from './pages';
import { createPriceSource, FRESH_SECONDS } from './price';
import { pickRecipient, readRecipientQuestion } from './recipient';
import { createRpcProxy, rpcError } from './rpc';
import { isHtml, securityHeaders, withHeaders } from './security';
import { createShareStateLookup, type SharesFn } from './share-state';

/** Everything the handler needs from the outside; all of it is replaceable in tests. */
export interface HandlerDeps {
  readonly shares: SharesFn;
  readonly chain: ChainLookup;
  readonly fetch: typeof fetch;
  /** Unix milliseconds, like `Date.now`. */
  readonly now: () => number;
  readonly assets: AssetsFn;
  readonly config: Config;
}

/** A web-standard request handler. */
export type Handler = (request: Request) => Promise<Response>;

/** Routes of the single-page app that have no file behind them and get the shell. */
export const APP_ROUTES: readonly string[] = ['/', '/new'];

const RPC_PREFIX = '/api/rpc/';
const ENVELOPE_PREFIX = '/g/';

function isRead(request: Request): boolean {
  return request.method === 'GET' || request.method === 'HEAD';
}

function isAppRoute(path: string): boolean {
  return APP_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

function methodNotAllowed(allow: string): Response {
  return new Response(null, { status: 405, headers: { allow } });
}

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  });
}

/** Builds the request handler; caches (price, shell, share state) live as long as the returned function. */
export function createHandler(deps: HandlerDeps): Handler {
  const { config, now } = deps;
  const headers = securityHeaders(config.chainEndpoints);
  const price = createPriceSource({ fetch: deps.fetch, now });
  const rpc = createRpcProxy({ fetch: deps.fetch, endpoints: config.chainEndpoints });
  const shareState = createShareStateLookup({
    shares: deps.shares,
    chain: deps.chain,
    now,
    budgetMs: config.shareLookupBudgetMs,
  });
  const pages = createPages({
    assets: deps.assets,
    config,
    shareState,
    securityHeaders: headers,
    now,
  });

  const priceRoute = async (request: Request): Promise<Response> => {
    if (!isRead(request)) return methodNotAllowed('GET, HEAD');
    const quote = await price();
    return quote === null
      ? json({ eur: null }, 503, 'no-store')
      : json(quote, 200, `public, max-age=${FRESH_SECONDS}`);
  };

  const rpcRoute = (request: Request, method: string): Promise<Response> | Response => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
    return rpc(method, request);
  };

  // Cross-origin reads of the API are for the configured public origin only.
  const withCors = (request: Request, response: Response): Response => {
    if (config.publicOrigin === null) return response;
    const cors: [string, string][] = [['vary', 'origin']];
    if (request.headers.get('origin') === config.publicOrigin) {
      cors.push(
        ['access-control-allow-origin', config.publicOrigin],
        ['access-control-allow-methods', 'GET, POST, OPTIONS'],
        ['access-control-allow-headers', 'content-type'],
        ['access-control-max-age', '86400'],
      );
    }
    return withHeaders(response, cors);
  };

  // Which of several pasted candidates is the recipient. The browser has already found and
  // checked them; this only chooses. It re-checks the shapes so the route cannot be used to
  // put arbitrary text in front of the model.
  const recipientRoute = async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
    if (config.typesafeApiKey === null) return json({ value: null }, 200, 'no-store');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_request' }, 400, 'no-store');
    }
    const asked = readRecipientQuestion(body);
    if (asked === null) return json({ error: 'bad_request' }, 400, 'no-store');

    const pick = await pickRecipient({ fetch: deps.fetch, apiKey: config.typesafeApiKey }, asked);
    // No suggestion is a normal answer: the screen then asks the person which one they meant.
    return json(pick ?? { value: null, confidence: 0 }, 200, 'no-store');
  };

  // Whether an @name is dressed up as one the person already pays. Advisory only: it adds a
  // sentence above the confirm button and never decides anything.
  const handleCheckRoute = async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
    if (config.typesafeApiKey === null) return json({ imitates: null }, 200, 'no-store');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_request' }, 400, 'no-store');
    }
    const asked = readHandleQuestion(body);
    if (asked === null) return json({ error: 'bad_request' }, 400, 'no-store');

    const verdict = await screenHandle({ fetch: deps.fetch, apiKey: config.typesafeApiKey }, asked);
    return json(verdict ?? { imitates: null, probability: 0 }, 200, 'no-store');
  };

  const api = async (request: Request, path: string): Promise<Response> => {
    if (path === '/api/price') return priceRoute(request);
    if (path === '/api/recipient') return recipientRoute(request);
    if (path === '/api/handle-check') return handleCheckRoute(request);
    if (path.startsWith(RPC_PREFIX)) return rpcRoute(request, path.slice(RPC_PREFIX.length));
    return rpcError(404, 'not_found');
  };

  const page = async (request: Request, url: URL): Promise<Response> => {
    const path = url.pathname;
    const isEnvelope = path.startsWith(ENVELOPE_PREFIX) || path === '/g';
    if ((isEnvelope || isAppRoute(path)) && !isRead(request)) return methodNotAllowed('GET, HEAD');
    if (isEnvelope) return pages.envelope(request, url, path.slice(ENVELOPE_PREFIX.length));
    if (isAppRoute(path)) return pages.generic(request, url, 200);
    const asset = await deps.assets(request);
    return isHtml(asset) ? withHeaders(asset, headers) : asset;
  };

  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok', { status: 200 });
    if (url.pathname.startsWith('/api/'))
      return withCors(request, await api(request, url.pathname));
    return page(request, url);
  };

  return async (request) => {
    try {
      const response = await route(request);
      if (request.method !== 'HEAD' || response.body === null) return response;
      await response.body.cancel();
      return new Response(null, response);
    } catch {
      return new Response('internal error', {
        status: 500,
        headers: { 'cache-control': 'no-store' },
      });
    }
  };
}
