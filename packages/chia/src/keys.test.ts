// SPDX-License-Identifier: AGPL-3.0-or-later
import { bls12_381 } from '@noble/curves/bls12-381.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes';
import { ChiaError } from './errors';
import {
  aggregate,
  deriveHardened,
  deriveUnhardened,
  deriveUnhardenedPublic,
  GROUP_ORDER,
  keyGen,
  publicKey,
  sign,
  verify,
} from './keys';
import { loadVectors } from './test-vectors';

const vectors = loadVectors();
const seedArb = fc.uint8Array({ minLength: 32, maxLength: 64 });
const indexArb = fc.integer({ min: 0, max: 0xffff_ffff });
const INFINITY_SIGNATURE = `c0${'00'.repeat(95)}`;

describe('golden vectors: keys', () => {
  it('uses the right group order', () => {
    expect(GROUP_ORDER).toBe(bls12_381.fields.Fr.ORDER);
  });

  it('compresses G1 points exactly as noble does (which also checks the subgroup)', () => {
    const G1 = bls12_381.G1.Point;
    expect(toHex(publicKey(new Uint8Array(32)))).toBe(toHex(G1.ZERO.toBytes(true)));
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: GROUP_ORDER - 1n }), indexArb, (scalar, index) => {
        const sk = fromHex(scalar.toString(16).padStart(64, '0'));
        const pk = publicKey(sk);
        expect(toHex(pk)).toBe(toHex(G1.BASE.multiply(scalar).toBytes(true)));
        const child = deriveUnhardenedPublic(pk, index);
        expect(toHex(child)).toBe(toHex(G1.fromBytes(child).toBytes(true)));
      }),
      { numRuns: 40 },
    );
  });

  describe.each(vectors.keys)('seed $seed', (v) => {
    const masterSk = fromHex(v.master_sk);
    const masterPk = fromHex(v.master_pk);

    it('keyGen and publicKey', () => {
      expect(toHex(keyGen(fromHex(v.seed)))).toBe(v.master_sk);
      expect(toHex(publicKey(masterSk))).toBe(v.master_pk);
    });

    it.each(v.hardened)('hardened child $index', ({ index, sk, pk }) => {
      const child = deriveHardened(masterSk, index);
      expect(toHex(child)).toBe(sk);
      expect(toHex(publicKey(child))).toBe(pk);
    });

    it.each(v.unhardened)('unhardened child $index, both sides', ({ index, sk, pk }) => {
      const child = deriveUnhardened(masterSk, index);
      expect(toHex(child)).toBe(sk);
      expect(toHex(publicKey(child))).toBe(pk);
      expect(toHex(deriveUnhardenedPublic(masterPk, index))).toBe(pk);
    });

    it.each(v.wallet)('wallet path m/12381/8444/2/$index', (w) => {
      const path = [12381, 8444, 2, w.index];
      expect(toHex(path.reduce(deriveUnhardened, masterSk))).toBe(w.unhardened_sk);
      expect(toHex(path.reduce(deriveUnhardenedPublic, masterPk))).toBe(w.unhardened_pk);
      expect(toHex(path.reduce(deriveHardened, masterSk))).toBe(w.hardened_sk);
    });
  });
});

describe('golden vectors: signatures', () => {
  it.each(vectors.signatures.single)('sign and verify, message $message', (v) => {
    const message = fromHex(v.message);
    expect(toHex(sign(fromHex(v.sk), message))).toBe(v.signature);
    expect(verify(fromHex(v.pk), message, fromHex(v.signature))).toBe(true);
  });

  it('aggregate', () => {
    const { parts, signature } = vectors.signatures.aggregate;
    expect(toHex(aggregate(parts.map((p) => fromHex(p.signature))))).toBe(signature);
    expect(toHex(aggregate([]))).toBe(vectors.signatures.empty_aggregate);
    expect(vectors.signatures.empty_aggregate).toBe(INFINITY_SIGNATURE);
  });
});

