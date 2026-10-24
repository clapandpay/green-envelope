// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChainClient, CoinRecord } from '@ge/chain';
import { type Coin, coinId, equalBytes, fromHex, toHex } from '@ge/chia';
import { launchVault } from '@ge/vault';
import { describe, expect, it } from 'vitest';
import { findLauncherId } from './vault-state';

const LAUNCHER_HASH = fromHex('eff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9');
// Any valid compressed P-256 point will do: the generator.
const PUBLIC_KEY = fromHex('036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');

/** Just enough of a chain: coins, the first memo of each, and when it was spent. */
function chainOf(coins: { coin: Coin; hint?: Uint8Array; height: number; spent: boolean }[]) {
  const records = coins.map(({ coin, height, spent }) => ({
    coin,
    confirmedHeight: height,
    spentHeight: spent ? height : null,
    timestamp: 0,
  }));
  const chain: Pick<ChainClient, 'coinRecordsByHint' | 'coinRecordsByParentIds'> = {
    async coinRecordsByHint(hint) {
      return records.filter((_, i) => {
        const memo = coins[i]?.hint;
        return memo !== undefined && equalBytes(memo, hint);
      });
    },
    async coinRecordsByParentIds(parentIds) {
      const wanted = new Set(parentIds.map(toHex));
      return records.filter((r: CoinRecord) => wanted.has(toHex(r.coin.parentCoinInfo)));
    },
  };
  return chain as ChainClient;
}

describe('findLauncherId', () => {
  const real = launchVault(new Uint8Array(32).fill(7), PUBLIC_KEY);
  const hint = real.conditions[0]?.kind === 'createCoin' ? real.conditions[0].memos?.[0] : null;
  const realLauncher: Coin = {
    parentCoinInfo: new Uint8Array(32).fill(7),
    puzzleHash: LAUNCHER_HASH,
    amount: 1n,
  };

  it('finds the launcher that made this passkey’s vault', async () => {
    if (hint == null) throw new Error('no hint');
    const chain = chainOf([
      { coin: realLauncher, hint, height: 10, spent: true },
      { coin: real.vault.coin, height: 10, spent: false },
    ]);
    expect(await findLauncherId(chain, PUBLIC_KEY)).toEqual(coinId(realLauncher));
  });

  it('ignores a hinted coin at the launcher puzzle that made no vault (anyone can make one)', async () => {
    if (hint == null) throw new Error('no hint');
    const fake: Coin = {
      parentCoinInfo: new Uint8Array(32).fill(9),
      puzzleHash: LAUNCHER_HASH,
      amount: 1n,
    };
    const spentFake: Coin = { ...fake, parentCoinInfo: new Uint8Array(32).fill(8) };
    const junk: Coin = {
      parentCoinInfo: coinId(spentFake),
      puzzleHash: fake.puzzleHash,
      amount: 1n,
    };
    // Only fakes: no vault.
    expect(
      await findLauncherId(
        chainOf([
          { coin: fake, hint, height: 1, spent: false },
          { coin: spentFake, hint, height: 2, spent: true },
          { coin: junk, height: 2, spent: false },
        ]),
        PUBLIC_KEY,
      ),
    ).toBeNull();
    // An earlier fake does not win over the real launch.
    expect(
      await findLauncherId(
        chainOf([
          { coin: fake, hint, height: 1, spent: false },
          { coin: spentFake, hint, height: 2, spent: true },
          { coin: junk, height: 2, spent: false },
          { coin: realLauncher, hint, height: 10, spent: true },
          { coin: real.vault.coin, height: 10, spent: false },
        ]),
        PUBLIC_KEY,
      ),
    ).toEqual(coinId(realLauncher));
  });
});
