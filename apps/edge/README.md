# edge

The small server-side piece of Green Envelope: per-link Open Graph tags so that a link looks like
a gift in WhatsApp, Telegram, iMessage and Discord, the EUR price, and an allow-listed proxy to
the chain. Web-standard `Request`/`Response` only: the same code runs on Cloudflare Workers, Deno,
Bun and Node ≥ 22. No runtime dependency besides `@ge/chia`.

The server sees the envelope's **public** key in the path. From it, it derives the address of
every share (unhardened children) and asks the chain which exist and which are spent. It can never
open one: the secret is in the URL fragment, which browsers do not send.

## Routes

| Route | What |
| --- | --- |
| `GET /g/:pk?from=&m=` | The app shell (`/index.html` from the assets) with `<title>`, description, `og:*` and `twitter:card` written into `<head>`. `:pk` must be base64url of 48 bytes, otherwise the generic shell with status 404. `from` (40) and `m` (120 characters) are stripped of control and bidi characters and HTML-escaped. German when `Accept-Language` starts with `de`, else English. Share state: up to 100 share puzzle hashes, one batched chain request, at most 1.5 s, then a description without counts. `cache-control: public, max-age=30, stale-while-revalidate=120`, `vary: accept-language`, `x-robots-tag: noindex`. |
| `GET /`, `GET /new`, `GET /new/*` | The shell with generic tags (SPA fallback). |
| `GET /api/price` | `{ "eur": number, "at": unixSeconds }` from CoinGecko. 3 s timeout, fresh for 60 s, one upstream call at a time, at most one retry per 10 s after a failure, stale-if-error up to 1 h, then `503 { "eur": null }`. |
| `POST /api/rpc/:method` | Proxy for `get_coin_records_by_puzzle_hashes`, `get_coin_record_by_name`, `get_blockchain_state`, `push_tx`. JSON object bodies up to 256 kB, 8 s per endpoint, the upstream JSON and status pass through. The next endpoint is tried on transport failure or 5xx; a `push_tx` that got a `{"success": …}` answer, whatever its status, is never sent anywhere else. Errors of the proxy itself: `{ "success": false, "error": code }` with 400, 404, 413, 415 or 502. CORS for `PUBLIC_ORIGIN` only. Bodies are never logged. |
| `POST /api/recipient` | Chooses between recipients found in one pasted block of text, when the browser found more than one. Body `{ text, candidates[], ownAddress? }`; every candidate must match the address or handle shape **and** appear in `text`, and there must be 2 to 12 of them, otherwise `400`. Answers `{ "value": string \| null, "confidence": number }`, where `value` is always one of `candidates`. Without `TYPESAFE_API_KEY`, or on any upstream failure or timeout (4 s), `{ "value": null }` with `200`: the send screen then asks the person. `no-store`, CORS for `PUBLIC_ORIGIN` only. |
| `POST /api/handle-check` | Whether an `@name` is dressed up as one the person already pays. Body `{ handle, known[] }`, all well-shaped handles, 1 to 12 known, otherwise `400`. Answers `{ "imitates": string \| null, "probability": number }`, where `imitates` is always one of `known`. Advisory only: it never decides a recipient. Without `TYPESAFE_API_KEY`, or on any failure or timeout (4 s), `{ "imitates": null }` with `200`. `no-store`, CORS for `PUBLIC_ORIGIN` only. |
| `GET /healthz` | `200 ok` |
| everything else | the static assets; HTML from there gets the security headers too |

Every HTML response carries `content-security-policy` (below), `referrer-policy: no-referrer`
(keeps the envelope path out of referrers), `x-content-type-options: nosniff` and
`permissions-policy: publickey-credentials-get=(self), publickey-credentials-create=(self)` and
`strict-transport-security: max-age=31536000` (ignored over plain http).

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self' <origin of each chain endpoint> <both public Coinset nodes>; manifest-src 'self';
worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

No inline scripts: the web build must not emit any (Vite does not, by default).

## Environment

| Variable | Default | |
| --- | --- | --- |
| `NETWORK` | `mainnet` | `mainnet` or `testnet11`; picks the default endpoint |
| `CHAIN_ENDPOINTS` | the public Coinset URL of the network | comma-separated Coinset-compatible base URLs, tried in order |
| `PUBLIC_ORIGIN` | the origin of the request | origin in `og:url` and `og:image`, and the only origin CORS allows |
| `TYPESAFE_API_KEY` | none (the route answers "no suggestion") | key for `POST /api/recipient`; stays on this side and never reaches the browser |
| `ASSETS` | none (every asset is a 404, previews use a built-in minimal shell) | binding with `fetch(request)` that serves the static files |
| `PORT` | `8787` | Node entry only |

## Run locally

```sh
pnpm --filter web build      # the shell and the app, into apps/web/dist
NETWORK=testnet11 pnpm dev:edge
curl -s 'localhost:8787/g/<pk>?from=Anna&m=Hi' | grep og:
```

`src/node.ts` is `node:http` around the same handler. It serves `apps/web/dist` and then
`apps/edge/assets` as static files, and registers a resolve hook so that Node's type stripping
finds the workspace's extensionless imports (needs Node ≥ 22.15).

On Deno or Bun, build the handler from your own environment:
`import { handlerFromEnv } from './src/index.ts'` and pass it
`{ NETWORK, CHAIN_ENDPOINTS, PUBLIC_ORIGIN, TYPESAFE_API_KEY, ASSETS: { fetch } }`.

## Preview images

`assets/og/envelope.svg` and `envelope-empty.svg` are the sources (1200×630). The pages point at
`/og/envelope.png` and `/og/envelope-empty.png`, because WhatsApp ignores SVG. After changing a
source, export again, for example `resvg envelope.svg envelope.png`, and make sure the PNGs end up
in the deployed assets under `/og/`.

## Deploying to Cloudflare Workers

`wrangler.sample.toml` has the shape: `src/index.ts` as the module worker, `apps/web/dist` as the
assets with `run_worker_first`, and the three variables. Nothing here deploys by itself.

Deriving 100 share addresses costs a few hundred milliseconds of CPU in pure JavaScript, once per
envelope and isolate (the result is kept in a 256-entry LRU, the share state for 30 s). That is
beyond the 10 ms of the Workers free plan: use a paid plan, and put a rate limit in front of `/g/*`.

## Code map

```
src/handler.ts      routing, CORS, HEAD, the one try/catch
src/pages.ts        /g/:pk and the generic shell; shell cache
src/head.ts         deterministic <head> surgery       src/text.ts   sanitise and escape
src/copy.ts         English and German strings          src/lru.ts    bounded cache
src/share-state.ts  derive, one chain request, budget, single-flight, 30 s cache
src/shares.ts       the only import of @ge/chia
src/chain.ts        ChainLookup interface and its fetch-based default (swap for @ge/chain if wanted)
src/price.ts        /api/price                          src/rpc.ts    /api/rpc/:method
src/security.ts     CSP and the other headers           src/config.ts env to Config
src/index.ts        export default { fetch }            src/node.ts   local development
```