describe('properties', () => {
  it('secret-side and public-side unhardened derivation agree', () => {
    fc.assert(
      fc.property(seedArb, indexArb, (seed, index) => {
        const sk = keyGen(seed);
        expect(publicKey(deriveUnhardened(sk, index))).toEqual(
          deriveUnhardenedPublic(publicKey(sk), index),
        );
      }),
      { numRuns: 25 },
    );
  });

  it('keys are canonical scalars and hardened children differ from unhardened ones', () => {
    fc.assert(
      fc.property(seedArb, indexArb, (seed, index) => {
        const sk = keyGen(seed);
        const hardened = deriveHardened(sk, index);
        expect(sk.length).toBe(32);
        expect(BigInt(`0x${toHex(sk)}`) < GROUP_ORDER).toBe(true);
        expect(BigInt(`0x${toHex(hardened)}`) < GROUP_ORDER).toBe(true);
        expect(hardened).not.toEqual(deriveUnhardened(sk, index));
      }),
      { numRuns: 10 },
    );
  });

  it('sign then verify; any other key, message or signature fails', () => {
    fc.assert(
      fc.property(seedArb, seedArb, fc.uint8Array({ maxLength: 200 }), (seedA, seedB, message) => {
        fc.pre(toHex(seedA) !== toHex(seedB));
        const sk = keyGen(seedA);
        const pk = publicKey(sk);
        const other = publicKey(keyGen(seedB));
        const sig = sign(sk, message);
        expect(sig.length).toBe(96);
        expect(verify(pk, message, sig)).toBe(true);
        expect(verify(other, message, sig)).toBe(false);
        expect(verify(pk, Uint8Array.of(...message, 0), sig)).toBe(false);
        expect(verify(pk, message, sign(sk, Uint8Array.of(...message, 1)))).toBe(false);
      }),
      { numRuns: 6 },
    );
  });

  it('an aggregate verifies as the product of pairings, and order does not matter', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(seedArb, fc.uint8Array({ maxLength: 64 })), {
          minLength: 1,
          maxLength: 4,
        }),
        (items) => {
          const signed = items.map(([seed, message]) => {
            const sk = keyGen(seed);
            return { pk: publicKey(sk), message, sig: sign(sk, message) };
          });
          const agg = aggregate(signed.map((s) => s.sig));
          expect(aggregate(signed.map((s) => s.sig).reverse())).toEqual(agg);

          // Reference check with noble's own batch verification over augmented messages.
          const long = bls12_381.longSignatures;
          const batch = signed.map((s) => ({
            publicKey: s.pk,
            message: long.hash(
              Uint8Array.of(...s.pk, ...s.message),
              'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_',
            ),
          }));
          expect(long.verifyBatch(agg, batch)).toBe(true);
          if (signed.length === 1 && signed[0] !== undefined) {
            expect(verify(signed[0].pk, signed[0].message, agg)).toBe(true);
          }
        },
      ),
      { numRuns: 4 },
    );
  });

  it('aggregating the same signature twice is not the signature', () => {
    const sk = keyGen(new Uint8Array(32).fill(9));
    const message = Uint8Array.of(1, 2, 3);
    const sig = sign(sk, message);
    expect(verify(publicKey(sk), message, aggregate([sig, sig]))).toBe(false);
    expect(aggregate([sig])).toEqual(sig);
  });
});

describe('error paths', () => {
  const sk = keyGen(new Uint8Array(32));
  const pk = publicKey(sk);
  const sig = sign(sk, Uint8Array.of(1));

  it('keyGen needs at least 32 bytes of seed', () => {
    expect(() => keyGen(new Uint8Array(31))).toThrowError(ChiaError);
    expect(() => keyGen(new Uint8Array(0))).toThrowError(ChiaError);
  });

  it('rejects secret keys of the wrong length or not below the group order', () => {
    const order = fromHex(GROUP_ORDER.toString(16));
    for (const bad of [
      new Uint8Array(31),
      new Uint8Array(33),
      order,
      new Uint8Array(32).fill(255),
    ]) {
      expect(() => publicKey(bad)).toThrowError(ChiaError);
      expect(() => sign(bad, Uint8Array.of(1))).toThrowError(ChiaError);
      expect(() => deriveUnhardened(bad, 0)).toThrowError(ChiaError);
      expect(() => deriveHardened(bad, 0)).toThrowError(ChiaError);
    }
  });

  it('rejects public keys of the wrong length or off the curve', () => {
    const offCurve = Uint8Array.from(pk);
    offCurve[47] = (offCurve[47] ?? 0) ^ 1;
    // Flipping a bit may land on another valid x; find one that does not.
    let bad = offCurve;
    for (let i = 0; i < 256; i++) {
      bad = Uint8Array.from(pk);
      bad[47] = i;
      try {
        bls12_381.G1.Point.fromBytes(bad).assertValidity();
      } catch {
        break;
      }
    }
    expect(() => deriveUnhardenedPublic(bad, 0)).toThrowError(ChiaError);
    expect(() => deriveUnhardenedPublic(new Uint8Array(47), 0)).toThrowError(ChiaError);
    expect(() => deriveUnhardenedPublic(new Uint8Array(48), 0)).toThrowError(ChiaError);
    expect(verify(bad, Uint8Array.of(1), sig)).toBe(false);
    expect(verify(new Uint8Array(47), Uint8Array.of(1), sig)).toBe(false);
  });

  it('rejects bad derivation indices', () => {
    for (const bad of [-1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => deriveUnhardened(sk, bad)).toThrowError(ChiaError);
      expect(() => deriveUnhardenedPublic(pk, bad)).toThrowError(ChiaError);
      expect(() => deriveHardened(sk, bad)).toThrowError(ChiaError);
    }
  });

  it('verify is false, and aggregate throws, for malformed signatures', () => {
    expect(verify(pk, Uint8Array.of(1), new Uint8Array(95))).toBe(false);
    expect(verify(pk, Uint8Array.of(1), new Uint8Array(96))).toBe(false);
    expect(verify(pk, Uint8Array.of(1), fromHex(INFINITY_SIGNATURE))).toBe(false);
    expect(() => aggregate([new Uint8Array(96)])).toThrowError(ChiaError);
    expect(() => aggregate([sig, new Uint8Array(12)])).toThrowError(ChiaError);
  });

  it('the infinity public key never verifies', () => {
    const infinityPk = fromHex(`c0${'00'.repeat(47)}`);
    expect(verify(infinityPk, Uint8Array.of(1), fromHex(INFINITY_SIGNATURE))).toBe(false);
  });
});
