// SPDX-License-Identifier: AGPL-3.0-or-later
// Test helper: typed access to vectors.json, the golden vectors written by tools/vectors (Rust).
import { readFileSync } from 'node:fs';
import type { Bytes } from './bytes';
import { concatBytes, fromHex } from './bytes';
import type { Clvm } from './clvm';
import { deserialize, treeHash } from './clvm';
import type { Coin } from './coin';
import { coinId } from './coin';
import type { Network } from './network';

/** A CLVM value in vectors.json: hex atom, `[first, rest]` pair, or a described large atom. */
export type TreeJson = string | [TreeJson, TreeJson] | { atom_len: number; fill: string };

/** A derived key at one index. */
export interface ChildVector {
  index: number;
  sk: string;
  pk: string;
}

/** Everything derived from one seed. */
export interface KeyVector {
  seed: string;
  master_sk: string;
  master_pk: string;
  hardened: ChildVector[];
  unhardened: ChildVector[];
  wallet: {
    index: number;
    unhardened_sk: string;
    unhardened_pk: string;
    hardened_sk: string;
    puzzle_hash: string;
  }[];
  synthetic_sk: string;
  synthetic_pk: string;
  puzzle_hash: string;
  puzzle_reveal: string;
  address_xch: string;
  address_txch: string;
}

/** A coin with amounts as decimal strings (they exceed the safe integer range). */
export interface CoinVector {
  parent_coin_info: string;
  puzzle_hash: string;
  amount: string;
  coin_id?: string;
}

/** A condition as the Rust generator describes it. */
export type ConditionVector =
  | { kind: 'createCoin'; puzzle_hash: string; amount: string; memos?: string[] }
  | { kind: 'reserveFee'; amount: string }
  | { kind: 'assertConcurrentSpend'; coin_id: string }
  | { kind: 'assertBeforeSecondsAbsolute'; seconds: string };

/** One signed golden spend bundle for one network. */
export interface SpendBundleVector {
  name: string;
  network: 'mainnet' | 'testnet11';
  agg_sig_me_extra_data: string;
  inputs: {
    seed: string;
    unhardened_path: number[];
    synthetic_sk: string;
    synthetic_pk: string;
    coin: CoinVector;
    conditions: ConditionVector[];
  }[];
  signed_messages: { pk: string; message: string }[];
  spend_bundle: unknown;
}

/** The whole vectors.json. */
export interface Vectors {
  constants: {
    mainnet_genesis_challenge: string;
    mainnet_agg_sig_me_extra_data: string;
    testnet11_genesis_challenge: string;
    testnet11_agg_sig_me_extra_data: string;
    default_hidden_puzzle_hash: string;
    standard_mod_reveal: string;
    standard_mod_hash: string;
  };
  keys: KeyVector[];
  coins: Required<CoinVector>[];
  signatures: {
    single: { sk: string; pk: string; message: string; signature: string }[];
    aggregate: { parts: { pk: string; message: string; signature: string }[]; signature: string };
    empty_aggregate: string;
  };
  clvm: {
    name: string;
    tree: TreeJson;
    serialized: string | { sha256: string; len: number };
    tree_hash: string;
  }[];
  int_atoms: { value: string; atom: string }[];
  spend_bundles: SpendBundleVector[];
}

/** Loads vectors.json from next to this file. */
export function loadVectors(): Vectors {
  return JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8')) as Vectors;
}

/** Turns the JSON form of a CLVM value into a `Clvm`. */
export function treeFromJson(tree: TreeJson): Clvm {
  if (typeof tree === 'string') return fromHex(tree);
  if (Array.isArray(tree)) return [treeFromJson(tree[0]), treeFromJson(tree[1])];
  return new Uint8Array(tree.atom_len).fill(Number.parseInt(tree.fill, 16));
}

/** The AGG_SIG_ME message of a standard spend, recomputed from its serialized solution. */
export function aggSigMeMessage(coin: Coin, solution: Bytes, network: Network): Bytes {
  const parsed = deserialize(solution);
  const rest = parsed instanceof Uint8Array ? undefined : parsed[1];
  if (rest === undefined || rest instanceof Uint8Array) throw new Error('not a standard solution');
  return concatBytes(treeHash(rest[0]), coinId(coin), network.aggSigMeExtraData);
}
