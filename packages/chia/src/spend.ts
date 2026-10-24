// SPDX-License-Identifier: AGPL-3.0-or-later
// Building and signing standard-transaction spends (the delegated-puzzle path only).
import type { Bytes } from './bytes';
import { equalBytes, toHex } from './bytes';
import type { Clvm } from './clvm';
import { deserialize, intAtom, list, NIL, serialize, treeHash } from './clvm';
import type { Coin } from './coin';
import { checkAmount, coinId } from './coin';
import { ChiaError } from './errors';
import type { PublicKey, SecretKey, Signature } from './keys';
import { aggregate, publicKey, signWithPublicKey } from './keys';
import type { Network } from './network';
import { standardPuzzleHash, standardPuzzleReveal } from './standard';

/** The conditions a Green Envelope spend can output. */
export type Condition =
  | { kind: 'createCoin'; puzzleHash: Bytes; amount: bigint; memos?: Bytes[] }
  | { kind: 'reserveFee'; amount: bigint }
  | { kind: 'assertConcurrentSpend'; coinId: Bytes }
  | { kind: 'assertCoinAnnouncement'; announcementId: Bytes }
  | { kind: 'sendMessage'; mode: number; message: Bytes; receiverCoinId: Bytes }
  | { kind: 'assertBeforeSecondsAbsolute'; seconds: bigint };

/** One coin being spent: the coin, its full puzzle and the solution, both serialized CLVM. */
export interface CoinSpend {
  coin: Coin;
  puzzleReveal: Bytes;
  solution: Bytes;
}

/** Coin spends plus the one aggregated signature that authorizes all of them. */
export interface SpendBundle {
  coinSpends: CoinSpend[];
  aggregatedSignature: Signature;
}

const CREATE_COIN = 51;
const RESERVE_FEE = 52;
const ASSERT_COIN_ANNOUNCEMENT = 61;
const ASSERT_CONCURRENT_SPEND = 64;
const SEND_MESSAGE = 66;
const ASSERT_BEFORE_SECONDS_ABSOLUTE = 85;
const QUOTE = /* @__PURE__ */ Uint8Array.of(1);

function check32(value: Bytes, what: string): Bytes {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new ChiaError('bad_length', `${what} must be 32 bytes`);
  }
  return value;
}

/** One condition as CLVM, as a puzzle outputs it. */
export function conditionToClvm(condition: Condition): Clvm {
  switch (condition.kind) {
    case 'createCoin': {
      checkAmount(condition.amount);
      const items: Clvm[] = [
        intAtom(CREATE_COIN),
        check32(condition.puzzleHash, 'puzzle hash'),
        intAtom(condition.amount),
      ];
      // Memos are one trailing argument holding a list; absent memos mean no argument at all.
      if (condition.memos !== undefined) items.push(list(...condition.memos));
      return list(...items);
    }
    case 'reserveFee':
      checkAmount(condition.amount);
      return list(intAtom(RESERVE_FEE), intAtom(condition.amount));
    case 'assertConcurrentSpend':
      return list(intAtom(ASSERT_CONCURRENT_SPEND), check32(condition.coinId, 'coin id'));
    case 'assertCoinAnnouncement':
      return list(
        intAtom(ASSERT_COIN_ANNOUNCEMENT),
        check32(condition.announcementId, 'announcement id'),
      );
    case 'sendMessage':
      return list(
        intAtom(SEND_MESSAGE),
        intAtom(condition.mode),
        condition.message,
        check32(condition.receiverCoinId, 'receiver coin id'),
      );
    case 'assertBeforeSecondsAbsolute':
      checkAmount(condition.seconds);
      return list(intAtom(ASSERT_BEFORE_SECONDS_ABSOLUTE), intAtom(condition.seconds));
  }
}

/** One standard-transaction spend, unsigned. `syntheticPk` must own `coin.puzzleHash` (throws otherwise). */
export function spendStandardCoin(
  coin: Coin,
  syntheticPk: PublicKey,
  conditions: Condition[],
): CoinSpend {
  if (!equalBytes(standardPuzzleHash(syntheticPk), check32(coin.puzzleHash, 'puzzle hash'))) {
    throw new ChiaError('wrong_puzzle_hash', 'the synthetic key does not own this coin');
  }
  check32(coin.parentCoinInfo, 'parent coin info');
  checkAmount(coin.amount);
  // Delegated puzzle `(q . conditions)`; solution `(() delegated_puzzle ())`: no original public
  // key (not the hidden-puzzle path) and an empty solution for the delegated puzzle.
  const delegatedPuzzle: Clvm = [QUOTE, list(...conditions.map(conditionToClvm))];
  return {
    coin,
    puzzleReveal: standardPuzzleReveal(syntheticPk),
    solution: serialize(list(NIL, delegatedPuzzle, NIL)),
  };
}

function delegatedPuzzleHash(solution: Bytes): Bytes {
  const parsed = deserialize(solution);
  if (!(parsed instanceof Uint8Array)) {
    const rest = parsed[1];
    if (!(rest instanceof Uint8Array)) return treeHash(rest[0]);
  }
  throw new ChiaError('bad_clvm', 'not a standard-transaction solution');
}

/** Signs each spend's AGG_SIG_ME with its synthetic secret key and aggregates. */
export function signSpends(
  spends: { coinSpend: CoinSpend; syntheticSk: SecretKey }[],
  network: Network,
): SpendBundle {
  check32(network.aggSigMeExtraData, 'AGG_SIG_ME extra data');
  const signatures: Signature[] = [];
  for (const { coinSpend, syntheticSk } of spends) {
    // A signature by any other key would be rejected by the network; fail here instead.
    const syntheticPk = publicKey(syntheticSk);
    if (!equalBytes(standardPuzzleHash(syntheticPk), coinSpend.coin.puzzleHash)) {
      throw new ChiaError('wrong_puzzle_hash', 'the synthetic secret key does not own this coin');
    }
    // The puzzle emits (AGG_SIG_ME synthetic_pk sha256tree(delegated_puzzle)); the network
    // appends the coin id and its extra data to the message before verifying.
    const message = new Uint8Array(96);
    message.set(delegatedPuzzleHash(coinSpend.solution), 0);
    message.set(coinId(coinSpend.coin), 32);
    message.set(network.aggSigMeExtraData, 64);
    signatures.push(signWithPublicKey(syntheticSk, syntheticPk, message));
  }
  return {
    coinSpends: spends.map(({ coinSpend }) => coinSpend),
    aggregatedSignature: aggregate(signatures),
  };
}

/**
 * The JSON body shape of Chia's `push_tx` (snake_case, 0x-prefixed hex, amounts as numbers).
 * JSON numbers are only exact up to 2^53 - 1 mojos (about 9007 XCH); a larger amount throws
 * `ChiaError('amount_out_of_range')` rather than being rounded.
 */
export function spendBundleToJson(bundle: SpendBundle): unknown {
  return {
    coin_spends: bundle.coinSpends.map(({ coin, puzzleReveal, solution }) => {
      checkAmount(coin.amount);
      if (coin.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ChiaError('amount_out_of_range', 'amount does not fit a JSON number exactly');
      }
      return {
        coin: {
          parent_coin_info: `0x${toHex(coin.parentCoinInfo)}`,
          puzzle_hash: `0x${toHex(coin.puzzleHash)}`,
          amount: Number(coin.amount),
        },
        puzzle_reveal: `0x${toHex(puzzleReveal)}`,
        solution: `0x${toHex(solution)}`,
      };
    }),
    aggregated_signature: `0x${toHex(bundle.aggregatedSignature)}`,
  };
}
