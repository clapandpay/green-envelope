// SPDX-License-Identifier: AGPL-3.0-or-later
// BLS12-381 keys the way Chia uses them: EIP-2333 key generation, Chia's unhardened derivation,
// and the AugSchemeMPL signature scheme (G1 public keys, G2 signatures).
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import type { Bytes } from './bytes';
import { concatBytes, sha256, toHex } from './bytes';
import { ChiaError } from './errors';

/** 32 bytes, big-endian scalar below the group order. */
export type SecretKey = Bytes;
/** 48 bytes, compressed G1 point. */
export type PublicKey = Bytes;
/** 96 bytes, compressed G2 point. */
export type Signature = Bytes;

type G1Point = InstanceType<typeof bls12_381.G1.Point>;
type G2Point = InstanceType<typeof bls12_381.G2.Point>;

/** Order of the BLS12-381 groups (the scalar field modulus r). */
export const GROUP_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** The base field modulus p of BLS12-381. */
const FIELD_MODULUS =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

const AUG_SCHEME_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_';
const POINT_CACHE_LIMIT = 512;

// Decompressing a G1 point costs a field square root and a subgroup check (over a millisecond
// on a laptop, several on a phone). Deriving N children of one key, or taking the synthetic key
// of a child just derived, would otherwise pay that again and again, so points this module has
// already seen are kept by their compressed hex. Created on first use: importing does no work.
let pointCache: Map<string, G1Point> | undefined;

function rememberPoint(key: string, point: G1Point): void {
  if (pointCache === undefined) pointCache = new Map();
  if (pointCache.size >= POINT_CACHE_LIMIT) {
    const oldest = pointCache.keys().next();
    if (!oldest.done) pointCache.delete(oldest.value);
  }
  pointCache.set(key, point);
}

/** Internal: big-endian bytes to bigint. */
export function bytesToBigInt(b: Bytes): bigint {
  return b.length === 0 ? 0n : BigInt(`0x${toHex(b)}`);
}

/** Internal: bigint to exactly `length` big-endian bytes. */
export function bigIntToBytes(n: bigint, length: number): Bytes {
  const out = new Uint8Array(length);
  let rest = n;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** Internal: validates a secret key and returns its scalar. */
export function secretKeyScalar(sk: SecretKey): bigint {
  if (!(sk instanceof Uint8Array) || sk.length !== 32) {
    throw new ChiaError('bad_key', 'secret key must be 32 bytes');
  }
  const scalar = bytesToBigInt(sk);
  if (scalar >= GROUP_ORDER) throw new ChiaError('bad_key', 'secret key is not below group order');
  return scalar;
}

/** Internal: decompresses and validates a public key (on curve, in the G1 subgroup); cached. */
export function publicKeyPoint(pk: PublicKey): G1Point {
  if (!(pk instanceof Uint8Array) || pk.length !== 48) {
    throw new ChiaError('bad_key', 'public key must be 48 bytes');
  }
  const key = toHex(pk);
  const cached = pointCache?.get(key);
  if (cached !== undefined) return cached;
  let point: G1Point;
  try {
    point = bls12_381.G1.Point.fromBytes(pk);
    point.assertValidity();
  } catch {
    throw new ChiaError('bad_key', 'public key is not a valid G1 point');
  }
  rememberPoint(key, point);
  return point;
}

/**
 * Compressed G1 encoding (ZCash format): 48-byte big-endian x with three flag bits on top:
 * 0x80 compressed, 0x40 infinity, 0x20 y is the larger of the two roots. noble's `toBytes` gives
 * the same bytes (a test asserts it) but first re-checks subgroup membership, which costs a
 * full scalar multiplication. Every point that reaches this function is a sum of multiples of
 * the generator and of public keys already checked on the way in, so it is in the subgroup.
 */
function pointToPublicKey(point: G1Point): PublicKey {
  let pk: PublicKey;
  if (point.is0()) {
    pk = new Uint8Array(48);
    pk[0] = 0xc0;
  } else {
    const { x, y } = point.toAffine();
    pk = bigIntToBytes(x, 48);
    const larger = y > (FIELD_MODULUS - 1n) / 2n;
    pk[0] = (pk[0] ?? 0) | (larger ? 0xa0 : 0x80);
  }
  rememberPoint(toHex(pk), point);
  return pk;
}

/** `G1 * scalar` in constant time, for secret scalars; zero gives the point at infinity. */
function basePointTimesSecret(scalar: bigint): G1Point {
  const G1 = bls12_381.G1.Point;
  return scalar === 0n ? G1.ZERO : G1.BASE.multiply(scalar);
}

/**
 * `G1 * scalar` for scalars that are hashes of public keys (derivation offsets). Anybody can
 * compute those, so the faster variable-time multiplication gives nothing away.
 */
function basePointTimesPublic(scalar: bigint): G1Point {
  return bls12_381.G1.Point.BASE.multiplyUnsafe(scalar);
}

function checkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
    throw new ChiaError('bad_int', 'derivation index must be an unsigned 32-bit integer');
  }
}

function indexBytes(index: number): Bytes {
  checkIndex(index);
  return Uint8Array.of(index >>> 24, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff);
}

/**
 * The master key for `seed` (at least 32 bytes): EIP-2333 `HKDF_mod_r` as Chia has it, which is
 * the draft-03 form (blst's `keygen_v3`): the salt is used as it is, not hashed first.
 */
