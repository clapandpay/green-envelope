// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ChainClient, ChainError, type CoinRecord } from '@ge/chain';
import {
  type Bytes,
  type Coin,
  coinId,
  equalBytes,
  type Network,
  type PublicKey,
  type SecretKey,
  toHex,
} from '@ge/chia';
import { buildOpen, buildTakeBack } from './builders';
import { MAX_SHARES } from './constants';
import { EnvelopeError } from './errors';
import { sharePuzzleHash } from './shares';

/** One share as the chain sees it. */
export interface ShareState {
  index: number;
  coin: Coin;
  opened: boolean;
}

const SCAN_BATCH = 20;

/** Keeps the coins of the creating transaction only, so dust sent to a share address is ignored. */
function sharesOfOneParent(found: { index: number; record: CoinRecord }[]): ShareState[] {
  const first = found
    .filter((entry) => entry.index === 0)
    .sort((a, b) => a.record.confirmedHeight - b.record.confirmedHeight)[0];
  if (first === undefined) return [];
  const parent = first.record.coin.parentCoinInfo;
  const byIndex = new Map<number, ShareState>();
  for (const { index, record } of found) {
    if (!equalBytes(record.coin.parentCoinInfo, parent) || byIndex.has(index)) continue;
    byIndex.set(index, { index, coin: record.coin, opened: record.spentHeight !== null });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * Finds an envelope's shares from its public key alone. With `sharesHint` (from the link) this is
 * one request; without it the addresses are scanned in batches until a gap.
 */
export async function inspectEnvelope(
  chain: ChainClient,
  envelopePk: PublicKey,
  sharesHint?: number,
): Promise<ShareState[]> {
  const found: { index: number; record: CoinRecord }[] = [];
  const limit = sharesHint ?? MAX_SHARES;
  const batch = sharesHint ?? SCAN_BATCH;
  for (let start = 0; start < limit; start += batch) {
    const end = Math.min(limit, start + batch);
    const indexOf = new Map<string, number>();
    const hashes: Bytes[] = [];
    for (let index = start; index < end; index++) {
      const hash = sharePuzzleHash(envelopePk, index);
      hashes.push(hash);
      indexOf.set(toHex(hash), index);
    }
    const records = await chain.coinRecordsByPuzzleHashes(hashes, { includeSpent: true });
    let highest = -1;
    for (const record of records) {
      const index = indexOf.get(toHex(record.coin.puzzleHash));
      if (index === undefined) continue;
      found.push({ index, record });
      highest = Math.max(highest, index);
    }
    if (highest < end - 1) break; // shares are contiguous from 0: a gap ends the envelope
  }
  return sharesOfOneParent(found);
}

/** What `openEnvelope` hands back as soon as the network has accepted the claim. */
export interface OpenedShare {
  share: ShareState;
  received: bigint;
  /** The coin that will exist in the claimer's wallet once confirmed. */
  output: Coin;
}

function isLostRace(error: unknown): boolean {
  return (
    error instanceof ChainError && (error.code === 'double_spend' || error.code === 'unknown_coin')
  );
}

/**
 * Opens one random unopened share for `toPuzzleHash`. Losing a race for a share is normal in a
 * group chat, so every share is tried before giving up: the known list first, without asking the
 * chain again, then one fresh look in case the first one was stale.
 */
export async function openEnvelope(args: {
  chain: ChainClient;
  envelopeSk: SecretKey;
  envelopePk: PublicKey;
  sharesHint?: number;
  toPuzzleHash: Bytes;
  fee: bigint;
  network: Network;
  random?: () => number;
}): Promise<OpenedShare> {
  const { chain, envelopeSk, envelopePk, sharesHint, toPuzzleHash, fee, network } = args;
  const random = args.random ?? Math.random;
  const tried = new Set<number>();

  for (let look = 0; look < 2; look++) {
    const shares = await inspectEnvelope(chain, envelopePk, sharesHint);
    if (shares.length === 0) throw new EnvelopeError('not_found');
    const candidates = shares.filter(
      (share) => !share.opened && !tried.has(share.index) && share.coin.amount > fee,
    );
    while (candidates.length > 0) {
      const [share] = candidates.splice(Math.floor(random() * candidates.length), 1);
      if (share === undefined) break;
      tried.add(share.index);
      const { bundle, received } = buildOpen({ share, envelopeSk, toPuzzleHash, fee, network });
      try {
        await chain.pushTx(bundle);
      } catch (error) {
        if (isLostRace(error)) continue;
        throw error;
      }
      return {
        share,
        received,
        output: { parentCoinInfo: coinId(share.coin), puzzleHash: toPuzzleHash, amount: received },
      };
    }
  }
  throw new EnvelopeError('envelope_empty');
}

/** Injectable waiting, so tests do not sleep. */
export interface Waiting {
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Resolves when `output` exists on chain. A node may answer "pending" to a claim that later
 * loses to somebody else's, so the claim only counts once its output coin is there:
 * throws `EnvelopeError('lost_race')` when the share was spent without creating it.
 */
export async function waitForOutput(
  chain: ChainClient,
  spent: Coin,
  output: Coin,
  waiting: Waiting = {},
): Promise<void> {
  const sleep = waiting.sleep ?? realSleep;
  const interval = waiting.intervalMs ?? 5_000;
  const spentId = coinId(spent);
  const outputId = coinId(output);
  for (let waited = 0; waited <= (waiting.timeoutMs ?? 600_000); waited += interval) {
    if ((await chain.coinRecordByName(outputId)) !== null) return;
    const record = await chain.coinRecordByName(spentId);
    if (record !== null && record.spentHeight !== null) {
      // Spent in the same block as our output would have been created: look once more.
      if ((await chain.coinRecordByName(outputId)) !== null) return;
      throw new EnvelopeError('lost_race');
    }
    await sleep(interval);
  }
  throw new EnvelopeError('timeout', 'the network did not confirm in time');
}

/** Sweeps every unopened share back to `toPuzzleHash`. */
export async function takeBackEnvelope(args: {
  chain: ChainClient;
  envelopeSk: SecretKey;
  envelopePk: PublicKey;
  sharesHint?: number;
  toPuzzleHash: Bytes;
  fee: bigint;
  network: Network;
}): Promise<{ received: bigint; spent: Coin; output: Coin }> {
  const { chain, envelopeSk, envelopePk, sharesHint, toPuzzleHash, fee, network } = args;
  const unopened = (await inspectEnvelope(chain, envelopePk, sharesHint)).filter(
    (share) => !share.opened,
  );
  const first = unopened[0];
  if (first === undefined) throw new EnvelopeError('nothing_to_take_back');
  const { bundle, received } = buildTakeBack({
    shares: unopened,
    envelopeSk,
    toPuzzleHash,
    fee,
    network,
  });
  await chain.pushTx(bundle);
  return {
    received,
    spent: first.coin,
    output: { parentCoinInfo: coinId(first.coin), puzzleHash: toPuzzleHash, amount: received },
  };
}
