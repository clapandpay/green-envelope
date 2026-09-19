// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromHex, sha256, toHex } from './bytes';
import type { Clvm } from './clvm';
import { curryTreeHash, deserialize, intAtom, list, NIL, serialize, treeHash } from './clvm';
import { ChiaError } from './errors';
import { loadVectors, treeFromJson } from './test-vectors';

const vectors = loadVectors();

const clvmArb: fc.Arbitrary<Clvm> = fc.letrec<{ node: Clvm }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.uint8Array({ maxLength: 70 }),
    fc.tuple(tie('node'), tie('node')),
  ),
})).node;

/** Decodes a CLVM integer atom, the inverse of intAtom, for the round-trip property. */
function atomToInt(atom: Uint8Array): bigint {
  if (atom.length === 0) return 0n;
  return BigInt.asIntN(8 * atom.length, BigInt(`0x${toHex(atom)}`));
}

describe('golden vectors', () => {
  it.each(vectors.clvm)('serialize and treeHash: $name', ({ tree, serialized, tree_hash }) => {
    const value = treeFromJson(tree);
    const bytes = serialize(value);
    if (typeof serialized === 'string') {
      expect(toHex(bytes)).toBe(serialized);
    } else {
      expect(bytes.length).toBe(serialized.len);
      expect(toHex(sha256(bytes))).toBe(serialized.sha256);
    }
    expect(toHex(treeHash(value))).toBe(tree_hash);
    expect(deserialize(bytes)).toEqual(value);
  });

  it(`intAtom: ${vectors.int_atoms.length} integers`, () => {
    expect(vectors.int_atoms.length).toBeGreaterThan(100);
    for (const { value, atom } of vectors.int_atoms) {
      expect(toHex(intAtom(BigInt(value))), value).toBe(atom);
    }
  });
});

describe('intAtom', () => {
  it('encodes boundaries minimally', () => {
    expect(intAtom(0)).toBe(NIL);
    expect(toHex(intAtom(1))).toBe('01');
    expect(toHex(intAtom(127))).toBe('7f');
    expect(toHex(intAtom(128))).toBe('0080');
    expect(toHex(intAtom(255))).toBe('00ff');
    expect(toHex(intAtom(256))).toBe('0100');
    expect(toHex(intAtom(-1))).toBe('ff');
    expect(toHex(intAtom(-128))).toBe('80');
    expect(toHex(intAtom(-129))).toBe('ff7f');
    expect(toHex(intAtom(2n ** 63n))).toBe('008000000000000000');
  });

  it('accepts numbers and bigints alike', () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), (n) => {
        expect(intAtom(n)).toEqual(intAtom(BigInt(n)));
      }),
    );
  });

  it('rejects unsafe and fractional numbers', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => intAtom(bad)).toThrowError(ChiaError);
    }
  });

  it('round-trips and is minimal', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 300n), max: 2n ** 300n }), (n) => {
        const atom = intAtom(n);
        expect(atomToInt(atom)).toBe(n);
        if (atom.length > 1) {
          // No redundant sign byte: dropping the first byte must change the value.
          expect(atomToInt(atom.subarray(1))).not.toBe(n);
        }
      }),
    );
  });
});

describe('list', () => {
  it('builds nil-terminated pairs', () => {
    const a = Uint8Array.of(1);
    const b = Uint8Array.of(2);
    expect(list()).toBe(NIL);
    expect(list(a, b)).toEqual([a, [b, NIL]]);
  });
});

describe('serialize / deserialize / treeHash', () => {
  it('round-trips arbitrary trees', () => {
    fc.assert(
      fc.property(clvmArb, (v) => {
        expect(deserialize(serialize(v))).toEqual(v);
      }),
    );
  });

  it('tree hash follows the definition', () => {
    fc.assert(
      fc.property(clvmArb, clvmArb, (a, b) => {
        expect(treeHash([a, b])).toEqual(sha256(Uint8Array.of(2), treeHash(a), treeHash(b)));
      }),
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100 }), (atom) => {
        expect(treeHash(atom)).toEqual(sha256(Uint8Array.of(1), atom));
      }),
    );
  });

  it('serialization of a pair is ff || first || rest', () => {
    fc.assert(
      fc.property(clvmArb, clvmArb, (a, b) => {
        const expected = toHex(Uint8Array.of(0xff)) + toHex(serialize(a)) + toHex(serialize(b));
        expect(toHex(serialize([a, b]))).toBe(expected);
      }),
    );
  });

  it('distinct trees have distinct serializations and hashes', () => {
    fc.assert(
      fc.property(clvmArb, clvmArb, (a, b) => {
        const same = toHex(serialize(a)) === toHex(serialize(b));
        expect(toHex(treeHash(a)) === toHex(treeHash(b))).toBe(same);
      }),
    );
  });

  it('handles very long lists and very deep trees without recursion', () => {
    const count = 200_000;
    let long: Clvm = NIL;
    let deep: Clvm = NIL;
    for (let i = 0; i < count; i++) {
      long = [Uint8Array.of(7), long];
      deep = [deep, NIL];
    }
    for (const tree of [long, deep]) {
      const bytes = serialize(tree);
      expect(bytes.length).toBe(2 * count + 1);
      expect(serialize(deserialize(bytes))).toEqual(bytes);
      expect(treeHash(tree).length).toBe(32);
    }
  });

  it.each([
    ['', 'empty input'],
    ['ff01', 'truncated pair'],
    ['85aabb', 'truncated atom'],
    ['c0', 'truncated length'],
    ['0102', 'trailing bytes'],
    ['fe01', 'back-reference'],
    ['8101', 'non-minimal single byte'],
    ['c001aa', 'non-minimal two-byte length'],
    ['fc', 'invalid prefix'],
  ])('deserialize rejects %s (%s)', (hex) => {
    expect(() => deserialize(fromHex(hex))).toThrowError(ChiaError);
  });
});

describe('curryTreeHash', () => {
  it('equals the tree hash of the curried program built as data', () => {
    const atom32 = fc.uint8Array({ minLength: 32, maxLength: 32 });
    fc.assert(
      fc.property(clvmArb, fc.array(clvmArb, { maxLength: 4 }), (mod, args) => {
        // (a (q . mod) (c (q . arg1) (c (q . arg2) 1)))
        const one = Uint8Array.of(1);
        let env: Clvm = one;
        for (const arg of [...args].reverse()) env = list(Uint8Array.of(4), [one, arg], env);
        const curried = list(Uint8Array.of(2), [one, mod], env);
        expect(curryTreeHash(treeHash(mod), ...args.map(treeHash))).toEqual(treeHash(curried));
      }),
    );
    fc.assert(
      fc.property(atom32, (h) => {
        expect(curryTreeHash(h).length).toBe(32);
      }),
      { numRuns: 5 },
    );
  });

  it('rejects hashes of the wrong length', () => {
    const ok = new Uint8Array(32);
    expect(() => curryTreeHash(new Uint8Array(31))).toThrowError(ChiaError);
    expect(() => curryTreeHash(ok, new Uint8Array(33))).toThrowError(ChiaError);
  });
});
