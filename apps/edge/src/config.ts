// SPDX-License-Identifier: AGPL-3.0-or-later

/** The Chia network the deployment talks to. */
export type NetworkName = 'mainnet' | 'testnet11';

/** Static settings of one deployment; everything that varies per request is elsewhere. */
export interface Config {
  readonly network: NetworkName;
  /** Coinset-compatible base URLs without a trailing slash, tried in order. */
  readonly chainEndpoints: readonly string[];
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
  readonly NETWORK?: string | undefined;
  readonly PUBLIC_ORIGIN?: string | undefined;
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
  return {
    network,
    chainEndpoints: configured.length > 0 ? configured : [DEFAULT_ENDPOINTS[network]],
    publicOrigin: normalizeOrigin(env.PUBLIC_ORIGIN),
    shareLookupBudgetMs: SHARE_LOOKUP_BUDGET_MS,
    shellTtlSeconds: SHELL_TTL_SECONDS,
  };
}
