// SPDX-License-Identifier: AGPL-3.0-or-later
// The standard transaction: p2_delegated_puzzle_or_hidden_puzzle with the default hidden puzzle.
import type { Bytes } from './bytes';
import { concatBytes, fromHex, sha256 } from './bytes';
import { curryTreeHash } from './clvm';
import { ChiaError } from './errors';
import type { PublicKey, SecretKey } from './keys';
import { addToPublicKey, addToSecretKey, bytesToBigInt, GROUP_ORDER, publicKey } from './keys';

/** Serialized p2_delegated_puzzle_or_hidden_puzzle.clsp, from chia-puzzles 0.20.3 (227 bytes). */
export const STANDARD_MOD_HEX =
  'ff02ffff01ff02ffff03ff0bffff01ff02ffff03ffff09ff05ffff1dff0bffff1effff0bff0bffff02ff06ffff04ff02ffff04ff17ff8080808080808080ffff01ff02ff17ff2f80ffff01ff088080ff0180ffff01ff04ffff04ff04ffff04ff05ffff04ffff02ff06ffff04ff02ffff04ff17ff80808080ff80808080ffff02ff17ff2f808080ff0180ffff04ffff01ff32ff02ffff03ffff07ff0580ffff01ff0bffff0102ffff02ff06ffff04ff02ffff04ff09ff80808080ffff02ff06ffff04ff02ffff04ff0dff8080808080ffff01ff0bffff0101ff058080ff0180ff018080';

/** Tree hash of the mod above; a test asserts that it really is. */
export const STANDARD_MOD_HASH_HEX =
  'e9aaa49f45bad5c889b86ee3341550c155cfdd10c3a6757de618d20612fffd52';

/** Tree hash of the default hidden puzzle `(=)`, which can never be run successfully. */
export const DEFAULT_HIDDEN_PUZZLE_HASH_HEX =
  '711d6c4e32c92e53179b199484cf8c897542bc57f2b22582799f9d657eec4699';

// Decoded on first use and kept: importing this module does no work.
let constants: { modHash: Bytes; hiddenPuzzleHash: Bytes; revealHead: Bytes } | undefined;

function getConstants(): { modHash: Bytes; hiddenPuzzleHash: Bytes; revealHead: Bytes } {
  if (constants === undefined) {
    constants = {
      modHash: fromHex(STANDARD_MOD_HASH_HEX),
      hiddenPuzzleHash: fromHex(DEFAULT_HIDDEN_PUZZLE_HASH_HEX),
      // (a (q . MOD) (c (q . PK) 1)) up to the point where the public key atom goes:
      // ff 02 ff [ff 01 MOD] ff [ff 04 ff [ff 01 <b0 PK>] ff 01 80] 80
      revealHead: concatBytes(
        fromHex('ff02ffff01'),
        fromHex(STANDARD_MOD_HEX),
        fromHex('ffff04ffff01b0'),
      ),
    };
  }
  return constants;
}

const ATOM_PREFIX = /* @__PURE__ */ Uint8Array.of(1);
const REVEAL_TAIL = /* @__PURE__ */ Uint8Array.of(0xff, 0x01, 0x80, 0x80);

function syntheticOffset(pk: PublicKey): bigint {
  if (pk.length !== 48) throw new ChiaError('bad_key', 'public key must be 48 bytes');
  // The digest is read as a signed big-endian integer, then reduced into [0, r).
  const digest = sha256(pk, getConstants().hiddenPuzzleHash);
  let value = bytesToBigInt(digest);
  if (((digest[0] ?? 0) & 0x80) !== 0) value -= 1n << 256n;
  return ((value % GROUP_ORDER) + GROUP_ORDER) % GROUP_ORDER;
}

/** `sk + offset(pk)`: the key that signs standard-transaction spends. */
export function syntheticSecretKey(sk: SecretKey): SecretKey {
  return addToSecretKey(sk, syntheticOffset(publicKey(sk)));
}

/** `pk + G1 * offset(pk)`: the key curried into the standard puzzle. */
export function syntheticPublicKey(pk: PublicKey): PublicKey {
  return addToPublicKey(pk, syntheticOffset(pk));
}

/** Puzzle hash of the standard puzzle for `syntheticPk`, by the curry tree-hash shortcut. */
export function standardPuzzleHash(syntheticPk: PublicKey): Bytes {
  if (syntheticPk.length !== 48) throw new ChiaError('bad_key', 'public key must be 48 bytes');
  return curryTreeHash(getConstants().modHash, sha256(ATOM_PREFIX, syntheticPk));
}

/** Serialized standard puzzle with `syntheticPk` curried in (the `puzzle_reveal` of a spend). */
export function standardPuzzleReveal(syntheticPk: PublicKey): Bytes {
  if (syntheticPk.length !== 48) throw new ChiaError('bad_key', 'public key must be 48 bytes');
  return concatBytes(getConstants().revealHead, syntheticPk, REVEAL_TAIL);
}
