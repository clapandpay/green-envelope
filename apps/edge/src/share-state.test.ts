// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { ChainLookup } from './chain';
import {
  createShareStateLookup,
  FRESH_PER_SECOND,
  MAX_SHARES,
  STATE_TTL_MS,
  shareCount,
  summarizeShares,
} from './share-state';
import { chainWith, coins, fakeShares } from './test-fakes';

const PK = new Uint8Array(48);

function lookupWith(chain: ChainLookup, clock = { ms: 0 }, shares = fakeShares) {
  return createShareStateLookup({ shares, chain, now: () => clock.ms, budgetMs: 20 });
}

describe('summarizeShares', () => {
  it('is unknown when no coin was found', () => {
    expect(summarizeShares([])).toEqual({ kind: 'unknown' });
  });

  it('counts records as shares and unspent ones as left', () => {
    expect(summarizeShares(coins(true, false, false, true, false))).toEqual({
      kind: 'counted',
      total: 5,
      left: 3,
    });
    expect(summarizeShares(coins(true, true))).toEqual({ kind: 'counted', total: 2, left: 0 });
  });
});

describe('createShareStateLookup', () => {
  it('derives only so many fresh envelopes per second, then serves them uncounted', async () => {
    const clock = { ms: 0 };
    const chain = chainWith(coins(false, true));
    const derive = vi.fn(fakeShares);
    const lookup = lookupWith(chain, clock, derive);
    for (let i = 0; i < FRESH_PER_SECOND; i++) {
      expect((await lookup(`k${i}`, PK)).kind).toBe('counted');
    }
    expect(await lookup('one-too-many', PK)).toEqual({ kind: 'unknown' });
    expect(derive).toHaveBeenCalledTimes(FRESH_PER_SECOND);
    clock.ms += 1000;
    expect((await lookup('one-too-many', PK)).kind).toBe('counted');
  });

  it('derives 100 puzzle hashes and asks the chain once', async () => {
    const chain = chainWith(coins(false, true));
    const spy = vi.spyOn(chain, 'coinRecordsByPuzzleHashes');
    const state = await lookupWith(chain)('k', PK);
    expect(state).toEqual({ kind: 'counted', total: 2, left: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toHaveLength(MAX_SHARES);
  });

  it('gives up after the budget when the chain hangs, and aborts the request', async () => {
    let seen: AbortSignal | null = null;
    const chain: ChainLookup = {
      coinRecordsByPuzzleHashes: (_hashes, { signal }) => {
        seen = signal;
        return new Promise(() => {});
      },
    };
    const started = performance.now();
    expect(await lookupWith(chain)('k', PK)).toEqual({ kind: 'unknown' });
    expect(performance.now() - started).toBeLessThan(500);
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });

  it('is unknown when the chain fails or the key is not a curve point', async () => {
    const failing: ChainLookup = {
      coinRecordsByPuzzleHashes: () => Promise.reject(new Error('down')),
    };
    expect(await lookupWith(failing)('k', PK)).toEqual({ kind: 'unknown' });
    const badKey = lookupWith(chainWith(coins(false)), { ms: 0 }, () => {
      throw new Error('not on curve');
    });
    expect(await badKey('k', PK)).toEqual({ kind: 'unknown' });
  });

  it('shares one lookup between concurrent requests and caches it for 30 s', async () => {
    const clock = { ms: 0 };
    const chain = chainWith(coins(false));
    const spy = vi.spyOn(chain, 'coinRecordsByPuzzleHashes');
    const shares = vi.fn(fakeShares);
    const lookup = lookupWith(chain, clock, shares);
    await Promise.all([lookup('k', PK), lookup('k', PK)]);
    clock.ms = STATE_TTL_MS - 1;
    await lookup('k', PK);
    expect(spy).toHaveBeenCalledTimes(1);
    clock.ms = STATE_TTL_MS;
    await lookup('k', PK);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(shares).toHaveBeenCalledTimes(1);
    await lookup('other', PK);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does not cache an unknown state', async () => {
    const chain = chainWith([]);
    const spy = vi.spyOn(chain, 'coinRecordsByPuzzleHashes');
    const lookup = lookupWith(chain);
    await lookup('k', PK);
    await lookup('k', PK);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('share count hint', () => {
  it('accepts 1 to MAX_SHARES and falls back to all shares otherwise', () => {
    expect(shareCount(5)).toBe(5);
    expect(shareCount(MAX_SHARES)).toBe(MAX_SHARES);
    for (const bad of [undefined, 0, -1, 2.5, MAX_SHARES + 1, Number.NaN]) {
      expect(shareCount(bad)).toBe(MAX_SHARES);
    }
  });

  it('derives only as many addresses as the link says, and keeps counts apart', async () => {
    const shares = vi.fn(fakeShares);
    const lookup = createShareStateLookup({
      shares,
      chain: chainWith(coins(false, true)),
      now: () => 0,
      budgetMs: 20,
    });
    await lookup('pk', new Uint8Array(48), 5);
    await lookup('pk', new Uint8Array(48));
    expect(shares.mock.calls.map((call) => call[1])).toEqual([5, MAX_SHARES]);
  });
});
