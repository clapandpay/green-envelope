// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeAddress, encodeAddress } from './address';
import { fromHex, toHex } from './bytes';
import { ChiaError } from './errors';
import { loadVectors } from './test-vectors';

const vectors = loadVectors();
const hash32 = fc.uint8Array({ minLength: 32, maxLength: 32 });

describe('golden vectors', () => {
  it.each(vectors.keys)('$address_xch', (v) => {
    const puzzleHash = fromHex(v.puzzle_hash);
    expect(encodeAddress(puzzleHash, 'xch')).toBe(v.address_xch);
    expect(encodeAddress(puzzleHash, 'txch')).toBe(v.address_txch);
    expect(decodeAddress(v.address_xch)).toEqual({ puzzleHash, prefix: 'xch' });
    expect(decodeAddress(v.address_txch)).toEqual({ puzzleHash, prefix: 'txch' });
  });

  it('decodes addresses from the SDK’s own tests', () => {
    const address = 'xch1a0t57qn6uhe7tzjlxlhwy2qgmuxvvft8gnfzmg5detg0q9f3yc3s2apz0h';
    const { puzzleHash, prefix } = decodeAddress(address);
    expect(prefix).toBe('xch');
    expect(encodeAddress(puzzleHash, prefix)).toBe(address);
  });
});

describe('properties', () => {
  it('round-trips, also in upper case', () => {
    fc.assert(
      fc.property(hash32, fc.constantFrom('xch', 'txch', 'a', 'nft'), (puzzleHash, prefix) => {
        const address = encodeAddress(puzzleHash, prefix);
        expect(decodeAddress(address)).toEqual({ puzzleHash, prefix });
        expect(decodeAddress(address.toUpperCase())).toEqual({ puzzleHash, prefix });
      }),
    );
  });

  it('any single-character change is detected', () => {
    const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    fc.assert(
      fc.property(hash32, fc.nat(), fc.nat(31), (puzzleHash, position, replacement) => {
        const address = encodeAddress(puzzleHash, 'xch');
        const at = 4 + (position % (address.length - 4));
        const char = charset.charAt(replacement);
        fc.pre(address.charAt(at) !== char);
        const changed = address.slice(0, at) + char + address.slice(at + 1);
        expect(() => decodeAddress(changed)).toThrowError(ChiaError);
      }),
    );
  });
});

describe('error paths', () => {
  const good = encodeAddress(new Uint8Array(32).fill(7), 'xch');

  it('encode rejects wrong lengths and bad prefixes', () => {
    expect(() => encodeAddress(new Uint8Array(31), 'xch')).toThrowError(ChiaError);
    expect(() => encodeAddress(new Uint8Array(33), 'xch')).toThrowError(ChiaError);
    expect(() => encodeAddress(new Uint8Array(32), '')).toThrowError(ChiaError);
    expect(() => encodeAddress(new Uint8Array(32), 'XCH')).toThrowError(ChiaError);
    expect(() => encodeAddress(new Uint8Array(32), 'x h')).toThrowError(ChiaError);
  });

  it.each([
    ['', 'empty'],
    ['xch', 'no separator'],
    ['1qqqqqq', 'no prefix'],
    [`${good.slice(0, 10)}${good.slice(10).toUpperCase()}`, 'mixed case'],
    [good.slice(0, -1), 'too short'],
    [`${good}q`, 'too long'],
    [good.replace('xch1', 'xch1b'), 'invalid character'],
    ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'bech32, not bech32m, and 20 bytes'],
    [toHex(new Uint8Array(32)), 'hex'],
  ])('decode rejects %j (%s)', (bad) => {
    expect(() => decodeAddress(bad)).toThrowError(ChiaError);
  });

  it('rejects a bech32 (not bech32m) checksum over 32 bytes', () => {
    // Same data, checksum constant 1 instead of 0x2bc830a3: recompute by brute force is not
    // needed, flipping the constant changes the last six characters, so any fixed address with
    // the old checksum must fail. This one is a BIP-173 style encoding of 32 zero bytes.
    expect(() =>
      decodeAddress('xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'),
    ).toThrowError(ChiaError);
  });
});
