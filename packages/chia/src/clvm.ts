// SPDX-License-Identifier: AGPL-3.0-or-later
// CLVM as data: atoms, pairs, serialization and tree hashes. There is no interpreter here.
import type { Bytes } from './bytes';
import { sha256 } from './bytes';
import { ChiaError } from './errors';

/** A CLVM value: an atom (bytes) or a pair of values. */
export type Clvm = Bytes | readonly [Clvm, Clvm];

/** The empty atom, which is also the empty list. */
export const NIL: Bytes = /* @__PURE__ */ new Uint8Array(0);

const ATOM_PREFIX = /* @__PURE__ */ Uint8Array.of(1);
const PAIR_PREFIX = /* @__PURE__ */ Uint8Array.of(2);
const PAIR_MARKER = 0xff;
const BACK_REFERENCE = 0xfe;

function isAtom(v: Clvm): v is Bytes {
  return v instanceof Uint8Array;
}

/** CLVM integer encoding: minimal two's complement, big-endian; zero is the empty atom. */
export function intAtom(n: bigint | number): Bytes {
  let value: bigint;
  if (typeof n === 'bigint') {
    value = n;
  } else {
    if (!Number.isSafeInteger(n)) throw new ChiaError('bad_int', `not a safe integer: ${n}`);
    value = BigInt(n);
  }
  if (value === 0n) return NIL;

  // Smallest byte count whose signed range holds the value.
  let length = 1;
  if (value > 0n) {
    while (value >> BigInt(8 * length - 1) !== 0n) length++;
  } else {
    while (value >> BigInt(8 * length - 1) !== -1n) length++;
  }
  let rest = BigInt.asUintN(8 * length, value);
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** Builds the proper (nil-terminated) list of `items`. */
export function list(...items: Clvm[]): Clvm {
  let out: Clvm = NIL;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined) out = [item, out];
  }
  return out;
}

function atomHeaderLength(atom: Bytes): number {
  const n = atom.length;
  if (n === 0) return 1;
  if (n === 1 && (atom[0] ?? 0) < 0x80) return 0;
  if (n < 0x40) return 1;
  if (n < 0x2000) return 2;
  if (n < 0x10_0000) return 3;
  if (n < 0x800_0000) return 4;
  if (n < 0x4_0000_0000) return 5;
  throw new ChiaError('bad_clvm', 'atom too large to serialize');
}

function writeAtom(out: Bytes, offset: number, atom: Bytes): number {
  const n = atom.length;
  let at = offset;
  switch (atomHeaderLength(atom)) {
    case 0:
      break;
    case 1:
      out[at++] = 0x80 | n;
      break;
    case 2:
      out[at++] = 0xc0 | (n >> 8);
      out[at++] = n & 0xff;
      break;
    case 3:
      out[at++] = 0xe0 | (n >> 16);
      out[at++] = (n >> 8) & 0xff;
      out[at++] = n & 0xff;
      break;
    case 4:
      out[at++] = 0xf0 | (n >> 24);
      out[at++] = (n >> 16) & 0xff;
      out[at++] = (n >> 8) & 0xff;
      out[at++] = n & 0xff;
      break;
    default:
      out[at++] = 0xf8 | Math.floor(n / 0x1_0000_0000);
      out[at++] = (n >>> 24) & 0xff;
      out[at++] = (n >> 16) & 0xff;
      out[at++] = (n >> 8) & 0xff;
      out[at++] = n & 0xff;
  }
  out.set(atom, at);
  return at + n;
}

/** Canonical CLVM serialization (no back-references), iterative and with one allocation. */
export function serialize(v: Clvm): Bytes {
  // Pass 1: size. Pass 2: write. Both walk the tree with an explicit stack, so long lists and
  // deep trees cannot overflow the call stack.
  let size = 0;
  const stack: Clvm[] = [v];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isAtom(node)) {
      size += atomHeaderLength(node) + node.length;
    } else {
      size += 1;
      stack.push(node[1], node[0]);
    }
  }

  const out = new Uint8Array(size);
  let offset = 0;
  stack.push(v);
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isAtom(node)) {
      offset = writeAtom(out, offset, node);
    } else {
      out[offset++] = PAIR_MARKER;
      stack.push(node[1], node[0]);
    }
  }
  return out;
}

