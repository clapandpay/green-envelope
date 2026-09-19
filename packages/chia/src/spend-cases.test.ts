// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes spend-cases.json: spend bundles built and signed purely by this package, for the Rust
// verifier (`pnpm verify:spends`) to run through chia-consensus and the chia-wallet-sdk
// simulator. Positive cases must be accepted, negative ones rejected for the stated reason.
// The file is deterministic, so running the tests again leaves it unchanged.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bytes } from './bytes';
import { sha256, toHex } from './bytes';
import type { Coin } from './coin';
import { coinId } from './coin';
import type { SecretKey } from './keys';
import { aggregate, deriveUnhardened, keyGen, publicKey, sign } from './keys';
import type { Network } from './network';
import { MAINNET, TESTNET11 } from './network';
import type { CoinSpend, Condition, SpendBundle } from './spend';
import { signSpends, spendBundleToJson, spendStandardCoin } from './spend';
import { standardPuzzleHash, syntheticSecretKey } from './standard';
import { aggSigMeMessage } from './test-vectors';

interface SpendCase {
  name: string;
  network: Network['name'];
  coins: { parent_coin_info: string; puzzle_hash: string; amount: number }[];
  spend_bundle: unknown;
  expect: string;
}

const text = (s: string): Bytes => new TextEncoder().encode(s);

/** A standard-transaction key pair: the synthetic key of `sk` and the puzzle hash it owns. */
function owner(sk: SecretKey) {
  const syntheticSk = syntheticSecretKey(sk);
  const syntheticPk = publicKey(syntheticSk);
  return { syntheticSk, syntheticPk, puzzleHash: standardPuzzleHash(syntheticPk) };
}

/** An envelope the way the product makes one: key from a secret, share i is unhardened child i. */
function envelopeShare(secret: string, index: number) {
  const master = keyGen(sha256(text('clapandpay:envelope:v1'), text(secret)));
  return owner(deriveUnhardened(master, index));
}

function walletKey(name: string) {
  const master = keyGen(sha256(text(`spend-cases wallet ${name}`)));
  return owner([12381, 8444, 2, 0].reduce(deriveUnhardened, master));
}

function coinFor(puzzleHash: Bytes, amount: bigint, tag: string): Coin {
  return { parentCoinInfo: sha256(text(`spend-cases parent ${tag}`)), puzzleHash, amount };
}

function makeCase(
  name: string,
  network: Network,
  coins: Coin[],
  bundle: SpendBundle,
  expectation: string,
): SpendCase {
  return {
    name,
    network: network.name,
    coins: coins.map((coin) => ({
      parent_coin_info: `0x${toHex(coin.parentCoinInfo)}`,
      puzzle_hash: `0x${toHex(coin.puzzleHash)}`,
      amount: Number(coin.amount),
    })),
    spend_bundle: spendBundleToJson(bundle),
    expect: expectation,
  };
}

/** The product's claim: one share goes to the claimer, the fee comes out of the share itself. */
function claim(secret: string, amount: bigint, fee: bigint) {
  const share = envelopeShare(secret, 2);
  const claimer = walletKey(`claimer of ${secret}`);
  const coin = coinFor(share.puzzleHash, amount, `claim ${secret}`);
  const conditions: Condition[] = [
    {
      kind: 'createCoin',
      puzzleHash: claimer.puzzleHash,
      amount: amount - fee,
      memos: [claimer.puzzleHash],
    },
    { kind: 'reserveFee', amount: fee },
    { kind: 'assertBeforeSecondsAbsolute', seconds: 4_000_000_000n },
  ];
  const coinSpend = spendStandardCoin(coin, share.syntheticPk, conditions);
  return { coin, coinSpend, share, claimer };
}