export function keyGen(seed: Bytes): SecretKey {
  if (!(seed instanceof Uint8Array) || seed.length < 32) {
    throw new ChiaError('bad_length', 'seed must be at least 32 bytes');
  }
  const salt = new TextEncoder().encode('BLS-SIG-KEYGEN-SALT-');
  const prk = extract(nobleSha256, concatBytes(seed, Uint8Array.of(0)), salt);
  const okm = expand(nobleSha256, prk, Uint8Array.of(0, 48), 48);
  return bigIntToBytes(bytesToBigInt(okm) % GROUP_ORDER, 32);
}

/** The G1 public key of `sk`. */
export function publicKey(sk: SecretKey): PublicKey {
  return pointToPublicKey(basePointTimesSecret(secretKeyScalar(sk)));
}

function lamportHalf(ikm: Bytes, salt: Bytes, out: Bytes, offset: number): void {
  const okm = expand(nobleSha256, extract(nobleSha256, ikm, salt), undefined, 255 * 32);
  for (let i = 0; i < 255; i++) {
    out.set(nobleSha256(okm.subarray(32 * i, 32 * i + 32)), offset + 32 * i);
  }
}

/** EIP-2333 hardened child: `keyGen(parent_SK_to_lamport_PK(sk, index))`. */
export function deriveHardened(sk: SecretKey, index: number): SecretKey {
  secretKeyScalar(sk);
  const salt = indexBytes(index);
  const flipped = sk.map((byte) => byte ^ 0xff);
  const lamport = new Uint8Array(2 * 255 * 32);
  lamportHalf(sk, salt, lamport, 0);
  lamportHalf(flipped, salt, lamport, 255 * 32);
  return keyGen(nobleSha256(lamport));
}

function unhardenedOffset(pk: PublicKey, index: number): bigint {
  return bytesToBigInt(sha256(pk, indexBytes(index))) % GROUP_ORDER;
}

/** Chia's unhardened child: `(sk + sha256(pk || index_be32)) mod r`. */
export function deriveUnhardened(sk: SecretKey, index: number): SecretKey {
  const scalar = secretKeyScalar(sk);
  const offset = unhardenedOffset(publicKey(sk), index);
  return bigIntToBytes((scalar + offset) % GROUP_ORDER, 32);
}

/** Public side of `deriveUnhardened`: `pk + G1 * sha256(pk || index_be32)`. */
export function deriveUnhardenedPublic(pk: PublicKey, index: number): PublicKey {
  const parent = publicKeyPoint(pk);
  return pointToPublicKey(parent.add(basePointTimesPublic(unhardenedOffset(pk, index))));
}

/** Internal: `sk + offset` and `pk + G1 * offset`, shared with the synthetic-key derivation. */
export function addToSecretKey(sk: SecretKey, offset: bigint): SecretKey {
  return bigIntToBytes((secretKeyScalar(sk) + offset) % GROUP_ORDER, 32);
}

/** Internal: `pk + G1 * offset`, for an offset that is public (a hash of `pk`). */
export function addToPublicKey(pk: PublicKey, offset: bigint): PublicKey {
  return pointToPublicKey(publicKeyPoint(pk).add(basePointTimesPublic(offset)));
}

function signatureToBytes(point: G2Point): Signature {
  return bls12_381.longSignatures.Signature.toBytes(point);
}

function signaturePoint(sig: Signature): G2Point {
  if (!(sig instanceof Uint8Array) || sig.length !== 96) {
    throw new ChiaError('bad_signature', 'signature must be 96 bytes');
  }
  try {
    const point = bls12_381.longSignatures.Signature.fromBytes(sig);
    point.assertValidity();
    return point;
  } catch {
    throw new ChiaError('bad_signature', 'signature is not a valid G2 point');
  }
}

function hashAugmented(pk: PublicKey, message: Bytes): G2Point {
  return bls12_381.G2.hashToCurve(concatBytes(pk, message), { DST: AUG_SCHEME_DST });
}

/** Internal: `sign` for a caller that already has `pk = publicKey(sk)` and wants it computed once. */
export function signWithPublicKey(sk: SecretKey, pk: PublicKey, message: Bytes): Signature {
  const scalar = secretKeyScalar(sk);
  if (scalar === 0n) return signatureToBytes(bls12_381.G2.Point.ZERO);
  return signatureToBytes(hashAugmented(pk, message).multiply(scalar));
}

/** AugSchemeMPL signature: `sk * H(pk || message)`. */
export function sign(sk: SecretKey, message: Bytes): Signature {
  return signWithPublicKey(sk, publicKey(sk), message);
}

/** AugSchemeMPL verification; malformed keys or signatures give `false`, never an exception. */
export function verify(pk: PublicKey, message: Bytes, sig: Signature): boolean {
  try {
    const key = publicKeyPoint(pk);
    const signature = signaturePoint(sig);
    if (key.is0()) return false;
    // e(pk, H(m)) == e(G1, sig)  <=>  e(pk, H(m)) * e(-G1, sig) == 1
    const product = bls12_381.pairingBatch([
      { g1: key, g2: hashAugmented(pk, message) },
      { g1: bls12_381.G1.Point.BASE.negate(), g2: signature },
    ]);
    return bls12_381.fields.Fp12.eql(product, bls12_381.fields.Fp12.ONE);
  } catch {
    return false;
  }
}

/** Sum of signatures; the empty list gives the G2 point at infinity (`c0 00 .. 00`). */
export function aggregate(sigs: Signature[]): Signature {
  let sum = bls12_381.G2.Point.ZERO;
  for (const sig of sigs) sum = sum.add(signaturePoint(sig));
  return signatureToBytes(sum);
}
