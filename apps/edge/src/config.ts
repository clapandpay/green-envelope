// SPDX-License-Identifier: AGPL-3.0-or-later

/** The Chia network the deployment talks to. */
export type NetworkName = 'mainnet' | 'testnet11';

/** Static settings of one deployment; everything that varies per request is elsewhere. */
export interface Config {
  readonly network: NetworkName;
  /** Key for the recipient judgment; null turns the feature off cleanly. */
  readonly typesafeApiKey: string | null;
  /** Coinset-compatible base URLs without a trailing slash, tried in order. */
  readonly chainEndpoints: readonly string[];
  /**
   * Bearer key for the first configured endpoint (a node that needs one, like nodexch), or null.
   * Read from the environment at start, never built into an image, never sent to the browser,
   * and never sent to any other endpoint.
   */
  readonly chainApiKey: string | null;
  /**
   * The node the browser talks to directly, and its key: public by design (a key restricted to
   * this origin on the node's side). Handed to the page at runtime in a `<meta name="ge-chain">`,
   * so the image holds no node and no key. Null: the page uses the public node.
   */
  readonly browserChain: {
    readonly endpoints: readonly string[];
    readonly apiKey: string | null;
  } | null;
  /** Origin used in absolute URLs and for CORS; `null` means "the origin of the request". */
  readonly publicOrigin: string | null;
  /** The most the share lookup may delay a link preview. */
  readonly shareLookupBudgetMs: number;
  /** How long the parsed app shell is reused before it is read from the assets again. */
  readonly shellTtlSeconds: number;
}

/** The environment of the worker: plain strings plus the optional static-assets binding. */
export interface Env {
  readonly CHAIN_ENDPOINTS?: string | undefined;
  /** Bearer key for the first of `CHAIN_ENDPOINTS`; never sent anywhere else. */
  readonly CHAIN_API_KEY?: string | undefined;
  /** Nodes the browser calls directly (comma-separated), e.g. https://api.nodexch.com */
  readonly PUBLIC_CHAIN_ENDPOINTS?: string | undefined;
  /** The browser's key for the first of them. Public: every visitor can read it. */
  readonly PUBLIC_CHAIN_API_KEY?: string | undefined;
  readonly NETWORK?: string | undefined;
  readonly PUBLIC_ORIGIN?: string | undefined;
  /** The app's address as ONCE (once.com) passes it; used when `PUBLIC_ORIGIN` is not set. */
  readonly BASE_URL?: string | undefined;
  /** TypeSafe key for the recipient judgment. Absent: the route answers "no suggestion". */
  readonly TYPESAFE_API_KEY?: string | undefined;
  readonly ASSETS?: { fetch(request: Request): Promise<Response> };
}

/** The public Coinset base URL per network, used when `CHAIN_ENDPOINTS` is not set. */
export const DEFAULT_ENDPOINTS: Readonly<Record<NetworkName, string>> = {
  mainnet: 'https://api.coinset.org',
  testnet11: 'https://testnet11.api.coinset.org',
};

/** Default for `Config.shareLookupBudgetMs`. */
export const SHARE_LOOKUP_BUDGET_MS = 1500;

/** Default for `Config.shellTtlSeconds`. */
export const SHELL_TTL_SECONDS = 60;

function parseHttpUrl(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/** Normalises one endpoint to `origin + path` without a trailing slash; `null` when not http(s). */
export function normalizeEndpoint(value: string): string | null {
  const url = parseHttpUrl(value.trim());
  if (url === null) return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** Normalises `PUBLIC_ORIGIN` to a bare origin; `null` when absent or not http(s). */
export function normalizeOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  return parseHttpUrl(value.trim())?.origin ?? null;
}

/** Builds the config from environment strings; bad values fall back to safe defaults. */
export function configFromEnv(env: Env): Config {
  const network: NetworkName = env.NETWORK === 'testnet11' ? 'testnet11' : 'mainnet';
  const configured = (env.CHAIN_ENDPOINTS ?? '')
    .split(',')
    .map(normalizeEndpoint)
    .filter((endpoint) => endpoint !== null);
  const apiKey = (env.TYPESAFE_API_KEY ?? '').trim();
  const chainKey = (env.CHAIN_API_KEY ?? '').trim();
  const browserEndpoints = (env.PUBLIC_CHAIN_ENDPOINTS ?? '')
    .split(',')
    .map(normalizeEndpoint)
    .filter((endpoint) => endpoint !== null);
  const browserKey = (env.PUBLIC_CHAIN_API_KEY ?? '').trim();
  const fallback = DEFAULT_ENDPOINTS[network];
  return {
    network,
    typesafeApiKey: apiKey === '' ? null : apiKey,
    // The configured nodes, then the network's public node as the last resort: a node that
    // refuses (a wrong key, a rate limit) must not take the app down with it.
    chainEndpoints: configured.includes(fallback) ? configured : [...configured, fallback],
    chainApiKey: configured.length > 0 && chainKey !== '' ? chainKey : null,
    browserChain:
      browserEndpoints.length === 0
        ? null
        : { endpoints: browserEndpoints, apiKey: browserKey === '' ? null : browserKey },
    publicOrigin: normalizeOrigin(env.PUBLIC_ORIGIN) ?? normalizeOrigin(env.BASE_URL),
    shareLookupBudgetMs: SHARE_LOOKUP_BUDGET_MS,
    shellTtlSeconds: SHELL_TTL_SECONDS,
  };
}
