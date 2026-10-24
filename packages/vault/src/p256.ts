// SPDX-License-Identifier: AGPL-3.0-or-later
// The passkey's P-256 key, as the chain wants it: compressed public keys and raw r||s signatures.
// Only public data passes through here; the private key stays in the authenticator.
import type { Bytes } from '@ge/chia';
import { p256 } from '@noble/curves/nist.js';
import { VaultError } from './errors';

/** A SEC1 compressed P-256 public key: 33 bytes, 0x02 or 0x03 first. */
export const PUBLIC_KEY_BYTES = 33;
/** A raw `r || s` signature: 64 bytes. */
export const SIGNATURE_BYTES = 64;

/** SEC1 compressed form of any SEC1 encoding (65-byte uncompressed or 33-byte compressed). */
export function compressPublicKey(sec1: Bytes): Bytes {
  try {
    return p256.Point.fromBytes(sec1).toBytes(true);
  } catch (cause) {
    throw new VaultError('bad_key', 'not a P-256 public key', { cause });
  }
}

/**
 * The public key out of a WebAuthn `getPublicKey()` result: DER SubjectPublicKeyInfo of an
 * ES256 key, which ends in the 65-byte uncompressed point.
 */
export function publicKeyFromSpki(spki: Bytes): Bytes {
  const point = spki.slice(spki.length - 65);
  if (spki.length < 65 || point[0] !== 0x04) {
    throw new VaultError('bad_key', 'not an uncompressed P-256 key');
  }
  return compressPublicKey(point);
}

/** `r || s` from the DER signature a passkey returns. */
export function signatureFromDer(der: Bytes): Bytes {
  try {
    return p256.Signature.fromBytes(der, 'der').toBytes('compact');
  } catch (cause) {
    throw new VaultError('bad_signature', 'not a DER P-256 signature', { cause });
  }
}

/**
 * The public keys that could have made `signature` over `messageHash` (at most two). This is
 * how a vault is found again on a new phone: WebAuthn hands out the public key only when the
 * passkey is made, but every signature carries it.
 */
export function recoverPublicKeys(messageHash: Bytes, signature: Bytes): Bytes[] {
  const sig = p256.Signature.fromBytes(signature, 'compact');
  const keys: Bytes[] = [];
  for (const bit of [0, 1]) {
    try {
      keys.push(sig.addRecoveryBit(bit).recoverPublicKey(messageHash).toBytes(true));
    } catch {
      // that recovery bit gives no point on the curve
    }
  }
  return keys;
}

/** Whether `signature` is `publicKey`'s over `messageHash` (both raw), as `secp256r1_verify` checks. */
export function verifyPrehashed(publicKey: Bytes, messageHash: Bytes, signature: Bytes): boolean {
  try {
    return p256.verify(signature, messageHash, publicKey, { prehash: false, lowS: false });
  } catch {
    return false;
  }
}
