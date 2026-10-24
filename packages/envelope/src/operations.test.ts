// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ChainClient, ChainError, type CoinRecord } from '@ge/chain';
import {
  type Coin,
  coinId,
  keyGen,
  publicKey,
  type SpendBundle,
  sha256,
  standardPuzzleHash,
  syntheticSecretKey,
  TESTNET11,
  toHex,
} from '@ge/chia';
import { describe, expect, it } from 'vitest';
import { buildCreate } from './builders';
import { EnvelopeError } from './errors';
import { inspectEnvelope, openEnvelope, takeBackEnvelope, waitForOutput } from './operations';
import { envelopeKeys } from './shares';

const text = (s: string) => new TextEncoder().encode(s);
const network = TESTNET11;

/**
 * A chain small enough to reason about: coins, a mempool where the first spend of a coin wins,
 * and blocks made on demand. Outputs are not parsed from solutions; tests register them.
 */
function fakeChain() {
  const records = new Map<string, CoinRecord>();
  const mempool = new Map<string, SpendBundle>();
  const expected = new Map<string, Coin[]>();
  let height = 10;
  let requests = 0;

  const add = (coin: Coin) =>
    records.set(toHex(coinId(coin)), {
      coin,
      confirmedHeight: height,
      spentHeight: null,
      timestamp: 1_800_000_000 + height,
    });

  const chain: ChainClient = {
    async coinRecordsByPuzzleHashes(hashes, opts) {
      requests++;
      const wanted = new Set(hashes.map(toHex));
      return [...records.values()].filter(
        (r) =>
          wanted.has(toHex(r.coin.puzzleHash)) &&
          (opts?.includeSpent === true || r.spentHeight === null),
      );
    },
    async coinRecordByName(id) {
      return records.get(toHex(id)) ?? null;
    },
    async coinRecordsByHint() {
      return [];
    },
    async coinRecordsByParentIds() {
      return [];
    },
    async pushTx(bundle) {
      const ids = bundle.coinSpends.map((spend) => toHex(coinId(spend.coin)));
      for (const id of ids) {
        const record = records.get(id);
        if (record === undefined) throw new ChainError('unknown_coin', 'UNKNOWN_UNSPENT');
        if (record.spentHeight !== null) throw new ChainError('double_spend', 'DOUBLE_SPEND');
        if (mempool.has(id)) throw new ChainError('double_spend', 'MEMPOOL_CONFLICT');
      }
      for (const id of ids) mempool.set(id, bundle);
      return { status: 'success' };
    },
    async peakHeight() {
      return height;
    },
  };

  return {
    chain,
    add,
    /** Tells the fake which coins a spend of `coin` creates. */
    expectOutputs: (coin: Coin, outputs: Coin[]) => expected.set(toHex(coinId(coin)), outputs),
    farmBlock() {
      height++;
      for (const id of mempool.keys()) {
        const record = records.get(id);
        if (record !== undefined) record.spentHeight = height;
        for (const output of expected.get(id) ?? []) add(output);
      }
      mempool.clear();
    },
    requests: () => requests,
  };
}

function wallet(label: string) {
  const syntheticSk = syntheticSecretKey(keyGen(sha256(text(label))));
  const syntheticPk = publicKey(syntheticSk);
  return { syntheticSk, syntheticPk, puzzleHash: standardPuzzleHash(syntheticPk) };
}

function envelopeOnChain(shares: bigint[]) {
  const fake = fakeChain();
  const sender = wallet('sender');
  const keys = envelopeKeys(sha256(text('secret')).slice(0, 16));
  const funding: Coin = {
    parentCoinInfo: sha256(text('funding')),
    puzzleHash: sender.puzzleHash,
    amount: shares.reduce((a, b) => a + b, 0n),
  };
  const created = buildCreate({
    inputs: [{ coin: funding, signer: sender }],
    envelopePk: keys.publicKey,
    amounts: shares,
    changePuzzleHash: sender.puzzleHash,
    fee: 0n,
    network,
  });
  for (const share of created.shares) fake.add(share.coin);
  return { fake, keys, sender, created };
}

