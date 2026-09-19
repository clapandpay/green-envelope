// SPDX-License-Identifier: AGPL-3.0-or-later
// The only module of this app that touches `@ge/chia`. Everything else takes a `SharesFn`.
import { deriveUnhardenedPublic, standardPuzzleHash, syntheticPublicKey } from '@ge/chia';

/** Puzzle hashes of shares `0..count-1`: the standard-transaction coin of each unhardened child of the envelope public key. Throws when the key is not a valid G1 point. */
export function sharePuzzleHashes(publicKey: Uint8Array, count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, index) =>
    standardPuzzleHash(syntheticPublicKey(deriveUnhardenedPublic(publicKey, index))),
  );
}
