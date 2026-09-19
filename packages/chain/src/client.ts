// SPDX-License-Identifier: AGPL-3.0-or-later
import { ChainError } from './errors';
import { toHex0x } from './hex';
import { parseCoinRecordByName, parseCoinRecords, parsePeakHeight, parsePushStatus } from './parse';
import { spendBundleToJson } from './spend-bundle-json';
import { createTransport, type NodeErrorDecision, type TransportOptions } from './transport';
import type { Bytes, CoinRecord, SpendBundle } from './types';

/** The most puzzle hashes sent in one `get_coin_records_by_puzzle_hashes` request. */
export const MAX_PUZZLE_HASHES_PER_REQUEST = 100;

/** Read and push access to a Chia full node over Coinset-compatible RPC. */
export interface ChainClient {
  /** All coins at the given puzzle hashes, in one batched request per 100 hashes. */
  coinRecordsByPuzzleHashes(
    puzzleHashes: Bytes[],
    opts?: { includeSpent?: boolean },
  ): Promise<CoinRecord[]>;
  /** One coin by its id, or `null` when the node does not know it. */
  coinRecordByName(coinId: Bytes): Promise<CoinRecord | null>;
  /** Submits a spend bundle to the mempool; definitive rejections throw a typed `ChainError`. */
  pushTx(bundle: SpendBundle): Promise<{ status: 'success' | 'pending' }>;
  /** Height of the current peak block. */
  peakHeight(): Promise<number>;
}

// Errors that say "this node cannot answer now", not "this transaction is invalid".
const TRANSIENT_PUSH_ERROR =
  /SYNCING|NOT[ _]SYNCED|TIMEOUT|TIMED OUT|RATE LIMIT|TOO MANY REQUESTS/i;

/** Maps the node's `push_tx` error text to the contract's outcome. */
export function classifyPushError(
  detail: string,
): NodeErrorDecision<{ status: 'success' | 'pending' }> {
  if (/DOUBLE_SPEND|MEMPOOL_CONFLICT/.test(detail)) return new ChainError('double_spend', detail);
  if (/UNKNOWN_UNSPENT/.test(detail)) return new ChainError('unknown_coin', detail);
  // The same bundle is already in the mempool (for example a retry after a timeout): that is success.
  if (/ALREADY_INCLUDING_TRANSACTION/.test(detail)) return { value: { status: 'success' } };
  if (TRANSIENT_PUSH_ERROR.test(detail)) return null;
  return new ChainError('rejected', detail);
}

function hash32ToHex(bytes: Bytes, what: string): string {
  if (bytes.length !== 32) throw new RangeError(`${what} must be 32 bytes, got ${bytes.length}`);
  return toHex0x(bytes);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Creates the RPC client. Endpoints are tried in order; the last healthy one is tried first next time. */
export function createChainClient(opts: TransportOptions): ChainClient {
  const transport = createTransport(opts);

  return {
    async coinRecordsByPuzzleHashes(puzzleHashes, callOpts) {
      if (puzzleHashes.length === 0) return [];
      const hex = puzzleHashes.map((ph) => hash32ToHex(ph, 'puzzle hash'));
      const includeSpent = callOpts?.includeSpent ?? false;
      const pages = await Promise.all(
        chunks(hex, MAX_PUZZLE_HASHES_PER_REQUEST).map((page) =>
          transport.call({
            method: 'get_coin_records_by_puzzle_hashes',
            body: { puzzle_hashes: page, include_spent_coins: includeSpent },
            parse: parseCoinRecords,
          }),
        ),
      );
      return pages.length === 1 && pages[0] !== undefined ? pages[0] : pages.flat();
    },

    async coinRecordByName(coinId) {
      return transport.call<CoinRecord | null>({
        method: 'get_coin_record_by_name',
        body: { name: hash32ToHex(coinId, 'coin id') },
        parse: parseCoinRecordByName,
        onNodeError: (detail) => (/not found/i.test(detail) ? { value: null } : null),
      });
    },

    async pushTx(bundle) {
      return transport.call({
        method: 'push_tx',
        body: { spend_bundle: spendBundleToJson(bundle) },
        parse: parsePushStatus,
        onNodeError: classifyPushError,
      });
    },

    peakHeight() {
      return transport.call({ method: 'get_blockchain_state', body: {}, parse: parsePeakHeight });
    },
  };
}
