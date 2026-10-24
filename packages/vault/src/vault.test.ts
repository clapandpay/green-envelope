// SPDX-License-Identifier: AGPL-3.0-or-later
// Every puzzle, hash and bundle against chia-wallet-sdk (`tools/vectors vault` writes
// vault-vectors.json with the SDK's own drivers). Every bundle also goes to spend-cases.json for
// `pnpm verify:spends`, which runs it through the SDK's simulator.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bytes, Coin, SpendBundle } from '@ge/chia';
import {
  coinId,
  deserialize,
  fromHex,
  publicKey,
  sha256,
  signSpends,
  spendBundleToJson,
  spendStandardCoin,
  TESTNET11,
  toHex,
  treeHash,
} from '@ge/chia';
import { p256 } from '@noble/curves/nist.js';
import { afterAll, describe, expect, it } from 'vitest';
import { recoverPublicKeys, signatureFromDer } from './p256';
import * as raw from './puzzle-bytes';
import { custodyHash, moneyPuzzleHash, passkeyMemberHash, vaultPuzzleHash } from './puzzles';
import type { Assertion } from './vault';
import { buildSetupSpend, buildVaultSpend, launchVault, setupPuzzleHash, vaultHint } from './vault';
import vectors from './vault-vectors.json';

interface CoinJson {
  parent_coin_info: string;
  puzzle_hash: string;
  amount: number;
}
const coin = (c: CoinJson): Coin => ({
  parentCoinInfo: fromHex(c.parent_coin_info),
  puzzleHash: fromHex(c.puzzle_hash),
  amount: BigInt(c.amount),
});
const strip = (hex: string) => hex.replace(/^0x/, '');

/** The bundle in the vectors' shape (no 0x), to compare whole bundles at once. */
function asVector(bundle: SpendBundle) {
  const json = spendBundleToJson(bundle) as {
    coin_spends: { coin: CoinJson; puzzle_reveal: string; solution: string }[];
    aggregated_signature: string;
  };
  return {
    coin_spends: json.coin_spends.map((cs) => ({
      coin: {
        parent_coin_info: strip(cs.coin.parent_coin_info),
        puzzle_hash: strip(cs.coin.puzzle_hash),
        amount: cs.coin.amount,
      },
      puzzle_reveal: strip(cs.puzzle_reveal),
      solution: strip(cs.solution),
    })),
    aggregated_signature: strip(json.aggregated_signature),
  };
}

function assertionOf(json: {
  authenticator_data: string;
  client_data_json: string;
  signature: string;
}): Assertion {
  return {
    authenticatorData: fromHex(json.authenticator_data),
    clientDataJSON: new TextEncoder().encode(json.client_data_json),
    signature: fromHex(json.signature),
  };
}

const [launchCase, setupCase, spendCase] = vectors.cases;
if (launchCase === undefined || setupCase === undefined || spendCase === undefined) {
  throw new Error('vault-vectors.json is missing cases');
}
const pk = fromHex(vectors.passkey.public_key);
const passkeySk = fromHex(vectors.passkey.secret_key);
const funderSk = fromHex(vectors.funder.synthetic_secret_key);
const funderCoin = coin(vectors.funder.coin);
const fee = BigInt(launchCase.fee);

/** A software passkey: what a real one returns for `challenge`, signed with the test key. */
function softwarePasskey(challenge: Bytes): Assertion {
  const authenticatorData = Uint8Array.from([
    ...sha256(new TextEncoder().encode('clapandpay.com')),
    0x05,
    0,
    0,
    0,
    1,
  ]);
  const challengeText = Buffer.from(challenge).toString('base64url');
  const clientDataJSON = new TextEncoder().encode(
    `{"type":"webauthn.get","challenge":"${challengeText}","origin":"http://localhost:8787"}`,
  );
  const der = p256.sign(sha256(authenticatorData, sha256(clientDataJSON)), passkeySk, {
    prehash: false,
    format: 'der',
  });
  return { authenticatorData, clientDataJSON, signature: signatureFromDer(der) };
}

