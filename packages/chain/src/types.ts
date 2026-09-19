// SPDX-License-Identifier: AGPL-3.0-or-later
// Structural copies of the `@ge/chia` types this package touches, so it builds and tests on its own.

/** Raw bytes; hex appears only at the JSON edge. */
export type Bytes = Uint8Array;

/** A Chia coin, identical in shape to `Coin` in `@ge/chia`. */
export interface Coin {
  parentCoinInfo: Bytes;
  puzzleHash: Bytes;
  amount: bigint;
}

/** One coin spend, identical in shape to `CoinSpend` in `@ge/chia`. */
export interface CoinSpend {
  coin: Coin;
  puzzleReveal: Bytes;
  solution: Bytes;
}

/** A signed spend bundle, identical in shape to `SpendBundle` in `@ge/chia`. */
export interface SpendBundle {
  coinSpends: CoinSpend[];
  aggregatedSignature: Bytes;
}

/** A coin as the full node knows it: where it was confirmed and whether it is spent. */
export interface CoinRecord {
  coin: Coin;
  confirmedHeight: number;
  /** `null` means unspent. */
  spentHeight: number | null;
  /** Unix seconds of confirmation. */
  timestamp: number;
}
