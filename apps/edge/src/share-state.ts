// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChainLookup, ShareCoin } from './chain';
import type { ShareState } from './copy';
import { createLru } from './lru';

/** Derives the puzzle hashes of shares `0..count-1` from the envelope public key; may throw on a key that is not a curve point. */
export type SharesFn = (publicKey: Uint8Array, count: number) => Uint8Array[];

/** Looks up how many shares of an envelope exist and how many are left; never rejects. */
export type ShareStateLookup = (
  key: string,
  publicKey: Uint8Array,
  /** The link's `n`: how many shares to look for. Anything else means all `MAX_SHARES`. */
  sharesHint?: number,
) => Promise<ShareState>;

/** Dependencies of `createShareStateLookup`. */
export interface ShareStateDeps {
  readonly shares: SharesFn;
  readonly chain: ChainLookup;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly budgetMs: number;
}

/** A usable share count from the link's `n`, or every possible share. */
export function shareCount(hint: number | undefined): number {
  return hint !== undefined && Number.isInteger(hint) && hint >= 1 && hint <= MAX_SHARES
    ? hint
    : MAX_SHARES;
}

/** The most shares an envelope can have (`MAX_SHARES` of `@ge/envelope`). */
export const MAX_SHARES = 100;
/** How long a counted state is reused; equals the `max-age` of the page. */
export const STATE_TTL_MS = 30_000;
/** Envelopes whose state or derived puzzle hashes are kept in memory. */
export const CACHED_ENVELOPES = 256;

const UNKNOWN: ShareState = { kind: 'unknown' };

interface StateEntry {
  readonly expiresAt: number;
  readonly state: Promise<ShareState>;
}

/** Shares that exist are the coin records found, shares left are the unspent ones; no records means "not seen yet". */
export function summarizeShares(coins: readonly ShareCoin[]): ShareState {
  if (coins.length === 0) return UNKNOWN;
  const left = coins.reduce((count, coin) => (coin.spent ? count : count + 1), 0);
  return { kind: 'counted', total: coins.length, left };
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException('share lookup budget exceeded', 'TimeoutError'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

/** Creates the lookup: one batched chain request per envelope, bounded by the budget, single-flight and cached for 30 s. */
export function createShareStateLookup(deps: ShareStateDeps): ShareStateLookup {
  // Deriving 100 child keys is the expensive part and its result never changes.
  const derived = createLru<Uint8Array[]>(CACHED_ENVELOPES);
  const states = createLru<StateEntry>(CACHED_ENVELOPES);

  const puzzleHashes = (key: string, publicKey: Uint8Array, count: number): Uint8Array[] => {
    const cached = derived.get(key);
    if (cached !== undefined) return cached;
    const hashes = deps.shares(publicKey, count);
    derived.set(key, hashes);
    return hashes;
  };

  const lookup = async (key: string, publicKey: Uint8Array, count: number): Promise<ShareState> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.budgetMs);
    try {
      const { signal } = controller;
      const hashes = puzzleHashes(key, publicKey, count);
      const coins = await Promise.race([
        deps.chain.coinRecordsByPuzzleHashes(hashes, { signal }),
        rejectOnAbort(signal),
      ]);
      return summarizeShares(coins);
    } catch {
      return UNKNOWN;
    } finally {
      clearTimeout(timer);
    }
  };

  return (envelope, publicKey, sharesHint) => {
    const count = shareCount(sharesHint);
    // The count is part of the key: a link with a wrong `n` must not poison the right one.
    const key = `${envelope}:${count}`;
    const cached = states.get(key);
    if (cached !== undefined && cached.expiresAt > deps.now()) return cached.state;
    const entry: StateEntry = {
      expiresAt: deps.now() + STATE_TTL_MS,
      state: lookup(key, publicKey, count).then((state) => {
        // Failures and "not seen yet" are not remembered: the next request asks again.
        if (state.kind === 'unknown' && states.get(key) === entry) states.delete(key);
        return state;
      }),
    };
    states.set(key, entry);
    return entry.state;
  };
}