// Bundles for the Rust verifier.
interface SpendCase {
  name: string;
  network: string;
  coins: CoinJson[];
  spend_bundle: unknown;
  expect: string;
}
const cases: SpendCase[] = [];
function record(name: string, coins: Coin[], bundle: SpendBundle, expectation = 'ok') {
  cases.push({
    name,
    network: 'testnet11',
    coins: coins.map((c) => ({
      parent_coin_info: `0x${toHex(c.parentCoinInfo)}`,
      puzzle_hash: `0x${toHex(c.puzzleHash)}`,
      amount: Number(c.amount),
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

describe('puzzles', () => {
  it('are exactly the ones chia-puzzles ships', () => {
    for (const [name, puzzle] of Object.entries(vectors.puzzles)) {
      expect(toHex(treeHash(deserialize(fromHex(puzzle.hex)))), name).toBe(puzzle.hash);
    }
    expect(raw.PASSKEY_MEMBER_HEX).toBe(vectors.puzzles.passkey_member.hex);
    expect(raw.SINGLETON_TOP_LAYER_HEX).toBe(vectors.puzzles.singleton_top_layer_v1_1.hex);
  });

  it('hash as chia-wallet-sdk hashes them', () => {
    for (const v of vectors.hashes) {
      const key = fromHex(v.public_key);
      const launcherId = fromHex(v.launcher_id);
      expect(toHex(vaultHint(key))).toBe(v.hint);
      expect(toHex(passkeyMemberHash(key))).toBe(v.passkey_member_hash);
      expect(toHex(custodyHash(key))).toBe(v.custody_hash);
      expect(toHex(setupPuzzleHash(key))).toBe(v.custody_hash);
      expect(toHex(moneyPuzzleHash(launcherId))).toBe(v.p2_puzzle_hash);
      expect(toHex(vaultPuzzleHash(launcherId, custodyHash(key)))).toBe(v.vault_puzzle_hash);
    }
  });
});

describe('launch', () => {
  const launch = launchVault(coinId(funderCoin), pk);
  const change = funderCoin.amount - 1n - fee;
  const funderSpend = spendStandardCoin(funderCoin, publicKey(funderSk), [
    ...launch.conditions,
    {
      kind: 'createCoin',
      puzzleHash: launch.moneyPuzzleHash,
      amount: change,
      memos: [launch.moneyPuzzleHash],
    },
    { kind: 'reserveFee', amount: fee },
  ]);
  const signed = signSpends([{ coinSpend: funderSpend, syntheticSk: funderSk }], TESTNET11);
  const bundle: SpendBundle = {
    coinSpends: [launch.launcherSpend, ...signed.coinSpends],
    aggregatedSignature: signed.aggregatedSignature,
  };

  it('from a standard coin is the SDK’s mint_vault, byte for byte, with no passkey prompt', () => {
    expect(toHex(launch.launcherId)).toBe(launchCase.launcher_id);
    expect(asVector(bundle)).toEqual(launchCase.spend_bundle);
    expect(launch.vault.coin).toEqual(coin(launchCase.vault_coin as CoinJson));
    record('vault: launch from a standard coin', [funderCoin], bundle);
  });

  it('from the setup address takes one prompt, byte for byte', () => {
    const setupCoin: Coin = {
      parentCoinInfo: new Uint8Array(32).fill(8),
      puzzleHash: setupPuzzleHash(pk),
      amount: 50_000_000n,
    };
    const fromSetup = launchVault(coinId(setupCoin), pk);
    const unsigned = buildSetupSpend({
      publicKey: pk,
      coin: setupCoin,
      conditions: [
        ...fromSetup.conditions,
        {
          kind: 'createCoin',
          puzzleHash: fromSetup.moneyPuzzleHash,
          amount: setupCoin.amount - 1n - fee,
          memos: [fromSetup.moneyPuzzleHash],
        },
        { kind: 'reserveFee', amount: fee },
      ],
      alsoSpend: [fromSetup.launcherSpend],
    });
    expect(toHex(unsigned.challenge)).toBe(setupCase.challenge);
    const done = unsigned.finish(assertionOf(setupCase.assertion as never));
    expect(asVector(done)).toEqual(setupCase.spend_bundle);
    record('vault: launch from the setup address', [setupCoin], done);
  });
});

describe('a vault spend', () => {
  const launch = launchVault(coinId(funderCoin), pk);
  const first = coin(launchCase.money_coin as CoinJson);
  const second: Coin = {
    parentCoinInfo: new Uint8Array(32).fill(9),
    puzzleHash: launch.moneyPuzzleHash,
    amount: 300_000_000n,
  };
  const destination = fromHex(spendCase.destination as string);
  const pay = BigInt(spendCase.pay as number);
  const plan = () =>
    buildVaultSpend({
      vault: launch.vault,
      money: [first, second],
      outputs: [{ puzzleHash: destination, amount: pay }],
      fee,
    });

  it('releases many coins with one passkey signature, byte for byte', () => {
    const unsigned = plan();
    expect(toHex(unsigned.challenge)).toBe(spendCase.challenge);
    const done = unsigned.finish(assertionOf(spendCase.assertion as never));
    expect(asVector(done)).toEqual(spendCase.spend_bundle);
  });

  it('works with what a browser passkey returns (another clientDataJSON, a DER signature)', () => {
    const unsigned = plan();
    const done = unsigned.finish(softwarePasskey(unsigned.challenge));
    record('vault: one prompt, two money coins', [launch.vault.coin, first, second], done);
  });

  it('then spends again from its next coin', () => {
    const one = plan();
    const after = one.next;
    const change: Coin = {
      parentCoinInfo: coinId(first),
      puzzleHash: launch.moneyPuzzleHash,
      amount: first.amount + second.amount - pay - fee,
    };
    const two = buildVaultSpend({
      vault: after,
      money: [change],
      outputs: [{ puzzleHash: destination, amount: 1_000n }],
      fee,
    });
    record(
      'vault: the second spend, from the recreated vault',
      [after.coin, change],
      two.finish(softwarePasskey(two.challenge)),
    );
  });

  it('refuses an answer to another challenge before anything is sent', () => {
    const unsigned = plan();
    const other = softwarePasskey(sha256(new TextEncoder().encode('another challenge')));
    expect(() => unsigned.finish(other)).toThrow(/bad_assertion/);
  });

  it('refuses a signature by another key', () => {
    const unsigned = plan();
    const real = softwarePasskey(unsigned.challenge);
    const forged = p256.sign(
      sha256(real.authenticatorData, sha256(real.clientDataJSON)),
      new Uint8Array(32).fill(0x33),
      { prehash: false },
    );
    expect(() => unsigned.finish({ ...real, signature: forged })).toThrow(/bad_assertion/);
  });

  it('cannot spend more than the coins hold', () => {
    expect(() =>
      buildVaultSpend({
        vault: launch.vault,
        money: [second],
        outputs: [{ puzzleHash: destination, amount: second.amount }],
        fee,
      }),
    ).toThrow(/insufficient_funds/);
  });

  // What the chain itself refuses, whatever a page builds.
  it('records bundles the network must reject', () => {
    const unsigned = plan();
    const good = unsigned.finish(softwarePasskey(unsigned.challenge));
    const spends = good.coinSpends;
    const vaultSpend = spends[spends.length - 1];
    if (vaultSpend === undefined) throw new Error('no vault spend');

    // A money coin without the vault: nobody sends it the message it waits for.
    record(
      'vault (must fail): a money coin spent without the vault',
      [second],
      { coinSpends: [spends[1] as never], aggregatedSignature: good.aggregatedSignature },
      'MessageNotSentOrReceived',
    );

    // One byte of the passkey signature changed.
    const solution = Uint8Array.from(vaultSpend.solution);
    const at = solution.length - 40;
    solution[at] = (solution[at] ?? 0) ^ 1;
    record(
      'vault (must fail): a changed passkey signature',
      [launch.vault.coin, first, second],
      {
        coinSpends: [...spends.slice(0, -1), { ...vaultSpend, solution }],
        aggregatedSignature: good.aggregatedSignature,
      },
      // secp256r1_verify raises: the puzzle fails
      'GeneratorRuntimeError',
    );

    // Another destination for the same signature: the challenge no longer matches.
    const elsewhere = buildVaultSpend({
      vault: launch.vault,
      money: [first, second],
      outputs: [{ puzzleHash: new Uint8Array(32).fill(0xee), amount: pay }],
      fee,
    });
    const reused = softwarePasskey(unsigned.challenge);
    expect(() => elsewhere.finish(reused)).toThrow(/bad_assertion/);
    const stolen = elsewhere.finish(softwarePasskey(elsewhere.challenge));
    const theirVault = stolen.coinSpends[stolen.coinSpends.length - 1];
    if (theirVault === undefined) throw new Error('no vault spend');
    record(
      'vault (must fail): a signature moved to another payment',
      [launch.vault.coin, first, second],
      {
        coinSpends: [
          ...stolen.coinSpends.slice(0, -1),
          { ...theirVault, solution: vaultSpend.solution },
        ],
        aggregatedSignature: good.aggregatedSignature,
      },
      // the old signature still verifies, but for the old messages, which no coin waits for
      'MessageNotSentOrReceived',
    );
  });
});

describe('finding a vault from a signature', () => {
  it('recovers the passkey’s public key among at most two candidates', () => {
    const a = softwarePasskey(sha256(new TextEncoder().encode('sign in')));
    const keys = recoverPublicKeys(
      sha256(a.authenticatorData, sha256(a.clientDataJSON)),
      a.signature,
    );
    expect(keys.length).toBeLessThanOrEqual(2);
    expect(keys.map(toHex)).toContain(toHex(pk));
  });
});
