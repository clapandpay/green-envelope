// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type Bytes,
  type Coin,
  concatBytes,
  deriveHardened,
  deriveUnhardened,
  encodeAddress,
  keyGen,
  type Network,
  type PublicKey,
  publicKey,
  type SecretKey,
  sha256,
  standardPuzzleHash,
  syntheticSecretKey,
} from '@ge/chia';
import { WalletError } from './errors';

/** The one address of an MVP wallet and the key that spends from it. */
export interface Account {
  syntheticSk: SecretKey;
  syntheticPk: PublicKey;
  puzzleHash: Bytes;
  address: string;
  /** Hardened child reserved for envelope secrets; never signs anything. */
  envelopeRoot: SecretKey;
}

// Chia's wallet path m/12381/8444/2/0, unhardened, as Sage and the reference wallet use it.
const WALLET_PATH = [12381, 8444, 2, 0] as const;
// A hardened sibling of the wallet branch: leaking an envelope secret reveals nothing about it.
const ENVELOPE_ROOT_PATH = [12381, 8444, 0xc1a9] as const;
const SECRET_TAG = new TextEncoder().encode('clapandpay:envelope-secret:v1');

/** Wallet keys and address from the keystore's 32-byte seed. */
export function accountFromSeed(seed: Bytes, network: Network): Account {
  const master = keyGen(seed);
  const walletSk = WALLET_PATH.reduce<SecretKey>(deriveUnhardened, master);
  const syntheticSk = syntheticSecretKey(walletSk);
  const syntheticPk = publicKey(syntheticSk);
  const puzzleHash = standardPuzzleHash(syntheticPk);
  return {
    syntheticSk,
    syntheticPk,
    puzzleHash,
    address: encodeAddress(puzzleHash, network.addressPrefix),
    envelopeRoot: ENVELOPE_ROOT_PATH.reduce<SecretKey>(deriveHardened, master),
  };
}

/**
 * The link secret of this wallet's envelope number `counter`. Derived, not random, so a sender
 * who lost their browser data can find and take back their envelopes again.
 */
export function envelopeSecret(account: Account, counter: number): Bytes {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) {
    throw new RangeError('counter must be an unsigned 32-bit integer');
  }
  const index = new Uint8Array(4);
  new DataView(index.buffer).setUint32(0, counter);
  return sha256(concatBytes(SECRET_TAG, account.envelopeRoot, index)).slice(0, 16);
}

/** Most coins one transaction will spend; keeps the transaction small and cheap. */
export const MAX_INPUTS = 50;

/**
 * Picks coins covering `target`, largest first so the transaction stays small.
 * Throws `WalletError('insufficient_funds')` when they cannot.
 */
export function selectCoins(coins: readonly Coin[], target: bigint): Coin[] {
  const sorted = [...coins].sort((a, b) =>
    a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0,
  );
  const picked: Coin[] = [];
  let total = 0n;
  for (const coin of sorted.slice(0, MAX_INPUTS)) {
    if (total >= target) break;
    picked.push(coin);
    total += coin.amount;
  }
  if (total < target) throw new WalletError('insufficient_funds');
  return picked;
}