describe('inspectEnvelope', () => {
  it('finds every share in one request when the link says how many', async () => {
    const { fake, keys } = envelopeOnChain([100n, 200n, 300n]);
    const shares = await inspectEnvelope(fake.chain, keys.publicKey, 3);
    expect(shares.map((s) => [s.index, s.coin.amount, s.opened])).toEqual([
      [0, 100n, false],
      [1, 200n, false],
      [2, 300n, false],
    ]);
    expect(fake.requests()).toBe(1);
  });

  it('scans until a gap without the hint', async () => {
    const { fake, keys } = envelopeOnChain(Array.from({ length: 25 }, () => 50n));
    expect(await inspectEnvelope(fake.chain, keys.publicKey)).toHaveLength(25);
    expect(fake.requests()).toBe(2);
  });

  it('ignores dust that somebody sent to a share address', async () => {
    const { fake, keys, created } = envelopeOnChain([100n, 200n]);
    const target = created.shares[1]?.coin;
    if (target === undefined) throw new Error();
    fake.add({
      parentCoinInfo: sha256(text('stranger')),
      puzzleHash: target.puzzleHash,
      amount: 1n,
    });
    const shares = await inspectEnvelope(fake.chain, keys.publicKey, 2);
    expect(shares.map((s) => s.coin.amount)).toEqual([100n, 200n]);
  });

  it('returns nothing for an envelope that is not on chain', async () => {
    const keys = envelopeKeys(sha256(text('unknown')).slice(0, 16));
    expect(await inspectEnvelope(fakeChain().chain, keys.publicKey, 5)).toEqual([]);
  });
});

