// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_FLOOR, MAX_SHARES } from './constants';
import { EnvelopeError } from './errors';

/** How an envelope's total is divided. */
export type SplitMode = 'random' | 'equal';

/** Options of `splitAmounts`. */
export interface SplitOptions {
  /** Smallest share in mojos; default `DEFAULT_FLOOR`. */
  floor?: bigint;
  /** Source of numbers in [0, 1); default `Math.random`. Inject a seeded one for tests. */
  random?: () => number;
}

const BITS = 53n;
const TWO_53 = 2 ** 53;

function draw53(random: () => number): bigint {
  const r = random();
  if (!(r >= 0 && r < 1)) throw new EnvelopeError('bad_random', `random() returned ${r}`);
  // A double in [0, 1) times 2^53 is exact, so no precision is lost on the way to bigint.
  return BigInt(Math.floor(r * TWO_53));
}

/** Uniform integer in [0, range) from 53-bit draws, all in bigint; two draws when the range needs more bits. */
function randomBelow(range: bigint, random: () => number): bigint {
  if (range <= 1n) return 0n;
  if (range <= BigInt(TWO_53)) return (draw53(random) * range) >> BITS;
  const wide = (draw53(random) << BITS) | draw53(random);
  return (wide * range) >> (2n * BITS);
}

function splitEqual(total: bigint, shares: number): bigint[] {
  const count = BigInt(shares);
  const base = total / count;
  const extra = Number(total % count); // < shares <= MAX_SHARES
  return Array.from({ length: shares }, (_, i) => (i < extra ? base + 1n : base));
}

function splitRandom(total: bigint, shares: number, floor: bigint, random: () => number): bigint[] {
  const out: bigint[] = [];
  let remaining = total;
  for (let left = BigInt(shares); left > 1n; left--) {
    // The WeChat rule: uniform in [floor, 2 x mean of the remainder] ...
    const twiceMean = (2n * remaining) / left;
    // ... but never so much that a later share would fall below the floor.
    const reserve = remaining - floor * (left - 1n);
    const max = twiceMean < reserve ? twiceMean : reserve;
    const share = floor + randomBelow(max - floor + 1n, random);
    out.push(share);
    remaining -= share;
  }
  out.push(remaining);
  return out;
}

/** Amounts sum exactly to `total`; every share >= `floor`; random = each share uniform in [floor, 2 x mean of the remainder]. */
export function splitAmounts(
  total: bigint,
  shares: number,
  mode: SplitMode,
  opts: SplitOptions = {},
): bigint[] {
  const floor = opts.floor ?? DEFAULT_FLOOR;
  if (!Number.isInteger(shares) || shares < 1 || shares > MAX_SHARES) {
    throw new EnvelopeError('bad_shares', `shares must be an integer in 1..${MAX_SHARES}`);
  }
  if (floor < 1n) throw new EnvelopeError('bad_floor', 'floor must be at least one mojo');
  if (total < floor * BigInt(shares)) {
    throw new EnvelopeError(
      'amount_too_small',
      `${shares} shares need at least ${floor} mojos each`,
    );
  }
  return mode === 'equal'
    ? splitEqual(total, shares)
    : splitRandom(total, shares, floor, opts.random ?? Math.random);
}
