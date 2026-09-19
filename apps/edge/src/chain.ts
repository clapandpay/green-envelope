// SPDX-License-Identifier: AGPL-3.0-or-later
// The one chain read the previews need, behind an interface small enough to fake in tests. The
// default implementation below can be replaced by an adapter over `@ge/chain`.
import { toHex0x } from './bytes';

/** The part of a coin record a link preview needs. */
export interface ShareCoin {
  readonly amount: bigint;
  readonly spent: boolean;
}

/** Read access to the chain, reduced to the single batched request of the preview. */
export interface ChainLookup {
  /** All coins, spent ones included, at the given puzzle hashes, in one request. */
  coinRecordsByPuzzleHashes(
    puzzleHashes: readonly Uint8Array[],
    opts: { readonly signal: AbortSignal },
  ): Promise<ShareCoin[]>;
}

/** Options of `createChainLookup`. */
export interface ChainLookupOptions {
  readonly endpoints: readonly string[];
  readonly fetch: typeof fetch;
  /** Timeout of one attempt against one endpoint. */
  readonly attemptTimeoutMs: number;
}

/** Thrown when no endpoint gave a usable answer. */
export class ChainLookupError extends Error {
  readonly code = 'chain_unavailable';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseShareCoin(record: unknown): ShareCoin | null {
  if (!isRecord(record) || !isRecord(record.coin)) return null;
  const { amount } = record.coin;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
  if (typeof record.spent !== 'boolean') return null;
  return { amount: BigInt(amount), spent: record.spent };
}

/** Parses a `get_coin_records_by_puzzle_hashes` answer; `null` when it is not a successful one. */
export function parseCoinRecords(body: unknown): ShareCoin[] | null {
  if (!isRecord(body) || body.success !== true || !Array.isArray(body.coin_records)) return null;
  const coins: ShareCoin[] = [];
  for (const record of body.coin_records) {
    const coin = parseShareCoin(record);
    if (coin === null) return null;
    coins.push(coin);
  }
  return coins;
}

/** A fetch-based `ChainLookup` over Coinset-compatible endpoints, tried in order. */
export function createChainLookup(options: ChainLookupOptions): ChainLookup {
  const attempt = async (base: string, body: string, signal: AbortSignal) => {
    const response = await options.fetch(`${base}/get_coin_records_by_puzzle_hashes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(options.attemptTimeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return parseCoinRecords(await response.json());
  };

  return {
    async coinRecordsByPuzzleHashes(puzzleHashes, { signal }) {
      const body = JSON.stringify({
        puzzle_hashes: puzzleHashes.map(toHex0x),
        include_spent_coins: true,
      });
      for (const base of options.endpoints) {
        if (signal.aborted) break;
        const coins = await attempt(base, body, signal).catch(() => null);
        if (coins !== null) return coins;
      }
      throw new ChainLookupError('no chain endpoint answered');
    },
  };
}
