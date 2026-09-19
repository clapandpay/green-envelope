// SPDX-License-Identifier: AGPL-3.0-or-later
import { sha256 } from '@noble/hashes/sha2.js';
import { SECRET_BYTES } from './constants';
import { EnvelopeError } from './errors';

const DOMAIN = new TextEncoder().encode('clapandpay:envelope:v1');

/** The envelope's key seed: sha256("clapandpay:envelope:v1" || secret). */
export function envelopeSeed(secret: Uint8Array): Uint8Array {
  if (secret.length !== SECRET_BYTES) {
    throw new EnvelopeError('bad_secret', `secret must be ${SECRET_BYTES} bytes`);
  }
  const input = new Uint8Array(DOMAIN.length + secret.length);
  input.set(DOMAIN);
  input.set(secret, DOMAIN.length);
  return sha256(input);
}
