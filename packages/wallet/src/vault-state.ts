// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a passkey's money is on the chain: its vault's current coin, the money coins, and coins
// that arrived at the setup address before there was a vault. All of it is read with public
// data only (a public key, a launcher id) and without a prompt.
import type { ChainClient, CoinRecord } from '@ge/chain';
import type { Bytes, Coin } from '@ge/chia';
import { coinId, equalBytes, fromHex } from '@ge/chia';
import type { VaultCoin } from '@ge/vault';
import {
  custodyHash,
  moneyPuzzleHash,
  setupPuzzleHash,
  vaultHint,
  vaultPuzzleHash,
} from '@ge/vault';

/** chia-puzzles `SINGLETON_LAUNCHER_HASH`. */
const LAUNCHER_HASH = /* @__PURE__ */ fromHex(
  'eff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9',
);

/** The vault a passkey launched, found by its hint: its launcher id, or null when none. */
export async function findLauncherId(chain: ChainClient, publicKey: Bytes): Promise<Bytes | null> {
  const records = await chain.coinRecordsByHint(vaultHint(publicKey), { includeSpent: true });
  // The launcher is the hinted coin at the launcher puzzle; the earliest one wins (a second
  // launch would be a mistake, and the first vault is the one the money went to).
  const launchers = records
    .filter((record) => equalBytes(record.coin.puzzleHash, LAUNCHER_HASH))
    .sort((a, b) => a.confirmedHeight - b.confirmedHeight);
  const first = launchers[0];
  return first === undefined ? null : coinId(first.coin);
}

/**
 * The vault's unspent coin with its lineage proof, or null while the launch (or the last spend)
 * is not confirmed yet. Follows the hint every vault coin carries.
 */
export async function currentVault(
  chain: ChainClient,
  publicKey: Bytes,
  launcherId: Bytes,
): Promise<VaultCoin | null> {
  const custody = custodyHash(publicKey);
  const puzzleHash = vaultPuzzleHash(launcherId, custody);
  const records = await chain.coinRecordsByHint(vaultHint(publicKey));
  const vault = records.find((record) => equalBytes(record.coin.puzzleHash, puzzleHash));
  if (vault === undefined) {
    // The first vault coin (made by the launcher) carries no hint: look below the launcher.
    const eve = (await chain.coinRecordsByParentIds([launcherId])).find((record) =>
      equalBytes(record.coin.puzzleHash, puzzleHash),
    );
    if (eve === undefined) return null;
    return withLineage(chain, eve, launcherId, publicKey, custody);
  }
  return withLineage(chain, vault, launcherId, publicKey, custody);
}

async function withLineage(
  chain: ChainClient,
  record: CoinRecord,
  launcherId: Bytes,
  publicKey: Bytes,
  custody: Bytes,
): Promise<VaultCoin | null> {
  const parent = await chain.coinRecordByName(record.coin.parentCoinInfo);
  if (parent === null) return null;
  const isEve = equalBytes(parent.coin.puzzleHash, LAUNCHER_HASH);
  return {
    coin: record.coin,
    launcherId,
    publicKey,
    lineage: isEve
      ? {
          kind: 'eve',
          parentParentCoinInfo: parent.coin.parentCoinInfo,
          parentAmount: parent.coin.amount,
        }
      : {
          kind: 'child',
          parentParentCoinInfo: parent.coin.parentCoinInfo,
          parentInnerPuzzleHash: custody,
          parentAmount: parent.coin.amount,
        },
  };
}

/** The wallet's money: coins at the vault's address, and at the setup address. */
export async function walletCoins(
  chain: ChainClient,
  publicKey: Bytes,
  launcherId: Bytes | null,
): Promise<{ money: Coin[]; setup: Coin[] }> {
  const setupHash = setupPuzzleHash(publicKey);
  const hashes = launcherId === null ? [setupHash] : [moneyPuzzleHash(launcherId), setupHash];
  const records = await chain.coinRecordsByPuzzleHashes(hashes);
  const money: Coin[] = [];
  const setup: Coin[] = [];
  for (const { coin } of records) {
    (equalBytes(coin.puzzleHash, setupHash) ? setup : money).push(coin);
  }
  return { money, setup };
}

/**
 * Which of the candidate keys a found passkey has: the one with a vault or setup money on the
 * chain. Null when the chain cannot tell (none has anything, which is a new passkey).
 */
export async function keyWithMoney(
  chain: ChainClient,
  candidates: Bytes[],
): Promise<{ publicKey: Bytes; launcherId: Bytes | null } | null> {
  for (const publicKey of candidates) {
    const launcherId = await findLauncherId(chain, publicKey);
    if (launcherId !== null) return { publicKey, launcherId };
    const { setup } = await walletCoins(chain, publicKey, null);
    if (setup.length > 0) return { publicKey, launcherId: null };
  }
  return null;
}
