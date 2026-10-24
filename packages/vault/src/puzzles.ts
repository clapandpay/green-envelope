// SPDX-License-Identifier: AGPL-3.0-or-later
// The vault's puzzles as CLVM, and their hashes from hashes alone (the curry shortcut).
//
//   custody (the vault's inner puzzle, and the setup address)
//     = index_wrapper(0, delegated_puzzle_feeder(passkey_member(PK)))
//   money address (where the wallet's coins live)
//     = index_wrapper(0, delegated_puzzle_feeder(singleton_member(SINGLETON_STRUCT)))
//   vault coin
//     = singleton_top_layer_v1_1(SINGLETON_STRUCT, custody)
//
// This is `mips_puzzle_hash(0, [], member, true)` of chia-sdk-driver, and the p2 shape its
// vaults use. Every hash is checked against chia-wallet-sdk in `puzzles.test.ts`.
import type { Bytes, Clvm } from '@ge/chia';
import { curryTreeHash, deserialize, fromHex, list, NIL, treeHash } from '@ge/chia';
import * as raw from './puzzle-bytes';

interface Mods {
  top: Clvm;
  topHash: Bytes;
  launcher: Bytes;
  launcherHash: Bytes;
  index: Clvm;
  indexHash: Bytes;
  feeder: Clvm;
  feederHash: Bytes;
  passkeyMember: Clvm;
  passkeyMemberHash: Bytes;
  singletonMember: Clvm;
  singletonMemberHash: Bytes;
}

// Decoded on first use: importing this module does no work.
let mods: Mods | undefined;

/** The puzzles, decoded once. */
export function getMods(): Mods {
  mods ??= {
    top: deserialize(fromHex(raw.SINGLETON_TOP_LAYER_HEX)),
    topHash: fromHex(raw.SINGLETON_TOP_LAYER_HASH_HEX),
    launcher: fromHex(raw.SINGLETON_LAUNCHER_HEX),
    launcherHash: fromHex(raw.SINGLETON_LAUNCHER_HASH_HEX),
    index: deserialize(fromHex(raw.INDEX_WRAPPER_HEX)),
    indexHash: fromHex(raw.INDEX_WRAPPER_HASH_HEX),
    feeder: deserialize(fromHex(raw.DELEGATED_PUZZLE_FEEDER_HEX)),
    feederHash: fromHex(raw.DELEGATED_PUZZLE_FEEDER_HASH_HEX),
    passkeyMember: deserialize(fromHex(raw.PASSKEY_MEMBER_HEX)),
    passkeyMemberHash: fromHex(raw.PASSKEY_MEMBER_HASH_HEX),
    singletonMember: deserialize(fromHex(raw.SINGLETON_MEMBER_HEX)),
    singletonMemberHash: fromHex(raw.SINGLETON_MEMBER_HASH_HEX),
  };
  return mods;
}

const QUOTE = /* @__PURE__ */ Uint8Array.of(1);
const APPLY = /* @__PURE__ */ Uint8Array.of(2);
const CONS = /* @__PURE__ */ Uint8Array.of(4);

/** `(a (q . mod) (c (q . arg1) (c (q . arg2) ... 1)))`: what `curryTreeHash` hashes. */
export function curry(mod: Clvm, ...args: Clvm[]): Clvm {
  let env: Clvm = QUOTE; // the environment reference `1`
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (arg !== undefined) env = list(CONS, [QUOTE, arg], env);
  }
  return list(APPLY, [QUOTE, mod], env);
}

/** `(SINGLETON_MOD_HASH . (LAUNCHER_ID . LAUNCHER_PUZZLE_HASH))`. */
export function singletonStruct(launcherId: Bytes): Clvm {
  const m = getMods();
  return [m.topHash, [launcherId, m.launcherHash]];
}

/** A member wrapped as a top-level MIPS puzzle with nonce 0 and no restrictions. */
function mipsPuzzle(member: Clvm): Clvm {
  const m = getMods();
  return curry(m.index, NIL, curry(m.feeder, member));
}

function mipsHash(memberHash: Bytes): Bytes {
  const m = getMods();
  return curryTreeHash(m.indexHash, treeHash(NIL), curryTreeHash(m.feederHash, memberHash));
}

/** Tree hash of `passkey_member(PK)`: what the CHIP-0043 memo names. */
export function passkeyMemberHash(publicKey: Bytes): Bytes {
  return curryTreeHash(getMods().passkeyMemberHash, treeHash(publicKey));
}

/** The custody puzzle: the vault's inner puzzle, and the setup address before there is a vault. */
export function custodyPuzzle(publicKey: Bytes): Clvm {
  return mipsPuzzle(curry(getMods().passkeyMember, publicKey));
}

/** Tree hash of `custodyPuzzle(publicKey)`. */
export function custodyHash(publicKey: Bytes): Bytes {
  return mipsHash(passkeyMemberHash(publicKey));
}

/** The money puzzle: coins only this vault can release. */
export function moneyPuzzle(launcherId: Bytes): Clvm {
  return mipsPuzzle(curry(getMods().singletonMember, singletonStruct(launcherId)));
}

/** Tree hash of `moneyPuzzle(launcherId)`: the wallet's address. */
export function moneyPuzzleHash(launcherId: Bytes): Bytes {
  const m = getMods();
  return mipsHash(curryTreeHash(m.singletonMemberHash, treeHash(singletonStruct(launcherId))));
}

/** The vault coin's full puzzle. */
export function vaultPuzzle(launcherId: Bytes, publicKey: Bytes): Clvm {
  return curry(getMods().top, singletonStruct(launcherId), custodyPuzzle(publicKey));
}

/** Tree hash of the vault coin's puzzle, from the custody hash. */
export function vaultPuzzleHash(launcherId: Bytes, custody: Bytes): Bytes {
  const m = getMods();
  return curryTreeHash(m.topHash, treeHash(singletonStruct(launcherId)), custody);
}
