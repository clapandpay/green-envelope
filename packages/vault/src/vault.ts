// SPDX-License-Identifier: AGPL-3.0-or-later
// Building vault spends. Nothing here holds or sees a private key: a builder returns the
// 32-byte challenge, the passkey signs it (one face or finger), and `finish` puts the passkey's
// answer into the bundle. The chain checks that answer with `secp256r1_verify`.
import type { Bytes, Clvm, Coin, CoinSpend, Condition, SpendBundle } from '@ge/chia';
import {
  aggregate,
  coinId,
  conditionToClvm,
  equalBytes,
  intAtom,
  list,
  NIL,
  serialize,
  sha256,
  toBase64Url,
  treeHash,
} from '@ge/chia';
import { VaultError } from './errors';
import { PUBLIC_KEY_BYTES, SIGNATURE_BYTES, verifyPrehashed } from './p256';
import {
  custodyHash,
  custodyPuzzle,
  getMods,
  moneyPuzzle,
  moneyPuzzleHash,
  passkeyMemberHash,
  vaultPuzzle,
  vaultPuzzleHash,
} from './puzzles';

/** Every vault coin and launcher is hinted with `sha256(HINT_TAG || public key)`. */
export const HINT_TAG = 'clapandpay:vault:v1';

/** A vault coin is always 1 mojo. */
export const VAULT_AMOUNT = 1n;

/** SEND_MESSAGE mode: the vault's puzzle sends, the money coin (by id) receives. */
const PUZZLE_TO_COIN = 0x17;

const QUOTE = /* @__PURE__ */ Uint8Array.of(1);
const CHIP_0043 = /* @__PURE__ */ new TextEncoder().encode('CHIP-0043');

/** What one passkey `get()` returns, with the signature already converted to raw `r || s`. */
export interface Assertion {
  authenticatorData: Bytes;
  clientDataJSON: Bytes;
  signature: Bytes;
}

/** How the singleton proves its parent was the vault (or, for the first one, the launcher). */
export type LineageProof =
  | { kind: 'eve'; parentParentCoinInfo: Bytes; parentAmount: bigint }
  | {
      kind: 'child';
      parentParentCoinInfo: Bytes;
      parentInnerPuzzleHash: Bytes;
      parentAmount: bigint;
    };

/** The vault's current coin, and what spending it needs besides the passkey. */
export interface VaultCoin {
  coin: Coin;
  launcherId: Bytes;
  publicKey: Bytes;
  lineage: LineageProof;
}

/** A spend waiting for the passkey: sign `challenge`, then `finish` with the answer. */
export interface Unsigned<T = undefined> {
  challenge: Bytes;
  finish(assertion: Assertion): SpendBundle;
  /** Whatever the spend leaves behind that the caller needs next (the vault's next coin). */
  next: T;
}

/** A payment out of the wallet: an address and an amount, hinted to its receiver. */
export interface Output {
  puzzleHash: Bytes;
  amount: bigint;
}

/** `sha256(HINT_TAG || publicKey)`: how a wallet finds its vault from its public key alone. */
export function vaultHint(publicKey: Bytes): Bytes {
  checkKey(publicKey);
  return sha256(new TextEncoder().encode(HINT_TAG), publicKey);
}

/** The wallet's address before it has a vault: the passkey alone (`custodyPuzzle` as a coin). */
export function setupPuzzleHash(publicKey: Bytes): Bytes {
  checkKey(publicKey);
  return custodyHash(publicKey);
}

function checkKey(publicKey: Bytes): void {
  if (publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new VaultError('bad_key', 'a passkey public key is 33 bytes, compressed');
  }
}

/** `"challenge":"<base64url>"` as the browser writes it into clientDataJSON. */
function challengeNeedle(challenge: Bytes): Bytes {
  return new TextEncoder().encode(`"challenge":"${toBase64Url(challenge)}"`);
}

function indexOf(haystack: Bytes, needle: Bytes): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * The passkey member's solution for `coin`: refuses an answer that does not sign `challenge`
 * with `publicKey`, so a wrong prompt fails here and never reaches the network.
 */
