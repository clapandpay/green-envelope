// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvelopeError } from './errors';
import { envelopeSeed } from './seed';

describe('envelopeSeed', () => {
  it('is sha256 of the domain tag followed by the secret', () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i);
    const want = createHash('sha256').update('clapandpay:envelope:v1').update(secret).digest();
    expect(envelopeSeed(secret)).toEqual(new Uint8Array(want));
    expect(envelopeSeed(secret)).toHaveLength(32);
  });

  it('differs per secret and refuses a wrong length', () => {
    expect(envelopeSeed(new Uint8Array(16))).not.toEqual(envelopeSeed(new Uint8Array(16).fill(1)));
    expect(() => envelopeSeed(new Uint8Array(15))).toThrow(EnvelopeError);
    expect(() => envelopeSeed(new Uint8Array(32))).toThrow(
      expect.objectContaining({ code: 'bad_secret' }),
    );
  });
});
