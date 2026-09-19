// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { encodeQr, type QrCode, QrError, qrPath } from './qr';
import { QR_FIXTURES } from './qr.fixtures';

function toHex(code: QrCode): string {
  let hex = '';
  let nibble = 0;
  let count = 0;
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      nibble = (nibble << 1) | (code.dark(x, y) ? 1 : 0);
      count += 1;
      if (count === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        count = 0;
      }
    }
  }
  return count ? hex + (nibble << (4 - count)).toString(16) : hex;
}

describe('encodeQr against a reference encoder', () => {
  for (const fixture of QR_FIXTURES) {
    const name = `${fixture.text.slice(0, 24)}… (v${fixture.version}, mask ${fixture.mask ?? 'auto'})`;
    it(`matches module for module: ${name}`, () => {
      const code = encodeQr(fixture.text, { mask: fixture.chosenMask });
      expect(code.version).toBe(fixture.version);
      expect(code.size).toBe(fixture.version * 4 + 17);
      expect(toHex(code)).toBe(fixture.hex);
    });
    if (fixture.mask === null) {
      it(`chooses the same mask: ${name}`, () => {
        expect(encodeQr(fixture.text).mask).toBe(fixture.chosenMask);
      });
    }
  }
});

describe('encodeQr limits and output', () => {
  it('picks the smallest version that fits', () => {
    expect(encodeQr('a'.repeat(17)).version).toBe(1);
    expect(encodeQr('a'.repeat(18)).version).toBe(2);
    expect(encodeQr('a'.repeat(230)).version).toBe(9);
  });

  it('refuses what does not fit', () => {
    expect(() => encodeQr('a'.repeat(231))).toThrow(QrError);
  });

  it('rejects a mask outside 0 to 7', () => {
    expect(() => encodeQr('a', { mask: 8 })).toThrow(RangeError);
  });

  it('draws one path with a quiet zone', () => {
    const code = encodeQr('hi');
    const { d, viewBox } = qrPath(code);
    expect(viewBox).toBe('0 0 29 29');
    expect(d.startsWith('M4 4h7v1h-7z')).toBe(true); // top edge of the first finder
    let darkModules = 0;
    for (let y = 0; y < code.size; y++)
      for (let x = 0; x < code.size; x++) if (code.dark(x, y)) darkModules += 1;
    const drawn = [...d.matchAll(/h(\d+)v1/g)].reduce((total, m) => total + Number(m[1]), 0);
    expect(drawn).toBe(darkModules);
  });
});
