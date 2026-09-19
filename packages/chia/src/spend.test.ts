// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, toHex } from './bytes';
import { deserialize, intAtom, list, NIL, serialize, treeHash } from './clvm';
import { coinId } from './coin';
import { ChiaError } from './errors';
import { deriveUnhardened, keyGen, publicKey, verify } from './keys';
import { MAINNET, TESTNET11 } from './network';
import type { Condition } from './spend';
import { signSpends, spendBundleToJson, spendStandardCoin } from './spend';
import { standardPuzzleHash, syntheticSecretKey } from './standard';
import type { ConditionVector } from './test-vectors';
import { aggSigMeMessage, loadVectors } from './test-vectors';

const vectors = loadVectors();

function conditionFromVector(c: ConditionVector): Condition {
  switch (c.kind) {
    case 'createCoin': {
      const base = { kind: c.kind, puzzleHash: fromHex(c.puzzle_hash), amount: BigInt(c.amount) };
      return c.memos === undefined ? base : { ...base, memos: c.memos.map(fromHex) };
    }
    case 'reserveFee':
      return { kind: c.kind, amount: BigInt(c.amount) };
    case 'assertConcurrentSpend':
      return { kind: c.kind, coinId: fromHex(c.coin_id) };
    case 'assertBeforeSecondsAbsolute':
      return { kind: c.kind, seconds: BigInt(c.seconds) };
  }
}

function wallet(seedByte: number) {
  const sk = syntheticSecretKey(keyGen(new Uint8Array(32).fill(seedByte)));
  const pk = publicKey(sk);
  return { sk, pk, puzzleHash: standardPuzzleHash(pk) };
}

describe('golden spend bundles', () => {
  it('there are bundles for both networks', () => {
    const networks = new Set(vectors.spend_bundles.map((v) => v.network));
    expect([...networks].sort()).toEqual(['mainnet', 'testnet11']);
    expect(vectors.spend_bundles.length).toBeGreaterThanOrEqual(4);
  });

  it.each(vectors.spend_bundles)('$network: $name', (v) => {
    const network = v.network === 'mainnet' ? MAINNET : TESTNET11;
    expect(toHex(network.aggSigMeExtraData)).toBe(v.agg_sig_me_extra_data);

    const spends = v.inputs.map((input) => {
      // Keys come from the seed by our own derivation, not from the vector's key fields.
      const sk = input.unhardened_path.reduce(deriveUnhardened, keyGen(fromHex(input.seed)));
      const syntheticSk = syntheticSecretKey(sk);
      expect(toHex(syntheticSk)).toBe(input.synthetic_sk);
      const syntheticPk = publicKey(syntheticSk);
      expect(toHex(syntheticPk)).toBe(input.synthetic_pk);
      const coin = {
        parentCoinInfo: fromHex(input.coin.parent_coin_info),
        puzzleHash: fromHex(input.coin.puzzle_hash),
        amount: BigInt(input.coin.amount),
      };
      const conditions = input.conditions.map(conditionFromVector);
      return { coinSpend: spendStandardCoin(coin, syntheticPk, conditions), syntheticSk };
    });

    // puzzle_reveal, solution and aggregated_signature, byte for byte.
    expect(spendBundleToJson(signSpends(spends, network))).toEqual(v.spend_bundle);

    // The messages the reference signer derived by running the puzzles are the ones we sign.
    const messages = spends.map(({ coinSpend }) =>
      toHex(aggSigMeMessage(coinSpend.coin, coinSpend.solution, network)),
    );
    expect(messages).toEqual(v.signed_messages.map((m) => m.message));
  });
});

