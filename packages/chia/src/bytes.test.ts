// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  equalBytes,
  fromBase64Url,
  fromHex,
  sha256,
  toBase64Url,
  toHex,
} from './bytes';
import { ChiaError } from './errors';

const bytes = fc.uint8Array({ maxLength: 300 });

describe('hex', () => {
  it('encodes lowercase without prefix', () => {
    expect(toHex(Uint8Array.of(0, 1, 0xab, 0xff))).toBe('0001abff');
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  it('accepts an optional 0x prefix and either case', () => {
    expect(fromHex('0x0aFf')).toEqual(Uint8Array.of(0x0a, 0xff));
    expect(fromHex('0AFF')).toEqual(Uint8Array.of(0x0a, 0xff));
    expect(fromHex('')).toEqual(new Uint8Array(0));
    expect(fromHex('0x')).toEqual(new Uint8Array(0));
  });

  it.each(['abc', '0xabc', 'zz', '0x0g', ' 00', '00 ', '0x0x00', '-1', 'ab\n'])(
    'rejects %j',
    (bad) => {
      expect(() => fromHex(bad)).toThrowError(ChiaError);
    },
  );

  it('rejects non-strings', () => {
    expect(() => fromHex(12 as unknown as string)).toThrowError(ChiaError);
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        expect(fromHex(toHex(b))).toEqual(b);
        expect(fromHex(`0x${toHex(b).toUpperCase()}`)).toEqual(b);
      }),
    );
  });
});

describe('base64url', () => {
  it('matches RFC 4648 test vectors, unpadded', () => {
    const enc = (s: string) => toBase64Url(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg');
    expect(enc('fo')).toBe('Zm8');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg');
    expect(enc('fooba')).toBe('Zm9vYmE');
    expect(enc('foobar')).toBe('Zm9vYmFy');
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff, 0xfe))).toBe('-__-');
  });

  it('agrees with the platform encoder', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        expect(toBase64Url(b)).toBe(Buffer.from(b).toString('base64url'));
      }),
    );
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        expect(fromBase64Url(toBase64Url(b))).toEqual(b);
      }),
    );
  });

  it.each(['A', 'Zg==', 'Zm9v+', 'Zm9v/', 'Zh', 'Zm9', 'Zg ', 'Zm9vé'])('rejects %j', (bad) => {
    expect(() => fromBase64Url(bad)).toThrowError(ChiaError);
  });
});

describe('concatBytes, equalBytes, sha256', () => {
  it('concatenates', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
    expect(concatBytes(Uint8Array.of(1), new Uint8Array(0), Uint8Array.of(2, 3))).toEqual(
      Uint8Array.of(1, 2, 3),
    );
  });

  it('compares', () => {
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1))).toBe(false);
    expect(equalBytes(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('hashes known inputs', () => {
    expect(toHex(sha256())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashing parts equals hashing their concatenation', () => {
    fc.assert(
      fc.property(fc.array(bytes, { maxLength: 5 }), (parts) => {
        expect(sha256(...parts)).toEqual(sha256(concatBytes(...parts)));
      }),
    );
  });
});
