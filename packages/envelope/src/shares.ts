// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type Bytes,
  deriveUnhardened,
  deriveUnhardenedPublic,
  keyGen,
  type PublicKey,
  publicKey,
  type SecretKey,
  standardPuzzleHash,
  syntheticPublicKey,
  syntheticSecretKey,
} from '@ge/chia';
import { envelopeSeed } from './seed';

/** The envelope's own key pair; the public half travels in the link path. */
export interface EnvelopeKeys {
  secretKey: SecretKey;
  publicKey: PublicKey;
}

/** Everything needed to spend share `index`. */
export interface ShareKey {
  index: number;
  syntheticSk: SecretKey;
  syntheticPk: PublicKey;
  puzzleHash: Bytes;
}

/** Envelope key pair from the 16-byte link secret. */
export function envelopeKeys(secret: Bytes): EnvelopeKeys {
  const secretKey = keyGen(envelopeSeed(secret));
  return { secretKey, publicKey: publicKey(secretKey) };
}

/** Signing key and address of share `index` (needs the secret). */
export function shareKey(envelopeSk: SecretKey, index: number): ShareKey {
  const syntheticSk = syntheticSecretKey(deriveUnhardened(envelopeSk, index));
  const syntheticPk = publicKey(syntheticSk);
  return { index, syntheticSk, syntheticPk, puzzleHash: standardPuzzleHash(syntheticPk) };
}

/** Address of share `index` from the public key alone: enough to watch a share, not to open it. */
export function sharePuzzleHash(envelopePk: PublicKey, index: number): Bytes {
  return standardPuzzleHash(syntheticPublicKey(deriveUnhardenedPublic(envelopePk, index)));
}

/** Addresses of shares `0..count-1`, in order. */
export function sharePuzzleHashes(envelopePk: PublicKey, count: number): Bytes[] {
  return Array.from({ length: count }, (_, index) => sharePuzzleHash(envelopePk, index));
}
