// SPDX-License-Identifier: AGPL-3.0-or-later

/** The XCH price in EUR and the unix second it was fetched. */
export interface PriceQuote {
  readonly eur: number;
  readonly at: number;
}

/** Source of the current price; resolves to `null` when there is nothing fresh or stale enough. */
export type PriceSource = () => Promise<PriceQuote | null>;

/** Dependencies of `createPriceSource`. */
export interface PriceDeps {
  readonly fetch: typeof fetch;
  /** Unix milliseconds. */
  readonly now: () => number;
}

/** CoinGecko's public simple-price endpoint for XCH in EUR. */
export const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=chia&vs_currencies=eur';
/** A quote younger than this is served without asking upstream. */
export const FRESH_SECONDS = 60;
/** When upstream fails, a quote up to this old is still served. */
export const STALE_IF_ERROR_SECONDS = 3600;
/** After a failed upstream request, the next one waits this long (CoinGecko rate-limits its public API). */
export const RETRY_AFTER_SECONDS = 10;
/** Timeout of the upstream request. */
export const PRICE_TIMEOUT_MS = 3000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads `{"chia":{"eur":n}}`; `null` unless `n` is a positive finite number. */
export function parsePrice(body: unknown): number | null {
  if (!isRecord(body) || !isRecord(body.chia)) return null;
  const { eur } = body.chia;
  return typeof eur === 'number' && Number.isFinite(eur) && eur > 0 ? eur : null;
}

/** Creates the cached price source: fresh for 60 s, single-flight upstream, stale-if-error for 1 h. */
export function createPriceSource(deps: PriceDeps): PriceSource {
  let cached: PriceQuote | null = null;
  let inFlight: Promise<PriceQuote | null> | null = null;
  let failedAt: number | null = null;

  const seconds = () => Math.floor(deps.now() / 1000);
  const notOlderThan = (maxAge: number): PriceQuote | null =>
    cached !== null && seconds() - cached.at < maxAge ? cached : null;

  const fetchQuote = async (): Promise<PriceQuote | null> => {
    const response = await deps.fetch(PRICE_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const eur = parsePrice(await response.json());
    return eur === null ? null : { eur, at: seconds() };
  };

  const refresh = async (): Promise<PriceQuote | null> => {
    const quote = await fetchQuote().catch(() => null);
    if (quote !== null) cached = quote;
    failedAt = quote === null ? seconds() : null;
    return quote ?? notOlderThan(STALE_IF_ERROR_SECONDS);
  };

  return () => {
    const fresh = notOlderThan(FRESH_SECONDS);
    if (fresh !== null) return Promise.resolve(fresh);
    if (failedAt !== null && seconds() - failedAt < RETRY_AFTER_SECONDS) {
      return Promise.resolve(notOlderThan(STALE_IF_ERROR_SECONDS));
    }
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
