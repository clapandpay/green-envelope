// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bytes } from './bytes';
import { sha256 } from './bytes';
import { intAtom } from './clvm';
import { ChiaError } from './errors';

/** A coin: who created it, which puzzle locks it, and how many mojos it holds. */
export interface Coin {
  parentCoinInfo: Bytes;
  puzzleHash: Bytes;
  amount: bigint;
}

/** Largest amount a coin can hold (an unsigned 64-bit integer). */
export const MAX_COIN_AMOUNT = 0xffff_ffff_ffff_ffffn;

/** Internal: throws unless `amount` is a bigint in [0, 2^64). */
export function checkAmount(amount: bigint): void {
  if (typeof amount !== 'bigint' || amount < 0n || amount > MAX_COIN_AMOUNT) {
    throw new ChiaError('amount_out_of_range', 'amount must be a bigint between 0 and 2^64 - 1');
  }
}

/** Coin id (the coin's name): sha256(parent || puzzle hash || amount as a CLVM integer). */
export function coinId(coin: Coin): Bytes {
  if (coin.parentCoinInfo.length !== 32 || coin.puzzleHash.length !== 32) {
    throw new ChiaError('bad_length', 'parent coin info and puzzle hash must be 32 bytes');
  }
  checkAmount(coin.amount);
  return sha256(coin.parentCoinInfo, coin.puzzleHash, intAtom(coin.amount));
}