/** Parses canonical CLVM serialization; rejects back-references, overlong prefixes and trailing bytes. */
export function deserialize(bytes: Bytes): Clvm {
  let offset = 0;

  const readAtom = (first: number): Bytes => {
    if (first < 0x80) return Uint8Array.of(first);
    // The number of leading one bits is the header length; the remaining bits start the length.
    let headerLength = 0;
    for (let mask = 0x80; (first & mask) !== 0; mask >>= 1) headerLength++;
    if (headerLength > 5) throw new ChiaError('bad_clvm', 'bad atom length prefix');
    let length = first & (0xff >> (headerLength + 1));
    for (let i = 1; i < headerLength; i++) {
      const next = bytes[offset++];
      if (next === undefined) throw new ChiaError('bad_clvm', 'truncated atom length');
      length = length * 256 + next;
    }
    if (offset + length > bytes.length) throw new ChiaError('bad_clvm', 'truncated atom');
    const atom = bytes.slice(offset, offset + length);
    offset += length;
    if (atomHeaderLength(atom) !== headerLength) {
      throw new ChiaError('bad_clvm', 'atom length prefix is not minimal');
    }
    return atom;
  };

  // Shift-reduce: `open` remembers the value-stack height at which each unfinished pair began.
  const values: Clvm[] = [];
  const open: number[] = [];
  do {
    const first = bytes[offset++];
    if (first === undefined) throw new ChiaError('bad_clvm', 'truncated CLVM');
    if (first === BACK_REFERENCE) throw new ChiaError('bad_clvm', 'back-references not supported');
    if (first === PAIR_MARKER) {
      open.push(values.length);
      continue;
    }
    values.push(readAtom(first));
    // Close every pair whose two children are now on the value stack.
    while (open.length > 0 && values.length - (open[open.length - 1] ?? 0) === 2) {
      open.pop();
      const rest = values.pop();
      const head = values.pop();
      if (head === undefined || rest === undefined) throw new ChiaError('bad_clvm', 'bad CLVM');
      values.push([head, rest]);
    }
  } while (open.length > 0);

  const result = values[0];
  if (result === undefined || values.length !== 1 || offset !== bytes.length) {
    throw new ChiaError('bad_clvm', 'trailing bytes after CLVM value');
  }
  return result;
}

/** Tree hash: sha256(1 || atom) for atoms, sha256(2 || hash(first) || hash(rest)) for pairs. */
export function treeHash(v: Clvm): Bytes {
  if (isAtom(v)) return sha256(ATOM_PREFIX, v);

  // Post-order walk with an explicit stack. A pair is visited twice: first to schedule its
  // children, then (marked) to combine their hashes.
  const hashes: Bytes[] = [];
  const stack: { node: Clvm; visited: boolean }[] = [{ node: v, visited: false }];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const { node, visited } = top;
    if (isAtom(node)) {
      hashes.push(sha256(ATOM_PREFIX, node));
    } else if (visited) {
      const rest = hashes.pop();
      const first = hashes.pop();
      if (first === undefined || rest === undefined) throw new ChiaError('bad_clvm', 'bad tree');
      hashes.push(sha256(PAIR_PREFIX, first, rest));
    } else {
      stack.push(
        { node, visited: true },
        { node: node[1], visited: false },
        { node: node[0], visited: false },
      );
    }
  }
  const result = hashes[0];
  if (result === undefined) throw new ChiaError('bad_clvm', 'bad tree');
  return result;
}

// Tree hashes of the operator atoms used by `curry`, computed once on first use.
let curryConstants: { nil: Bytes; one: Bytes; apply: Bytes; cons: Bytes } | undefined;

function pairHash(first: Bytes, rest: Bytes): Bytes {
  return sha256(PAIR_PREFIX, first, rest);
}

/**
 * Tree hash of `mod` curried with arguments, from hashes alone: the hash of
 * `(a (q . mod) (c (q . arg1) (c (q . arg2) ... 1)))`. `argHashes` are the arguments' tree hashes.
 */
export function curryTreeHash(modHash: Bytes, ...argHashes: Bytes[]): Bytes {
  if (curryConstants === undefined) {
    const one = sha256(ATOM_PREFIX, Uint8Array.of(1));
    curryConstants = {
      nil: sha256(ATOM_PREFIX),
      one,
      apply: sha256(ATOM_PREFIX, Uint8Array.of(2)),
      cons: sha256(ATOM_PREFIX, Uint8Array.of(4)),
    };
  }
  const { nil, one, apply, cons } = curryConstants;

  let args = one; // the environment reference `1`
  for (let i = argHashes.length - 1; i >= 0; i--) {
    const arg = argHashes[i];
    if (arg === undefined) continue;
    if (arg.length !== 32) throw new ChiaError('bad_length', 'argument hash must be 32 bytes');
    // (c (q . arg) args)
    args = pairHash(cons, pairHash(pairHash(one, arg), pairHash(args, nil)));
  }
  if (modHash.length !== 32) throw new ChiaError('bad_length', 'mod hash must be 32 bytes');
  // (a (q . mod) args)
  return pairHash(apply, pairHash(pairHash(one, modHash), pairHash(args, nil)));
}
