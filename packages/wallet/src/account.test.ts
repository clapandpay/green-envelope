// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { fromHex, MAINNET, TESTNET11, toHex } from '@ge/chia';
import { describe, expect, it } from 'vitest';
import { accountFromSeed, envelopeSecret, selectCoins } from './account';
import { WalletError } from './errors';

// The golden vectors come from chia-wallet-sdk (tools/vectors). `wallet[0]` is the SDK's own
// master_to_wallet_unhardened(master, 0): the first address Sage, and so Klimper, shows for a key.
interface KeyVector {
  seed: string;
  wallet: { index: number; puzzle_hash: string }[];
}
const vectors = JSON.parse(
  readFileSync(new URL('../../chia/src/vectors.json', import.meta.url), 'utf8'),
) as { keys: KeyVector[] };

describe('accountFromSeed', () => {
  it('lands on the address a standard Chia wallet shows first for the same key', () => {
    expect(vectors.keys.length).toBeGreaterThan(0);
    for (const vector of vectors.keys) {
      const first = vector.wallet.find((entry) => entry.index === 0);
      const account = accountFromSeed(fromHex(vector.seed), MAINNET);
      expect(toHex(account.puzzleHash)).toBe(first?.puzzle_hash);
    }
  });

  it('uses the network prefix and the same key on both networks', () => {
    const seed = fromHex(vectors.keys[0]?.seed ?? '');
    const main = accountFromSeed(seed, MAINNET);
    const test = accountFromSeed(seed, TESTNET11);
    expect(main.address.startsWith('xch1')).toBe(true);
    expect(test.address.startsWith('txch1')).toBe(true);
    expect(toHex(main.puzzleHash)).toBe(toHex(test.puzzleHash));
  });
});

describe('envelopeSecret', () => {
  const account = accountFromSeed(fromHex(vectors.keys[0]?.seed ?? ''), MAINNET);

  it('is 16 bytes, stable, and different for every counter', () => {
    const secrets = [0, 1, 2, 4_294_967_295].map((n) => toHex(envelopeSecret(account, n)));
    expect(new Set(secrets).size).toBe(4);
    expect(secrets.every((secret) => secret.length === 32)).toBe(true);
    expect(toHex(envelopeSecret(account, 1))).toBe(secrets[1]);
  });

  it('refuses counters that are not unsigned 32-bit integers', () => {
    for (const bad of [-1, 1.5, 4_294_967_296, Number.NaN]) {
      expect(() => envelopeSecret(account, bad)).toThrowError(RangeError);
    }
  });
});

describe('selectCoins', () => {
  const coin = (amount: bigint) => ({
    parentCoinInfo: new Uint8Array(32),
    puzzleHash: new Uint8Array(32),
    amount,
  });

  it('takes the largest coins first and no more than needed', () => {
    const picked = selectCoins([coin(5n), coin(100n), coin(40n), coin(1n)], 120n);
    expect(picked.map((c) => c.amount)).toEqual([100n, 40n]);
  });

  it('says so when the coins do not cover the amount', () => {
    expect(() => selectCoins([coin(5n)], 6n)).toThrowError(WalletError);
  });
});
