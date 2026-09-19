// SPDX-License-Identifier: AGPL-3.0-or-later
// Duplicates `spendBundleToJson` of `@ge/chia`; the integrator should keep one of the two.
import { toHex0x } from './hex';
import type { Coin, SpendBundle } from './types';

/** The JSON shape of a coin in Chia's RPC. */
export interface CoinJson {
  parent_coin_info: string;
  puzzle_hash: string;
  amount: number;
}

/** The JSON shape of a spend bundle in Chia's `push_tx`. */
export interface SpendBundleJson {
  coin_spends: { coin: CoinJson; puzzle_reveal: string; solution: string }[];
  aggregated_signature: string;
}

function amountToJson(amount: bigint): number {
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`coin amount ${amount} cannot be written as a JSON number`);
  }
  return Number(amount);
}

function coinToJson(coin: Coin): CoinJson {
  return {
    parent_coin_info: toHex0x(coin.parentCoinInfo),
    puzzle_hash: toHex0x(coin.puzzleHash),
    amount: amountToJson(coin.amount),
  };
}

/** Encodes a spend bundle for `push_tx`: snake_case, 0x hex, amounts as numbers (throws beyond 2^53 - 1). */
export function spendBundleToJson(bundle: SpendBundle): SpendBundleJson {
  return {
    coin_spends: bundle.coinSpends.map((spend) => ({
      coin: coinToJson(spend.coin),
      puzzle_reveal: toHex0x(spend.puzzleReveal),
      solution: toHex0x(spend.solution),
    })),
    aggregated_signature: toHex0x(bundle.aggregatedSignature),
  };
}