function buildCases(): SpendCase[] {
  const cases: SpendCase[] = [];

  for (const network of [TESTNET11, MAINNET]) {
    // One coin, a plain payment with change.
    {
      const payer = walletKey('payer');
      const payee = walletKey('payee');
      const coin = coinFor(payer.puzzleHash, 1_750_000_000_000n, 'one coin');
      const coinSpend = spendStandardCoin(coin, payer.syntheticPk, [
        {
          kind: 'createCoin',
          puzzleHash: payee.puzzleHash,
          amount: 250_000_000_000n,
          memos: [payee.puzzleHash],
        },
        { kind: 'createCoin', puzzleHash: payer.puzzleHash, amount: 1_500_000_000_000n },
      ]);
      const bundle = signSpends([{ coinSpend, syntheticSk: payer.syntheticSk }], network);
      cases.push(makeCase('one coin: payment and change', network, [coin], bundle, 'ok'));
    }

    // Five share coins under five different keys swept back in one bundle (take-back). The
    // first spend carries the output and the fee; all are tied together.
    {
      const sender = walletKey('sender');
      const amounts = [1n, 127n, 128n, 70_000n, 12_345_678_901n];
      const shares = amounts.map((amount, i) => {
        const key = envelopeShare('sweep', i);
        return { key, coin: coinFor(key.puzzleHash, amount, `sweep ${i}`) };
      });
      const total = amounts.reduce((a, b) => a + b, 0n);
      const fee = 500n;
      const first = shares[0];
      if (first === undefined) throw new Error('unreachable');
      const spends = shares.map(({ key, coin }, i) => {
        const conditions: Condition[] =
          i === 0
            ? [
                {
                  kind: 'createCoin',
                  puzzleHash: sender.puzzleHash,
                  amount: total - fee,
                  memos: [],
                },
                { kind: 'reserveFee', amount: fee },
                ...shares.slice(1).map(
                  (other): Condition => ({
                    kind: 'assertConcurrentSpend',
                    coinId: coinId(other.coin),
                  }),
                ),
              ]
            : [{ kind: 'assertConcurrentSpend', coinId: coinId(first.coin) }];
        return {
          coinSpend: spendStandardCoin(coin, key.syntheticPk, conditions),
          syntheticSk: key.syntheticSk,
        };
      });
      const bundle = signSpends(spends, network);
      const coins = shares.map((s) => s.coin);
      cases.push(makeCase('five coins, five keys: sweep with fee', network, coins, bundle, 'ok'));
    }

    // The claim: output = amount - fee.
    {
      const { coin, coinSpend, share } = claim('claim', 50_000_000n, 1_000n);
      const bundle = signSpends([{ coinSpend, syntheticSk: share.syntheticSk }], network);
      cases.push(makeCase('claim: output = amount - fee', network, [coin], bundle, 'ok'));
    }

    // A claim whose whole amount goes to fees, and a zero-amount coin.
    {
      const key = walletKey('dust');
      const coin = coinFor(key.puzzleHash, 1n, 'dust');
      const coinSpend = spendStandardCoin(coin, key.syntheticPk, [
        { kind: 'reserveFee', amount: 1n },
      ]);
      const bundle = signSpends([{ coinSpend, syntheticSk: key.syntheticSk }], network);
      cases.push(makeCase('one mojo, all of it fee', network, [coin], bundle, 'ok'));
    }

    // --- negative cases ---

    // Signed for the other network.
    {
      const other = network === MAINNET ? TESTNET11 : MAINNET;
      const { coin, coinSpend, share } = claim('wrong network', 50_000_000n, 1_000n);
      const bundle = signSpends([{ coinSpend, syntheticSk: share.syntheticSk }], other);
      cases.push(
        makeCase(`signed for ${other.name}`, network, [coin], bundle, 'BadAggregateSignature'),
      );
    }

    // Signed by somebody who knows the public link data but not the secret.
    {
      const { coin, coinSpend, share } = claim('thief', 50_000_000n, 1_000n);
      const thief = walletKey('thief');
      const honest = signSpends([{ coinSpend, syntheticSk: share.syntheticSk }], network);
      const message = aggSigMeMessage(coin, coinSpend.solution, network); // the right message
      const forged: SpendBundle = {
        ...honest,
        aggregatedSignature: sign(thief.syntheticSk, message),
      };
      cases.push(
        makeCase('signed by another key', network, [coin], forged, 'BadAggregateSignature'),
      );
      const unsigned: SpendBundle = { ...honest, aggregatedSignature: aggregate([]) };
      cases.push(makeCase('not signed at all', network, [coin], unsigned, 'BadAggregateSignature'));
    }

    // A valid signature moved onto a bundle that pays somebody else.
    {
      const original = claim('redirect', 50_000_000n, 1_000n);
      const signed = signSpends(
        [{ coinSpend: original.coinSpend, syntheticSk: original.share.syntheticSk }],
        network,
      );
      const thief = walletKey('thief');
      const redirected: CoinSpend = spendStandardCoin(original.coin, original.share.syntheticPk, [
        { kind: 'createCoin', puzzleHash: thief.puzzleHash, amount: 49_999_000n },
        { kind: 'reserveFee', amount: 1_000n },
      ]);
      const bundle: SpendBundle = {
        coinSpends: [redirected],
        aggregatedSignature: signed.aggregatedSignature,
      };
      cases.push(
        makeCase(
          'signature reused for other outputs',
          network,
          [original.coin],
          bundle,
          'BadAggregateSignature',
        ),
      );
    }

    // Outputs exceed the input.
    {
      const key = walletKey('minter');
      const coin = coinFor(key.puzzleHash, 1_000n, 'mint');
      const coinSpend = spendStandardCoin(coin, key.syntheticPk, [
        { kind: 'createCoin', puzzleHash: key.puzzleHash, amount: 1_001n },
      ]);
      const bundle = signSpends([{ coinSpend, syntheticSk: key.syntheticSk }], network);
      cases.push(makeCase('outputs exceed input', network, [coin], bundle, 'MintingCoin'));
    }

    // Output plus fee exceed the input.
    {
      const key = walletKey('fee');
      const coin = coinFor(key.puzzleHash, 1_000n, 'fee');
      const coinSpend = spendStandardCoin(coin, key.syntheticPk, [
        { kind: 'createCoin', puzzleHash: key.puzzleHash, amount: 1_000n },
        { kind: 'reserveFee', amount: 1n },
      ]);
      const bundle = signSpends([{ coinSpend, syntheticSk: key.syntheticSk }], network);
      cases.push(
        makeCase(
          'fee not covered by the input',
          network,
          [coin],
          bundle,
          'ReserveFeeConditionFailed',
        ),
      );
    }

    // The coin being spent does not exist.
    {
      const { coinSpend, share } = claim('ghost', 50_000_000n, 1_000n);
      const bundle = signSpends([{ coinSpend, syntheticSk: share.syntheticSk }], network);
      cases.push(makeCase('coin is not in the coin set', network, [], bundle, 'UnknownUnspent'));
    }

    // assertConcurrentSpend of a coin that is not spent alongside.
    {
      const key = walletKey('alone');
      const coin = coinFor(key.puzzleHash, 1_000n, 'alone');
      const coinSpend = spendStandardCoin(coin, key.syntheticPk, [
        { kind: 'assertConcurrentSpend', coinId: sha256(text('no such coin')) },
      ]);
      const bundle = signSpends([{ coinSpend, syntheticSk: key.syntheticSk }], network);
      cases.push(
        makeCase(
          'asserted concurrent spend is missing',
          network,
          [coin],
          bundle,
          'AssertConcurrentSpendFailed',
        ),
      );
    }
  }

  return cases;
}

describe('spend cases for the Rust verifier', () => {
  it('writes spend-cases.json', () => {
    const cases = buildCases();
    expect(cases.filter((c) => c.expect === 'ok').length).toBe(8);
    expect(cases.filter((c) => c.expect !== 'ok').length).toBe(16);
    expect(new Set(cases.map((c) => `${c.network} ${c.name}`)).size).toBe(cases.length);
    const file = new URL('./spend-cases.json', import.meta.url);
    writeFileSync(file, `${JSON.stringify(cases, null, 2)}\n`);
  });
});
