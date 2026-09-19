// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Coin,
  coinId,
  equalBytes,
  keyGen,
  type Network,
  publicKey,
  type SpendBundle,
  sha256,
  spendBundleToJson,
  standardPuzzleHash,
  syntheticSecretKey,
  TESTNET11,
  toHex,
} from '@ge/chia';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCreate, buildOpen, buildSend, buildTakeBack, type OwnedCoin } from './builders';
import { EnvelopeError } from './errors';
import { envelopeKeys, shareKey, sharePuzzleHash, sharePuzzleHashes } from './shares';
import { splitAmounts } from './split';

const text = (s: string) => new TextEncoder().encode(s);
const network: Network = TESTNET11;

function signerFromSeed(label: string) {
  const syntheticSk = syntheticSecretKey(keyGen(sha256(text(label))));
  const syntheticPk = publicKey(syntheticSk);
  return { syntheticSk, syntheticPk, puzzleHash: standardPuzzleHash(syntheticPk) };
}

function walletCoin(owner: { puzzleHash: Uint8Array }, label: string, amount: bigint): Coin {
  return { parentCoinInfo: sha256(text(label)), puzzleHash: owner.puzzleHash, amount };
}

// Every bundle built here is also written to a case file that the Rust verifier
// (tools/vectors, `pnpm verify:spends`) runs through the chia-wallet-sdk simulator.
interface SpendCase {
  name: string;
  network: string;
  coins: { parent_coin_info: string; puzzle_hash: string; amount: number }[];
  spend_bundle: unknown;
  expect: string;
}
const cases: SpendCase[] = [];
function record(name: string, coins: Coin[], bundle: SpendBundle, expectation = 'ok') {
  cases.push({
    name,
    network: network.name,
    coins: coins.map((coin) => ({
      parent_coin_info: `0x${toHex(coin.parentCoinInfo)}`,
      puzzle_hash: `0x${toHex(coin.puzzleHash)}`,
      amount: Number(coin.amount),
    })),
    spend_bundle: spendBundleToJson(bundle),
    expect: expectation,
  });
}
afterAll(() => {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../spend-cases.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cases, null, 1)}\n`);
});

const secret = sha256(text('envelope secret')).slice(0, 16);
const envelope = envelopeKeys(secret);
const sender = signerFromSeed('sender');
const claimer = signerFromSeed('claimer');

describe('share keys', () => {
  it('derives the same address from the public key as from the secret', () => {
    for (const index of [0, 1, 7, 99]) {
      const fromSecret = shareKey(envelope.secretKey, index);
      expect(toHex(sharePuzzleHash(envelope.publicKey, index))).toBe(toHex(fromSecret.puzzleHash));
    }
  });

  it('gives every share its own address', () => {
    const hashes = sharePuzzleHashes(envelope.publicKey, 100).map(toHex);
    expect(new Set(hashes).size).toBe(100);
  });
});

describe('buildCreate', () => {
  const inputs: OwnedCoin[] = [
    { coin: walletCoin(sender, 'coin a', 700_000_000n), signer: sender },
    { coin: walletCoin(sender, 'coin b', 400_000_000n), signer: sender },
  ];
  const amounts = splitAmounts(1_000_000_000n, 5, 'random', { random: () => 0.37 });
  const created = buildCreate({
    inputs,
    envelopePk: envelope.publicKey,
    amounts,
    changePuzzleHash: sender.puzzleHash,
    fee: 1_000n,
    network,
  });

  it('creates one coin per share, children of the first input', () => {
    expect(created.shares).toHaveLength(5);
    const parent = coinId(inputs[0]?.coin as Coin);
    created.shares.forEach((share, index) => {
      expect(share.index).toBe(index);
      expect(share.coin.amount).toBe(amounts[index]);
      expect(equalBytes(share.coin.parentCoinInfo, parent)).toBe(true);
      expect(toHex(share.coin.puzzleHash)).toBe(toHex(sharePuzzleHash(envelope.publicKey, index)));
    });
    expect(created.bundle.coinSpends).toHaveLength(2);
    record(
      'create: two inputs, five shares, change, fee',
      inputs.map((i) => i.coin),
      created.bundle,
    );
  });

  it('works with no change and no fee', () => {
    const exact = [{ coin: walletCoin(sender, 'exact', 300n), signer: sender }];
    const { bundle } = buildCreate({
      inputs: exact,
      envelopePk: envelope.publicKey,
      amounts: [100n, 100n, 100n],
      changePuzzleHash: sender.puzzleHash,
      fee: 0n,
      network,
    });
    record(
      'create: exact amount, equal shares, no fee',
      exact.map((i) => i.coin),
      bundle,
    );
  });

  it('refuses what the inputs cannot cover', () => {
    const attempt = () =>
      buildCreate({
        inputs,
        envelopePk: envelope.publicKey,
        amounts: [1_100_000_000n],
        changePuzzleHash: sender.puzzleHash,
        fee: 1n,
        network,
      });
    expect(attempt).toThrowError(EnvelopeError);
    expect(attempt).toThrowError(/insufficient_funds/);
  });

  it('opens and takes back the shares it created', () => {
    const [first, second, third] = created.shares;
    if (first === undefined || second === undefined || third === undefined) throw new Error();

    const opened = buildOpen({
      share: second,
      envelopeSk: envelope.secretKey,
      toPuzzleHash: claimer.puzzleHash,
      fee: 500n,
      network,
    });
    expect(opened.received).toBe(second.coin.amount - 500n);
    record('open: one share, fee paid by the share', [second.coin], opened.bundle);

    const free = buildOpen({
      share: first,
      envelopeSk: envelope.secretKey,
      toPuzzleHash: claimer.puzzleHash,
      fee: 0n,
      network,
    });
    expect(free.received).toBe(first.coin.amount);
    record('open: no fee', [first.coin], free.bundle);

    const back = buildTakeBack({
      shares: [first, third],
      envelopeSk: envelope.secretKey,
      toPuzzleHash: sender.puzzleHash,
      fee: 200n,
      network,
    });
    expect(back.received).toBe(first.coin.amount + third.coin.amount - 200n);
    record(
      'take back: two unopened shares in one transaction',
      [first.coin, third.coin],
      back.bundle,
    );

    // The wrong secret cannot even build the spend: the core checks that the key owns the coin.
    expect(() =>
      buildOpen({
        share: third,
        envelopeSk: envelopeKeys(sha256(text('another secret')).slice(0, 16)).secretKey,
        toPuzzleHash: claimer.puzzleHash,
        fee: 0n,
        network,
      }),
    ).toThrowError();
  });

  it('refuses a fee that eats the share', () => {
    const share = created.shares[0];
    if (share === undefined) throw new Error();
    expect(() =>
      buildOpen({
        share,
        envelopeSk: envelope.secretKey,
        toPuzzleHash: claimer.puzzleHash,
        fee: share.coin.amount,
        network,
      }),
    ).toThrowError(/bad_amount/);
  });
});

describe('buildSend', () => {
  it('pays and returns change', () => {
    const inputs = [{ coin: walletCoin(claimer, 'claimed', 9_000n), signer: claimer }];
    const bundle = buildSend({
      inputs,
      toPuzzleHash: sender.puzzleHash,
      amount: 4_000n,
      changePuzzleHash: claimer.puzzleHash,
      fee: 10n,
      network,
    });
    record(
      'send: payment with change and fee',
      inputs.map((i) => i.coin),
      bundle,
    );
  });
});