describe('spendStandardCoin', () => {
  const owner = wallet(1);
  const coin = {
    parentCoinInfo: new Uint8Array(32).fill(5),
    puzzleHash: owner.puzzleHash,
    amount: 1000n,
  };

  it('builds (() (q . conditions) ()) with memos as a trailing list', () => {
    const memo = Uint8Array.of(0xca, 0xfe);
    const conditions: Condition[] = [
      {
        kind: 'createCoin',
        puzzleHash: owner.puzzleHash,
        amount: 900n,
        memos: [owner.puzzleHash, memo],
      },
      { kind: 'createCoin', puzzleHash: owner.puzzleHash, amount: 50n },
      { kind: 'reserveFee', amount: 50n },
      { kind: 'assertConcurrentSpend', coinId: new Uint8Array(32).fill(9) },
      { kind: 'assertBeforeSecondsAbsolute', seconds: 1_900_000_000n },
    ];
    const expected = list(
      NIL,
      [
        Uint8Array.of(1),
        list(
          list(intAtom(51), owner.puzzleHash, intAtom(900), list(owner.puzzleHash, memo)),
          list(intAtom(51), owner.puzzleHash, intAtom(50)),
          list(intAtom(52), intAtom(50)),
          list(intAtom(64), new Uint8Array(32).fill(9)),
          list(intAtom(85), intAtom(1_900_000_000)),
        ),
      ],
      NIL,
    );
    const spend = spendStandardCoin(coin, owner.pk, conditions);
    expect(toHex(spend.solution)).toBe(toHex(serialize(expected)));
    expect(treeHash(deserialize(spend.puzzleReveal))).toEqual(coin.puzzleHash);
    expect(spend.coin).toBe(coin);
  });

  it('throws when the key does not own the coin', () => {
    const stranger = wallet(2);
    expect(() => spendStandardCoin(coin, stranger.pk, [])).toThrowError(
      expect.objectContaining({ code: 'wrong_puzzle_hash' }),
    );
    // The non-synthetic key of the owner does not own it either.
    const plainPk = publicKey(keyGen(new Uint8Array(32).fill(1)));
    expect(() => spendStandardCoin(coin, plainPk, [])).toThrowError(ChiaError);
  });

  it('rejects malformed conditions and coins', () => {
    const bad32 = new Uint8Array(31);
    const cases: Condition[] = [
      { kind: 'createCoin', puzzleHash: bad32, amount: 1n },
      { kind: 'createCoin', puzzleHash: owner.puzzleHash, amount: -1n },
      { kind: 'createCoin', puzzleHash: owner.puzzleHash, amount: 2n ** 64n },
      { kind: 'reserveFee', amount: -5n },
      { kind: 'assertConcurrentSpend', coinId: bad32 },
      { kind: 'assertBeforeSecondsAbsolute', seconds: -1n },
    ];
    for (const condition of cases) {
      expect(() => spendStandardCoin(coin, owner.pk, [condition])).toThrowError(ChiaError);
    }
    expect(() => spendStandardCoin({ ...coin, amount: -1n }, owner.pk, [])).toThrowError(ChiaError);
    expect(() => spendStandardCoin({ ...coin, parentCoinInfo: bad32 }, owner.pk, [])).toThrowError(
      ChiaError,
    );
    expect(() => spendStandardCoin(coin, new Uint8Array(47), [])).toThrowError(ChiaError);
  });
});