function passkeySolution(
  publicKey: Bytes,
  challenge: Bytes,
  coin: Bytes,
  assertion: Assertion,
): Clvm[] {
  const { authenticatorData, clientDataJSON, signature } = assertion;
  if (signature.length !== SIGNATURE_BYTES) {
    throw new VaultError('bad_signature', 'a passkey signature here is 64 bytes, r || s');
  }
  const at = indexOf(clientDataJSON, challengeNeedle(challenge));
  if (at < 0) throw new VaultError('bad_assertion', 'the passkey signed another challenge');
  const signed = sha256(authenticatorData, sha256(clientDataJSON));
  if (!verifyPrehashed(publicKey, signed, signature)) {
    throw new VaultError('bad_assertion', 'the signature is not this passkey’s');
  }
  return [authenticatorData, clientDataJSON, intAtom(at), signature, coin];
}

/** `(q . conditions)`, the delegated puzzle every spend here runs. */
function delegated(conditions: Condition[]): Clvm {
  return [QUOTE, list(...conditions.map(conditionToClvm))];
}

/** The MIPS solution: `(delegated_puzzle delegated_solution . member_solution)`. */
function mipsSolution(delegatedPuzzle: Clvm, member: Clvm[]): Clvm {
  return list(delegatedPuzzle, NIL, ...member);
}

function lineageClvm(proof: LineageProof): Clvm {
  return proof.kind === 'eve'
    ? list(proof.parentParentCoinInfo, intAtom(proof.parentAmount))
    : list(proof.parentParentCoinInfo, proof.parentInnerPuzzleHash, intAtom(proof.parentAmount));
}

function bundle(coinSpends: CoinSpend[]): SpendBundle {
  // No BLS signature anywhere: the passkey's signature is in a solution.
  return { coinSpends, aggregatedSignature: aggregate([]) };
}

/** What a launch adds to the spend of the coin that pays for it. */
export interface Launch {
  /** For the paying coin: make the launcher (hinted) and assert its announcement. */
  conditions: Condition[];
  /** The launcher's own spend, which goes into the same bundle. */
  launcherSpend: CoinSpend;
  launcherId: Bytes;
  /** The wallet's address from now on. */
  moneyPuzzleHash: Bytes;
  /** The vault's first coin, once the bundle lands. */
  vault: VaultCoin;
}

/**
 * Launches a vault from any coin (`parentCoinId`) that can output conditions: an envelope share
 * on the first claim, or a coin at the setup address. Needs no signature of its own; the vault
 * coin costs 1 mojo, which the paying coin provides.
 *
 * The launcher carries the CHIP-0043 memo (passkey member, public key revealed), so tools that
 * read vault memos recognize it, and every coin is hinted with `vaultHint`.
 */
export function launchVault(parentCoinId: Bytes, publicKey: Bytes): Launch {
  checkKey(publicKey);
  const m = getMods();
  const hint = vaultHint(publicKey);
  const launcherCoin: Coin = {
    parentCoinInfo: parentCoinId,
    puzzleHash: m.launcherHash,
    amount: VAULT_AMOUNT,
  };
  const launcherId = coinId(launcherCoin);
  const custody = custodyHash(publicKey);
  const fullPuzzleHash = vaultPuzzleHash(launcherId, custody);
  const memo = list(CHIP_0043, list(NIL, NIL, NIL, list(passkeyMemberHash(publicKey), publicKey)));
  const solution = list(fullPuzzleHash, intAtom(VAULT_AMOUNT), memo);
  const announcementId = sha256(launcherId, treeHash(solution));
  return {
    conditions: [
      { kind: 'createCoin', puzzleHash: m.launcherHash, amount: VAULT_AMOUNT, memos: [hint] },
      { kind: 'assertCoinAnnouncement', announcementId },
    ],
    launcherSpend: { coin: launcherCoin, puzzleReveal: m.launcher, solution: serialize(solution) },
    launcherId,
    moneyPuzzleHash: moneyPuzzleHash(launcherId),
    vault: {
      coin: { parentCoinInfo: launcherId, puzzleHash: fullPuzzleHash, amount: VAULT_AMOUNT },
      launcherId,
      publicKey,
      lineage: { kind: 'eve', parentParentCoinInfo: parentCoinId, parentAmount: VAULT_AMOUNT },
    },
  };
}

/**
 * Spends a coin at the setup address (money that arrived before the vault existed), with one
 * prompt for this coin. `alsoSpend` joins the bundle unchanged (the launcher's spend).
 */
