// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOOR, MAX_SHARES } from './constants';
import { EnvelopeError } from './errors';
import { type SplitMode, splitAmounts } from './split';

/** mulberry32: a small seeded generator, good enough for tests. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

const U64_MAX = 2n ** 64n - 1n;

/** Valid (total, shares, floor) triples, from the tightest possible total up to u64. */
const validInput = fc
  .record({
    shares: fc.integer({ min: 1, max: MAX_SHARES }),
    floor: fc.bigInt({ min: 1n, max: 10n ** 12n }),
    slack: fc.oneof(fc.bigInt({ min: 0n, max: 200n }), fc.bigInt({ min: 0n, max: U64_MAX })),
    seed: fc.integer(),
  })
  .map(({ shares, floor, slack, seed }) => ({
    shares,
    floor,
    seed,
    total: floor * BigInt(shares) + slack,
  }));

const modes: SplitMode[] = ['random', 'equal'];

describe('splitAmounts', () => {
  it.each(modes)('%s: exact sum, right length, every share at least the floor', (mode) => {
    fc.assert(
      fc.property(validInput, ({ total, shares, floor, seed }) => {
        const parts = splitAmounts(total, shares, mode, { floor, random: seeded(seed) });
        expect(parts).toHaveLength(shares);
        expect(sum(parts)).toBe(total);
        expect(parts.every((p) => p >= floor)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('random: deterministic under a seeded random, different under another seed', () => {
    fc.assert(
      fc.property(validInput, ({ total, shares, floor, seed }) => {
        const a = splitAmounts(total, shares, 'random', { floor, random: seeded(seed) });
        const b = splitAmounts(total, shares, 'random', { floor, random: seeded(seed) });
        expect(a).toEqual(b);
      }),
    );
    const one = splitAmounts(10n ** 12n, 10, 'random', { random: seeded(1) });
    const two = splitAmounts(10n ** 12n, 10, 'random', { random: seeded(2) });
    expect(one).not.toEqual(two);
  });

  it('random: every share obeys the rule given what was left before it', () => {
    fc.assert(
      fc.property(validInput, ({ total, shares, floor, seed }) => {
        const parts = splitAmounts(total, shares, 'random', { floor, random: seeded(seed) });
        let remaining = total;
        parts.slice(0, -1).forEach((part, i) => {
          const left = BigInt(shares - i);
          expect(part <= (2n * remaining) / left).toBe(true);
          remaining -= part;
          expect(remaining >= floor * (left - 1n)).toBe(true);
        });
        // In step one that means: never more than twice the initial mean.
        if (shares > 1) expect((parts[0] ?? 0n) <= (2n * total) / BigInt(shares)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('random: reaches both ends of the range', () => {
    const lowest = splitAmounts(10_000n, 2, 'random', { floor: 1n, random: () => 0 });
    expect(lowest).toEqual([1n, 9_999n]);
    const highest = splitAmounts(10_000n, 2, 'random', { floor: 1n, random: () => 1 - 2 ** -53 });
    expect(highest).toEqual([9_999n, 1n]); // capped so that the last share keeps its floor
    const mid = splitAmounts(10_000n, 4, 'random', { floor: 1n, random: () => 1 - 2 ** -53 });
    expect(mid[0]).toBe(5_000n); // 2 x mean
  });

  it('random: the mean of each position is near total / shares', () => {
    const total = 1_000_000_000_000n;
    const shares = 5;
    const runs = 20_000;
    const random = seeded(20260919);
    const sums = new Array<bigint>(shares).fill(0n);
    for (let run = 0; run < runs; run++) {
      splitAmounts(total, shares, 'random', { random }).forEach((part, i) => {
        sums[i] = (sums[i] ?? 0n) + part;
      });
    }
    const expected = Number(total) / shares;
    for (const s of sums) {
      const mean = Number(s) / runs;
      expect(Math.abs(mean - expected) / expected).toBeLessThan(0.03);
    }
  });

  it('random: stays uniform when the range needs more than 53 bits', () => {
    const total = U64_MAX;
    const random = seeded(7);
    let below = 0;
    const runs = 4_000;
    for (let run = 0; run < runs; run++) {
      const [first = 0n] = splitAmounts(total, 2, 'random', { random });
      if (first < total / 2n) below++;
      // Odd low bits prove the second draw is used (a single 53-bit draw would zero them).
    }
    expect(below / runs).toBeGreaterThan(0.45);
    expect(below / runs).toBeLessThan(0.55);
    const lowBits = new Set<bigint>();
    for (let run = 0; run < 64; run++) {
      const [first = 0n] = splitAmounts(total, 2, 'random', { random });
      lowBits.add(first & 0xffn);
    }
    expect(lowBits.size).toBeGreaterThan(16);
  });

  it('equal: floor division, remainder mojos go one by one to the first shares', () => {
    expect(splitAmounts(10_003n, 5, 'equal')).toEqual([2_001n, 2_001n, 2_001n, 2_000n, 2_000n]);
    expect(splitAmounts(5_000n, 5, 'equal')).toEqual([1_000n, 1_000n, 1_000n, 1_000n, 1_000n]);
    fc.assert(
      fc.property(validInput, ({ total, shares, floor }) => {
        const parts = splitAmounts(total, shares, 'equal', { floor });
        const max = parts.reduce((a, b) => (a > b ? a : b));
        const min = parts.reduce((a, b) => (a < b ? a : b));
        expect(max - min <= 1n).toBe(true);
        expect([...parts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))).toEqual(parts);
      }),
    );
  });

  it('one share takes everything; the tightest total gives everyone the floor', () => {
    expect(splitAmounts(123_456n, 1, 'random')).toEqual([123_456n]);
    expect(splitAmounts(DEFAULT_FLOOR * 3n, 3, 'random')).toEqual([1_000n, 1_000n, 1_000n]);
  });

  it('uses Math.random and the default floor when nothing is injected', () => {
    const parts = splitAmounts(1_000_000n, 7, 'random');
    expect(sum(parts)).toBe(1_000_000n);
    expect(parts.every((p) => p >= DEFAULT_FLOOR)).toBe(true);
  });

  it.each([
    ['zero shares', () => splitAmounts(10_000n, 0, 'equal'), 'bad_shares'],
    ['too many shares', () => splitAmounts(10n ** 9n, MAX_SHARES + 1, 'equal'), 'bad_shares'],
    ['fractional shares', () => splitAmounts(10_000n, 2.5, 'equal'), 'bad_shares'],
    ['NaN shares', () => splitAmounts(10_000n, Number.NaN, 'equal'), 'bad_shares'],
    ['a zero floor', () => splitAmounts(10_000n, 2, 'random', { floor: 0n }), 'bad_floor'],
    ['a total below shares x floor', () => splitAmounts(2_999n, 3, 'random'), 'amount_too_small'],
    ['a negative total', () => splitAmounts(-1n, 1, 'equal'), 'amount_too_small'],
    ['random() = 1', () => splitAmounts(10_000n, 2, 'random', { random: () => 1 }), 'bad_random'],
    [
      'random() = NaN',
      () => splitAmounts(10_000n, 2, 'random', { random: () => Number.NaN }),
      'bad_random',
    ],
  ])('refuses %s', (_, run, code) => {
    expect(run).toThrow(EnvelopeError);
    expect(run).toThrow(expect.objectContaining({ code }));
  });
});
