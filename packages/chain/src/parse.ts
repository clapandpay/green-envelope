// SPDX-License-Identifier: AGPL-3.0-or-later
// Narrowers from `unknown` JSON to typed values. Anything unexpected is a 'bad_response'.
import { ChainError } from './errors';
import { tryFromHex } from './hex';
import type { Bytes, Coin, CoinRecord } from './types';

/** A parsed JSON object whose fields are still unknown. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** Narrows to a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bad(what: string): ChainError {
  return new ChainError('bad_response', what);
}

// Mojo amounts are u64 and JSON numbers are doubles: quote long integers before JSON.parse sees them.
const LONG_AMOUNT = /("amount"\s*:\s*)(\d{16,})/g;

/** Parses a response body into a JSON object, keeping amounts beyond 2^53 exact. */
export function parseBody(text: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(LONG_AMOUNT, '$1"$2"'));
  } catch {
    throw bad('body is not JSON');
  }
  if (!isJsonObject(value)) throw bad('body is not a JSON object');
  return value;
}

/** The node's error text when the body says `success: false`, otherwise `null`. */
export function nodeFailure(body: JsonObject): string | null {
  if (body.success !== false) return null;
  return typeof body.error === 'string' && body.error !== '' ? body.error : 'unknown node error';
}

function field(obj: JsonObject, key: string): unknown {
  return obj[key];
}

function objectField(obj: JsonObject, key: string): JsonObject {
  const value = field(obj, key);
  if (!isJsonObject(value)) throw bad(`${key} is not an object`);
  return value;
}

function heightField(obj: JsonObject, key: string): number {
  const value = field(obj, key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw bad(`${key} is not a non-negative integer`);
  }
  return value;
}

function hash32Field(obj: JsonObject, key: string): Bytes {
  const value = field(obj, key);
  const bytes = typeof value === 'string' ? tryFromHex(value) : null;
  if (bytes === null || bytes.length !== 32) throw bad(`${key} is not 32 bytes of hex`);
  return bytes;
}

function amountField(obj: JsonObject, key: string): bigint {
  const value = field(obj, key);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value);
  throw bad(`${key} is not a non-negative integer`);
}

function parseCoin(obj: JsonObject): Coin {
  return {
    parentCoinInfo: hash32Field(obj, 'parent_coin_info'),
    puzzleHash: hash32Field(obj, 'puzzle_hash'),
    amount: amountField(obj, 'amount'),
  };
}

/** Parses one `coin_records[]` item of the full-node RPC. */
export function parseCoinRecord(value: unknown): CoinRecord {
  if (!isJsonObject(value)) throw bad('coin record is not an object');
  const spent = field(value, 'spent');
  if (typeof spent !== 'boolean') throw bad('spent is not a boolean');
  return {
    coin: parseCoin(objectField(value, 'coin')),
    confirmedHeight: heightField(value, 'confirmed_block_index'),
    spentHeight: spent ? heightField(value, 'spent_block_index') : null,
    timestamp: heightField(value, 'timestamp'),
  };
}

/** Parses the body of `get_coin_records_by_puzzle_hashes`. */
export function parseCoinRecords(body: JsonObject): CoinRecord[] {
  const records = field(body, 'coin_records');
  if (!Array.isArray(records)) throw bad('coin_records is not an array');
  return records.map(parseCoinRecord);
}

/** Parses the body of `get_coin_record_by_name`; a null or absent record means "not found". */
export function parseCoinRecordByName(body: JsonObject): CoinRecord | null {
  const record = field(body, 'coin_record');
  return record === null || record === undefined ? null : parseCoinRecord(record);
}

/** Parses `blockchain_state.peak.height` out of `get_blockchain_state`. */
export function parsePeakHeight(body: JsonObject): number {
  const peak = objectField(objectField(body, 'blockchain_state'), 'peak');
  return heightField(peak, 'height');
}

/** Parses the `status` of a successful `push_tx`. */
export function parsePushStatus(body: JsonObject): { status: 'success' | 'pending' } {
  const status = field(body, 'status');
  if (status === 'SUCCESS') return { status: 'success' };
  if (status === 'PENDING') return { status: 'pending' };
  throw bad(`unexpected push_tx status ${JSON.stringify(status)}`);
}
