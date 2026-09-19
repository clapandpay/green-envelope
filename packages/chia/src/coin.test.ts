// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, sha256, toHex } from './bytes';
import { intAtom } from './clvm';
import { coinId } from './coin';
import { ChiaError } from './errors';
import { loadVectors } from './test-vectors';

const vectors = loadVectors();
const hash32 = fc.uint8Array({ minLength: 32, maxLength: 32 });

describe('coinId', () => {
  it.each(vectors.coins)('golden vector, amount $amount', (v) => {
    const coin = {
      parentCoinInfo: fromHex(v.parent_coin_info),
      puzzleHash: fromHex(v.puzzle_hash),
      amount: BigInt(v.amount),
    };
    expect(toHex(coinId(coin))).toBe(v.coin_id);
  });

  it('is sha256(parent || puzzle hash || minimal signed amount)', () => {
    fc.assert(
      fc.property(hash32, hash32, fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (p, ph, amount) => {
        const id = coinId({ parentCoinInfo: p, puzzleHash: ph, amount });
        expect(id).toEqual(sha256(concatBytes(p, ph, intAtom(amount))));
      }),
    );
  });

  it('rejects wrong lengths and amounts outside u64', () => {
    const ok = new Uint8Array(32);
    const bad = new Uint8Array(31);
    expect(() => coinId({ parentCoinInfo: bad, puzzleHash: ok, amount: 1n })).toThrowError(
      ChiaError,
    );
    expect(() => coinId({ parentCoinInfo: ok, puzzleHash: bad, amount: 1n })).toThrowError(
      ChiaError,
    );
    expect(() => coinId({ parentCoinInfo: ok, puzzleHash: ok, amount: -1n })).toThrowError(
      ChiaError,
    );
    expect(() => coinId({ parentCoinInfo: ok, puzzleHash: ok, amount: 2n ** 64n })).toThrowError(
      ChiaError,
    );
    expect(() =>
      coinId({ parentCoinInfo: ok, puzzleHash: ok, amount: 5 as unknown as bigint }),
    ).toThrowError(ChiaError);
  });
});