describe('signSpends', () => {
  it('signs treeHash(delegated puzzle) || coin id || extra data with the synthetic key', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 250 }),
        fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
        fc.constantFrom(MAINNET, TESTNET11),
        (seedByte, amount, network) => {
          const owner = wallet(seedByte);
          const coin = {
            parentCoinInfo: new Uint8Array(32).fill(3),
            puzzleHash: owner.puzzleHash,
            amount,
          };
          const conditions: Condition[] = [
            { kind: 'createCoin', puzzleHash: owner.puzzleHash, amount },
          ];
          const coinSpend = spendStandardCoin(coin, owner.pk, conditions);
          const bundle = signSpends([{ coinSpend, syntheticSk: owner.sk }], network);

          const delegated = [
            Uint8Array.of(1),
            list(list(intAtom(51), owner.puzzleHash, intAtom(amount))),
          ] as const;
          const message = concatBytes(treeHash(delegated), coinId(coin), network.aggSigMeExtraData);
          expect(verify(owner.pk, message, bundle.aggregatedSignature)).toBe(true);
          const other = network === MAINNET ? TESTNET11 : MAINNET;
          const otherMessage = concatBytes(
            treeHash(delegated),
            coinId(coin),
            other.aggSigMeExtraData,
          );
          expect(verify(owner.pk, otherMessage, bundle.aggregatedSignature)).toBe(false);
          expect(bundle.coinSpends).toEqual([coinSpend]);
        },
      ),
      { numRuns: 4 },
    );
  });

  it('an empty bundle carries the infinity signature', () => {
    const bundle = signSpends([], TESTNET11);
    expect(toHex(bundle.aggregatedSignature)).toBe(`c0${'00'.repeat(95)}`);
    expect(bundle.coinSpends).toEqual([]);
  });

  it('throws for a key that does not own the coin, and for a foreign solution', () => {
    const owner = wallet(1);
    const stranger = wallet(2);
    const coin = { parentCoinInfo: new Uint8Array(32), puzzleHash: owner.puzzleHash, amount: 1n };
    const coinSpend = spendStandardCoin(coin, owner.pk, []);
    expect(() => signSpends([{ coinSpend, syntheticSk: stranger.sk }], TESTNET11)).toThrowError(
      expect.objectContaining({ code: 'wrong_puzzle_hash' }),
    );
    for (const solution of ['80', 'ff8080', '01', 'ff80']) {
      const broken = { ...coinSpend, solution: fromHex(solution) };
      expect(() =>
        signSpends([{ coinSpend: broken, syntheticSk: owner.sk }], TESTNET11),
      ).toThrowError(ChiaError);
    }
  });
});

describe('spendBundleToJson', () => {
  const owner = wallet(1);

  it('has the push_tx shape', () => {
    const coin = {
      parentCoinInfo: new Uint8Array(32).fill(0xab),
      puzzleHash: owner.puzzleHash,
      amount: 42n,
    };
    const bundle = signSpends(
      [{ coinSpend: spendStandardCoin(coin, owner.pk, []), syntheticSk: owner.sk }],
      TESTNET11,
    );
    const json = spendBundleToJson(bundle) as {
      coin_spends: { coin: Record<string, unknown>; puzzle_reveal: string; solution: string }[];
      aggregated_signature: string;
    };
    expect(Object.keys(json)).toEqual(['coin_spends', 'aggregated_signature']);
    expect(json.coin_spends[0]?.coin).toEqual({
      parent_coin_info: `0x${'ab'.repeat(32)}`,
      puzzle_hash: `0x${toHex(owner.puzzleHash)}`,
      amount: 42,
    });
    expect(json.coin_spends[0]?.solution).toBe('0xff80ffff0180ff8080');
    expect(json.aggregated_signature).toMatch(/^0x[0-9a-f]{192}$/);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('emits amounts up to 2^53 - 1 as exact numbers and throws above', () => {
    const spend = (amount: bigint) => ({
      coinSpends: [
        {
          coin: { parentCoinInfo: new Uint8Array(32), puzzleHash: owner.puzzleHash, amount },
          puzzleReveal: NIL,
          solution: NIL,
        },
      ],
      aggregatedSignature: new Uint8Array(96),
    });
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const json = spendBundleToJson(spend(max)) as { coin_spends: { coin: { amount: number } }[] };
    expect(json.coin_spends[0]?.coin.amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => spendBundleToJson(spend(max + 1n))).toThrowError(
      expect.objectContaining({ code: 'amount_out_of_range' }),
    );
    expect(() => spendBundleToJson(spend(-1n))).toThrowError(ChiaError);
  });
});