export function buildSetupSpend(args: {
  publicKey: Bytes;
  coin: Coin;
  conditions: Condition[];
  alsoSpend?: CoinSpend[];
}): Unsigned {
  const { publicKey, coin, conditions } = args;
  if (!equalBytes(coin.puzzleHash, setupPuzzleHash(publicKey))) {
    throw new VaultError('wrong_coin', 'this coin is not at the setup address of this passkey');
  }
  const puzzle = delegated(conditions);
  const id = coinId(coin);
  const challenge = sha256(treeHash(puzzle), id);
  return {
    challenge,
    next: undefined,
    finish(assertion) {
      const member = passkeySolution(publicKey, challenge, id, assertion);
      const spend: CoinSpend = {
        coin,
        puzzleReveal: serialize(custodyPuzzle(publicKey)),
        solution: serialize(mipsSolution(puzzle, member)),
      };
      return bundle([...(args.alsoSpend ?? []), spend]);
    },
  };
}

/**
 * One prompt spends the vault and every coin in `money`: the first money coin pays `outputs`,
 * the change (back to the wallet's address) and the fee; the others are only released. The
 * vault sends each money coin a message naming exactly what that coin may do, and recreates
 * itself. `next` is the vault's coin after this spend.
 */
export function buildVaultSpend(args: {
  vault: VaultCoin;
  money: Coin[];
  outputs: Output[];
  fee: bigint;
}): Unsigned<VaultCoin> {
  const { vault, money, outputs, fee } = args;
  const { launcherId, publicKey } = vault;
  checkKey(publicKey);
  const custody = custodyHash(publicKey);
  if (!equalBytes(vault.coin.puzzleHash, vaultPuzzleHash(launcherId, custody))) {
    throw new VaultError('wrong_coin', 'this coin is not the vault of this passkey');
  }
  const address = moneyPuzzleHash(launcherId);
  if (money.length === 0) throw new VaultError('no_coins', 'nothing to spend');
  for (const coin of money) {
    if (!equalBytes(coin.puzzleHash, address)) {
      throw new VaultError('wrong_coin', 'a coin that is not at this wallet’s address');
    }
  }
  const total = money.reduce((sum, coin) => sum + coin.amount, 0n);
  const paid = outputs.reduce((sum, output) => sum + output.amount, 0n);
  if (fee < 0n || paid + fee > total) {
    throw new VaultError('insufficient_funds', 'the coins do not cover the outputs and the fee');
  }
  const change = total - paid - fee;

  const first: Condition[] = outputs.map((output) => ({
    kind: 'createCoin',
    puzzleHash: output.puzzleHash,
    amount: output.amount,
    memos: [output.puzzleHash],
  }));
  if (change > 0n) {
    first.push({ kind: 'createCoin', puzzleHash: address, amount: change, memos: [address] });
  }
  if (fee > 0n) first.push({ kind: 'reserveFee', amount: fee });

  const vaultConditions: Condition[] = [];
  const moneySpends: CoinSpend[] = [];
  const reveal = serialize(moneyPuzzle(launcherId));
  money.forEach((coin, i) => {
    const puzzle = delegated(i === 0 ? first : []);
    vaultConditions.push({
      kind: 'sendMessage',
      mode: PUZZLE_TO_COIN,
      message: treeHash(puzzle),
      receiverCoinId: coinId(coin),
    });
    moneySpends.push({
      coin,
      puzzleReveal: reveal,
      solution: serialize(mipsSolution(puzzle, [custody, intAtom(VAULT_AMOUNT)])),
    });
  });
  vaultConditions.push({
    kind: 'createCoin',
    puzzleHash: custody,
    amount: VAULT_AMOUNT,
    memos: [vaultHint(publicKey)],
  });

  const puzzle = delegated(vaultConditions);
  const vaultId = coinId(vault.coin);
  const challenge = sha256(treeHash(puzzle), vaultId);
  return {
    challenge,
    next: {
      coin: { parentCoinInfo: vaultId, puzzleHash: vault.coin.puzzleHash, amount: VAULT_AMOUNT },
      launcherId,
      publicKey,
      lineage: {
        kind: 'child',
        parentParentCoinInfo: vault.coin.parentCoinInfo,
        parentInnerPuzzleHash: custody,
        parentAmount: vault.coin.amount,
      },
    },
    finish(assertion) {
      const member = passkeySolution(publicKey, challenge, vaultId, assertion);
      const solution = list(
        lineageClvm(vault.lineage),
        intAtom(vault.coin.amount),
        mipsSolution(puzzle, member),
      );
      const spend: CoinSpend = {
        coin: vault.coin,
        puzzleReveal: serialize(vaultPuzzle(launcherId, publicKey)),
        solution: serialize(solution),
      };
      return bundle([...moneySpends, spend]);
    },
  };
}
