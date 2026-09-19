// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type Bytes,
  type Coin,
  type Condition,
  coinId,
  type Network,
  type PublicKey,
  type SecretKey,
  type SpendBundle,
  signSpends,
  spendStandardCoin,
} from '@ge/chia';
import { MAX_SHARES } from './constants';
import { EnvelopeError } from './errors';
import { type ShareKey, shareKey, sharePuzzleHash } from './shares';

/** A standard-transaction key that owns coins: the wallet's, or one share's. */
export interface Signer {
  syntheticSk: SecretKey;
  syntheticPk: PublicKey;
}

/** A coin together with the key that can spend it. */
export interface OwnedCoin {
  coin: Coin;
  signer: Signer;
}

function sum(amounts: readonly bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n);
}

/**
 * Spends `inputs` as one atomic unit. The first coin carries `conditions`; every coin asserts that
 * the others are spent with it, so no subset of the bundle is valid by itself.
 */
function spendTogether(
  inputs: readonly OwnedCoin[],
  conditions: Condition[],
  network: Network,
): SpendBundle {
  const ids = inputs.map((input) => coinId(input.coin));
  const spends = inputs.map((input, at) => {
    const others: Condition[] = ids
      .filter((_, other) => (at === 0 ? other !== 0 : other === 0))
      .map((id) => ({ kind: 'assertConcurrentSpend', coinId: id }));
    return {
      coinSpend: spendStandardCoin(input.coin, input.signer.syntheticPk, [
        ...(at === 0 ? conditions : []),
        ...others,
      ]),
      syntheticSk: input.signer.syntheticSk,
    };
  });
  return signSpends(spends, network);
}

function feeCondition(fee: bigint): Condition[] {
  return fee > 0n ? [{ kind: 'reserveFee', amount: fee }] : [];
}

/** What `buildCreate` returns: the transaction, and the share coins it will create. */
export interface CreatedShares {
  bundle: SpendBundle;
  shares: { index: number; coin: Coin }[];
}

/**
 * One transaction from the sender's coins to one new coin per share, plus change.
 * `amounts[i]` goes to share `i` of `envelopePk`.
 */
export function buildCreate(args: {
  inputs: readonly OwnedCoin[];
  envelopePk: PublicKey;
  amounts: readonly bigint[];
  changePuzzleHash: Bytes;
  fee: bigint;
  network: Network;
}): CreatedShares {
  const { inputs, envelopePk, amounts, changePuzzleHash, fee, network } = args;
  const first = inputs[0];
  if (first === undefined) throw new EnvelopeError('insufficient_funds', 'no coins to spend');
  if (amounts.length < 1 || amounts.length > MAX_SHARES) throw new EnvelopeError('bad_shares');
  if (fee < 0n || amounts.some((amount) => amount <= 0n)) {
    throw new EnvelopeError('bad_amount', 'amounts must be positive and the fee not negative');
  }
  const change = sum(inputs.map((input) => input.coin.amount)) - sum(amounts) - fee;
  if (change < 0n) throw new EnvelopeError('insufficient_funds');

  const parent = coinId(first.coin);
  const shares = amounts.map((amount, index) => ({
    index,
    coin: { parentCoinInfo: parent, puzzleHash: sharePuzzleHash(envelopePk, index), amount },
  }));
  const conditions: Condition[] = [
    ...shares.map(
      ({ coin }): Condition => ({
        kind: 'createCoin',
        puzzleHash: coin.puzzleHash,
        amount: coin.amount,
      }),
    ),
    ...(change > 0n
      ? [{ kind: 'createCoin', puzzleHash: changePuzzleHash, amount: change } as const]
      : []),
    ...feeCondition(fee),
  ];
  return { bundle: spendTogether(inputs, conditions, network), shares };
}

/** Opens one share: the whole coin, minus the fee it pays for itself, goes to `toPuzzleHash`. */
export function buildOpen(args: {
  share: { index: number; coin: Coin };
  envelopeSk: SecretKey;
  toPuzzleHash: Bytes;
  fee: bigint;
  network: Network;
}): { bundle: SpendBundle; received: bigint } {
  const { share, envelopeSk, toPuzzleHash, fee, network } = args;
  const received = share.coin.amount - fee;
  if (fee < 0n || received <= 0n) {
    throw new EnvelopeError('bad_amount', 'the fee would eat the whole share');
  }
  const key: ShareKey = shareKey(envelopeSk, share.index);
  const conditions: Condition[] = [
    // The hint lets wallets that follow hints, not only addresses, see the money arrive.
    { kind: 'createCoin', puzzleHash: toPuzzleHash, amount: received, memos: [toPuzzleHash] },
    ...feeCondition(fee),
  ];
  return {
    bundle: spendTogether([{ coin: share.coin, signer: key }], conditions, network),
    received,
  };
}

/** Sweeps unopened shares back to the sender in one transaction. */
export function buildTakeBack(args: {
  shares: readonly { index: number; coin: Coin }[];
  envelopeSk: SecretKey;
  toPuzzleHash: Bytes;
  fee: bigint;
  network: Network;
}): { bundle: SpendBundle; received: bigint } {
  const { shares, envelopeSk, toPuzzleHash, fee, network } = args;
  if (shares.length === 0) throw new EnvelopeError('nothing_to_take_back');
  const received = sum(shares.map((share) => share.coin.amount)) - fee;
  if (fee < 0n || received <= 0n) {
    throw new EnvelopeError('bad_amount', 'the fee would eat everything that is left');
  }
  const inputs = shares.map((share) => ({
    coin: share.coin,
    signer: shareKey(envelopeSk, share.index),
  }));
  const conditions: Condition[] = [
    { kind: 'createCoin', puzzleHash: toPuzzleHash, amount: received, memos: [toPuzzleHash] },
    ...feeCondition(fee),
  ];
  return { bundle: spendTogether(inputs, conditions, network), received };
}

/** A plain payment from the wallet's coins, with change back to the wallet. */
export function buildSend(args: {
  inputs: readonly OwnedCoin[];
  toPuzzleHash: Bytes;
  amount: bigint;
  changePuzzleHash: Bytes;
  fee: bigint;
  network: Network;
}): SpendBundle {
  const { inputs, toPuzzleHash, amount, changePuzzleHash, fee, network } = args;
  if (inputs.length === 0) throw new EnvelopeError('insufficient_funds', 'no coins to spend');
  if (amount <= 0n || fee < 0n) throw new EnvelopeError('bad_amount');
  const change = sum(inputs.map((input) => input.coin.amount)) - amount - fee;
  if (change < 0n) throw new EnvelopeError('insufficient_funds');
  const conditions: Condition[] = [
    { kind: 'createCoin', puzzleHash: toPuzzleHash, amount, memos: [toPuzzleHash] },
    ...(change > 0n
      ? [{ kind: 'createCoin', puzzleHash: changePuzzleHash, amount: change } as const]
      : []),
    ...feeCondition(fee),
  ];
  return spendTogether(inputs, conditions, network);
}
