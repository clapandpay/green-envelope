// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toHex0x, tryFromHex } from './hex';

describe('hex', () => {
  it('round-trips any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 96 }), (bytes) => {
        expect(tryFromHex(toHex0x(bytes))).toEqual(bytes);
      }),
    );
  });

  it('accepts upper case and a missing prefix', () => {
    expect(tryFromHex('0XaBcD')).toEqual(Uint8Array.of(0xab, 0xcd));
    expect(tryFromHex('00ff')).toEqual(Uint8Array.of(0, 255));
    expect(tryFromHex('')).toEqual(new Uint8Array(0));
  });

  it('returns null for bad input', () => {
    expect(tryFromHex('0x1')).toBeNull();
    expect(tryFromHex('0xgg')).toBeNull();
    expect(tryFromHex('0x0g')).toBeNull();
  });
});
