// SPDX-License-Identifier: AGPL-3.0-or-later
// The faucet client: asks the owner's endpoint for a fresh envelope link. The body is never
// trusted: it is size-capped, parsed strictly, and the link inside is taken apart and rebuilt, so
// only a path inside this app can ever come out of here (no redirects, no `javascript:`).
// Contract: docs/faucet.md.
import { decodeLink, encodeLink } from '@ge/envelope';

export type FaucetResult =
  /** `path` is an in-app path with its fragment: `/g/<key>?...#<secret>`. */
  | { kind: 'link'; path: string }
  | { kind: 'empty' }
  | { kind: 'limited'; retryAfterSeconds: number }
  /** No answer: offline, timed out, or not reachable. */
  | { kind: 'offline' }
  /** An answer that makes no sense, or a server error. */
  | { kind: 'broken' };

export interface FaucetConfig {
  /** The endpoint, `https:` (or `http:` on localhost). */
  readonly url: string;
  /** Origins a link may name; always includes the page's own. */
  readonly origins: readonly string[];
}

export const FAUCET_TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 4096;
const MAX_LINK_CHARS = 2048;
/** A Retry-After used when the server gives none. */
export const DEFAULT_RETRY_SECONDS = 30;
/** The longest wait we will show. */
export const MAX_RETRY_SECONDS = 3600;

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** `https:` always; `http:` only on localhost, for development. No credentials in the URL. */
function safeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname))) {
    return url;
  }
  return null;
}

/**
 * Reads the build-time settings. Returns null (/hello goes to the app's start) when there is no usable
 * `VITE_FAUCET_URL`. `allowed` is a comma-separated list of extra origins for the links.
 */
export function faucetConfig(
  url: string | undefined,
  allowed: string | undefined,
  pageOrigin: string,
): FaucetConfig | null {
  const endpoint = safeUrl((url ?? '').trim());
  if (endpoint === null) return null;
  const origins = new Set<string>([pageOrigin]);
  for (const entry of (allowed ?? '').split(',')) {
    const origin = safeUrl(entry.trim());
    if (origin !== null) origins.add(origin.origin);
  }
  return { url: endpoint.href, origins: [...origins] };
}

/** Turns a link from the faucet into an in-app path, or null. Pure. */
export function acceptFaucetLink(link: unknown, origins: readonly string[]): string | null {
  if (typeof link !== 'string' || link.length === 0 || link.length > MAX_LINK_CHARS) return null;
  // Spaces, control characters and backslashes are how links get smuggled past a parser.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  if (/[\u0000- \u007f\\]/.test(link)) return null;
  const url = safeUrl(link);
  if (url === null || !origins.includes(url.origin)) return null;
  if (!/^\/g\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.hash.length < 2) return null;
  try {
    // The codec is the judge of what a link is; what we keep is what it understood.
    const clean = new URL(encodeLink(url.origin, decodeLink(link)));
    return `${clean.pathname}${clean.search}${clean.hash}`;
  } catch {
    return null;
  }
}

/** Seconds from a `Retry-After` header (a number of seconds or a date), clamped. Pure. */
export function parseRetryAfter(header: string | null, nowMs: number): number {
  const value = header?.trim() ?? '';
  let seconds = Number.NaN;
  if (/^\d{1,9}$/.test(value)) seconds = Number(value);
  else if (/^[A-Za-z]{3},/.test(value)) seconds = Math.ceil((Date.parse(value) - nowMs) / 1000);
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_SECONDS;
  return Math.min(Math.max(Math.trunc(seconds), 1), MAX_RETRY_SECONDS);
}

/** What the body of a 200 answer means. Pure; accepts only the two documented shapes. */
export function parseFaucetBody(body: unknown, origins: readonly string[]): FaucetResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'broken' };
  const fields = body as Record<string, unknown>;
  if ('status' in fields) {
    return fields.status === 'empty' && !('link' in fields)
      ? { kind: 'empty' }
      : { kind: 'broken' };
  }
  const path = acceptFaucetLink(fields.link, origins);
  return path === null ? { kind: 'broken' } : { kind: 'link', path };
}

async function attempt(
  config: FaucetConfig,
  fetcher: typeof fetch,
  nowMs: number,
): Promise<FaucetResult | 'network'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAUCET_TIMEOUT_MS);
  try {
    const response = await fetcher(config.url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error', // an answer that redirects is not the answer we agreed on
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 429) {
      return {
        kind: 'limited',
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'), nowMs),
      };
    }
    if (!response.ok) return { kind: 'broken' };
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) return { kind: 'broken' };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { kind: 'broken' };
    }
    return parseFaucetBody(body, config.origins);
  } catch {
    return 'network'; // refused, offline, timed out, or aborted
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the faucet for an envelope. One retry after a network failure, never after an answer. */
export async function requestFaucet(
  config: FaucetConfig,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<FaucetResult> {
  const first = await attempt(config, fetcher, now());
  if (first !== 'network') return first;
  const second = await attempt(config, fetcher, now());
  return second === 'network' ? { kind: 'offline' } : second;
}

// ---- what this device remembers ------------------------------------------------------------

/** localStorage key of the envelope this device was given (an in-app path). */
export const PREF_FAUCET = 'ge.faucet';

/**
 * Re-checks a remembered path as strictly as a fresh answer, or null. The path holds the
 * envelope's secret, the same secret the wallet in this browser already guards; it is kept so a
 * reload, a back button or a closed tab never loses a gift.
 */
export function parseRemembered(stored: string | null, pageOrigin: string): string | null {
  if (stored === null) return null;
  return acceptFaucetLink(`${pageOrigin}${stored}`, [pageOrigin]);
}