describe('openEnvelope', () => {
  it('gives five people tapping at once five different shares', async () => {
    const { fake, keys } = envelopeOnChain([100n, 200n, 300n, 400n, 500n]);
    // Everybody draws the same "random" number: the worst case, all reaching for the same share.
    const claims = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        openEnvelope({
          chain: fake.chain,
          envelopeSk: keys.secretKey,
          envelopePk: keys.publicKey,
          sharesHint: 5,
          toPuzzleHash: wallet(name).puzzleHash,
          fee: 0n,
          network,
          random: () => 0,
        }),
      ),
    );
    expect(new Set(claims.map((c) => c.share.index)).size).toBe(5);
    expect(claims.reduce((sum, c) => sum + c.received, 0n)).toBe(1500n);
  });

  it('tells the sixth person that the envelope is empty', async () => {
    const { fake, keys } = envelopeOnChain([100n]);
    const open = (name: string) =>
      openEnvelope({
        chain: fake.chain,
        envelopeSk: keys.secretKey,
        envelopePk: keys.publicKey,
        sharesHint: 1,
        toPuzzleHash: wallet(name).puzzleHash,
        fee: 0n,
        network,
      });
    await open('first');
    await expect(open('late')).rejects.toMatchObject({ code: 'envelope_empty' });
    fake.farmBlock();
    await expect(open('later')).rejects.toMatchObject({ code: 'envelope_empty' });
  });

  it('says not_found before the creating transaction is confirmed', async () => {
    const keys = envelopeKeys(sha256(text('early')).slice(0, 16));
    await expect(
      openEnvelope({
        chain: fakeChain().chain,
        envelopeSk: keys.secretKey,
        envelopePk: keys.publicKey,
        sharesHint: 3,
        toPuzzleHash: wallet('x').puzzleHash,
        fee: 0n,
        network,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('takes the fee out of the share and skips shares the fee would eat', async () => {
    const { fake, keys } = envelopeOnChain([10n, 5_000n]);
    const opened = await openEnvelope({
      chain: fake.chain,
      envelopeSk: keys.secretKey,
      envelopePk: keys.publicKey,
      sharesHint: 2,
      toPuzzleHash: wallet('x').puzzleHash,
      fee: 100n,
      network,
      random: () => 0,
    });
    expect(opened.share.index).toBe(1);
    expect(opened.received).toBe(4_900n);
  });

  it('passes other chain errors on untouched', async () => {
    const { fake, keys } = envelopeOnChain([100n]);
    const broken: ChainClient = {
      ...fake.chain,
      pushTx: async () => {
        throw new ChainError('network', 'down');
      },
    };
    await expect(
      openEnvelope({
        chain: broken,
        envelopeSk: keys.secretKey,
        envelopePk: keys.publicKey,
        sharesHint: 1,
        toPuzzleHash: wallet('x').puzzleHash,
        fee: 0n,
        network,
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });
});

describe('waitForOutput', () => {
  const noSleep = { sleep: async () => {}, intervalMs: 1, timeoutMs: 5 };

  it('resolves once the claimed coin exists', async () => {
    const { fake, keys } = envelopeOnChain([100n]);
    const opened = await openEnvelope({
      chain: fake.chain,
      envelopeSk: keys.secretKey,
      envelopePk: keys.publicKey,
      sharesHint: 1,
      toPuzzleHash: wallet('x').puzzleHash,
      fee: 0n,
      network,
    });
    fake.expectOutputs(opened.share.coin, [opened.output]);
    let farmed = false;
    await waitForOutput(fake.chain, opened.share.coin, opened.output, {
      ...noSleep,
      sleep: async () => {
        if (!farmed) fake.farmBlock();
        farmed = true;
      },
    });
    expect(farmed).toBe(true);
  });

  it('reports a lost race when the share went to somebody else', async () => {
    const { fake, keys, created } = envelopeOnChain([100n]);
    const share = created.shares[0]?.coin;
    if (share === undefined) throw new Error();
    await openEnvelope({
      chain: fake.chain,
      envelopeSk: keys.secretKey,
      envelopePk: keys.publicKey,
      sharesHint: 1,
      toPuzzleHash: wallet('winner').puzzleHash,
      fee: 0n,
      network,
    });
    fake.farmBlock();
    const mine: Coin = {
      parentCoinInfo: coinId(share),
      puzzleHash: wallet('me').puzzleHash,
      amount: 100n,
    };
    await expect(waitForOutput(fake.chain, share, mine, noSleep)).rejects.toMatchObject({
      code: 'lost_race',
    });
  });

  it('gives up after the timeout', async () => {
    const { fake, created } = envelopeOnChain([100n]);
    const share = created.shares[0]?.coin;
    if (share === undefined) throw new Error();
    const never: Coin = { parentCoinInfo: coinId(share), puzzleHash: share.puzzleHash, amount: 1n };
    await expect(waitForOutput(fake.chain, share, never, noSleep)).rejects.toBeInstanceOf(
      EnvelopeError,
    );
  });
});

describe('takeBackEnvelope', () => {
  it('sweeps what is left and refuses when nothing is', async () => {
    const { fake, keys, sender } = envelopeOnChain([100n, 200n, 300n]);
    await openEnvelope({
      chain: fake.chain,
      envelopeSk: keys.secretKey,
      envelopePk: keys.publicKey,
      sharesHint: 3,
      toPuzzleHash: wallet('x').puzzleHash,
      fee: 0n,
      network,
      random: () => 0,
    });
    fake.farmBlock();
    const args = {
      chain: fake.chain,
      envelopeSk: keys.secretKey,
      envelopePk: keys.publicKey,
      sharesHint: 3,
      toPuzzleHash: sender.puzzleHash,
      fee: 10n,
      network,
    };
    expect((await takeBackEnvelope(args)).received).toBe(490n);
    fake.farmBlock();
    await expect(takeBackEnvelope(args)).rejects.toMatchObject({ code: 'nothing_to_take_back' });
  });
});
