// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  centsToMojos,
  cleanAmountInput,
  divRound,
  formatEur,
  formatMoney,
  formatXch,
  MOJOS_PER_XCH,
  mojosToCents,
  parseDecimal,
  toDecimalString,
  toInputText,
  toRate,
} from './money';

const rate25 = { microEurPerXch: 25_000_000n };
const nbsp = (text: string) => text.replace(/ | /g, ' ');

describe('parseDecimal', () => {
  it('has no float drift: 0.1 + 0.2 is 0.3', () => {
    const sum = (parseDecimal('0.1', 12) ?? 0n) + (parseDecimal('0.2', 12) ?? 0n);
    expect(sum).toBe(parseDecimal('0.3', 12));
    expect(sum).toBe(300_000_000_000n);
    expect((parseDecimal('0,10', 2) ?? 0n) + (parseDecimal('0,20', 2) ?? 0n)).toBe(30n);
  });

  it('keeps all twelve places exactly', () => {
    expect(parseDecimal('0.000000000001', 12)).toBe(1n);
    expect(parseDecimal('123456789.123456789012', 12)).toBe(123_456_789_123_456_789_012n);
    expect(parseDecimal('21000000.999999999999', 12)).toBe(21_000_000_999_999_999_999n);
  });

  it('takes comma or dot, and bare fractions', () => {
    expect(parseDecimal('7,40', 2)).toBe(740n);
    expect(parseDecimal('7.4', 2)).toBe(740n);
    expect(parseDecimal('.5', 2)).toBe(50n);
    expect(parseDecimal('5.', 2)).toBe(500n);
    expect(parseDecimal(' 20 ', 2)).toBe(2000n);
    expect(parseDecimal('007', 2)).toBe(700n);
  });

  it('rejects what is not a plain amount', () => {
    for (const bad of ['', ' ', '.', ',', '-1', '1e3', '1.000,50', '1 000', 'abc', '7.405', '١٢']) {
      expect(parseDecimal(bad, 2), bad).toBeNull();
    }
    expect(parseDecimal('0.0000000000001', 12)).toBeNull(); // thirteen places
  });
});

describe('toDecimalString', () => {
  it('is exact and trims zeros down to the minimum', () => {
    expect(toDecimalString(300_000_000_000n, 12)).toBe('0.3');
    expect(toDecimalString(1n, 12)).toBe('0.000000000001');
    expect(toDecimalString(123_456_789_123_456_789_012n, 12)).toBe('123456789.123456789012');
    expect(toDecimalString(740n, 2, 2)).toBe('7.40');
    expect(toDecimalString(700n, 2, 2)).toBe('7.00');
    expect(toDecimalString(700n, 2)).toBe('7');
    expect(toDecimalString(0n, 12)).toBe('0');
    expect(toDecimalString(-5n, 2, 2)).toBe('-0.05');
  });

  it('round-trips with parseDecimal for any amount', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 24n }), (mojos) => {
        expect(parseDecimal(toDecimalString(mojos, 12), 12)).toBe(mojos);
      }),
    );
  });
});

describe('euro and XCH', () => {
  it('turns a float price into an integer rate', () => {
    expect(toRate(25)).toEqual(rate25);
    expect(toRate(23.456789)).toEqual({ microEurPerXch: 23_456_789n });
    expect(toRate(0.1 + 0.2)).toEqual({ microEurPerXch: 300_000n }); // 0.30000000000000004
    for (const bad of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e-9]) {
      expect(toRate(bad)).toBeNull();
    }
  });

  it('converts the story: 0.296 XCH at 25 € is 7.40 €', () => {
    expect(mojosToCents(296_000_000_000n, rate25)).toBe(740n);
    expect(centsToMojos(740n, rate25)).toBe(296_000_000_000n);
    expect(centsToMojos(2000n, rate25)).toBe((MOJOS_PER_XCH * 4n) / 5n);
  });

  it('rounds to the nearest cent, half up', () => {
    const rate = { microEurPerXch: 1_000_000n }; // 1 € per XCH: 1 cent = 1e10 mojos
    expect(mojosToCents(4_999_999_999n, rate)).toBe(0n);
    expect(mojosToCents(5_000_000_000n, rate)).toBe(1n);
    expect(mojosToCents(14_999_999_999n, rate)).toBe(1n);
    expect(divRound(-5n, 10n)).toBe(-1n);
    expect(() => divRound(1n, 0n)).toThrow(RangeError);
  });

  it('stays exact where a float would not', () => {
    // 90 071 992.54740993 XCH is beyond 2^53 mojos; a Number would lose the last digits.
    const mojos = 90_071_992_547_409_930_001n;
    expect(mojosToCents(mojos, rate25)).toBe(225_179_981_369n);
  });

  it('cents survive the trip to mojos and back at any sane price', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.double({ min: 0.01, max: 100_000, noNaN: true }),
        (cents, price) => {
          const rate = toRate(price);
          if (!rate) return;
          expect(mojosToCents(centsToMojos(cents, rate), rate)).toBe(cents);
        },
      ),
    );
  });
});

describe('formatting', () => {
  it('formats euro with Intl for the locale', () => {
    expect(nbsp(formatEur(740n, 'de'))).toBe('7,40 €');
    expect(formatEur(740n, 'en')).toBe('€7.40');
    expect(nbsp(formatEur(123_456_789n, 'de'))).toBe('1.234.567,89 €');
    expect(formatEur(5n, 'en')).toBe('€0.05');
  });

  it('formats XCH cut to six places, never rounded up', () => {
    expect(nbsp(formatXch(296_000_000_000n, 'de'))).toBe('0,296 XCH');
    expect(nbsp(formatXch(1_000_000_000_000n, 'en'))).toBe('1.00 XCH');
    expect(nbsp(formatXch(1_999_999_999_999n, 'en'))).toBe('1.999999 XCH');
    expect(nbsp(formatXch(0n, 'en'))).toBe('0.00 XCH');
  });

  it('shows dust in full instead of as zero', () => {
    expect(nbsp(formatXch(1n, 'en'))).toBe('0.000000000001 XCH');
  });

  it('formats all twelve places exactly when asked', () => {
    expect(nbsp(formatXch(123_456_789_012n, 'en', 12))).toBe('0.123456789012 XCH');
  });

  it('uses euro when there is a price, XCH otherwise', () => {
    expect(formatMoney(296_000_000_000n, rate25, 'en')).toBe('€7.40');
    expect(nbsp(formatMoney(296_000_000_000n, null, 'en'))).toBe('0.296 XCH');
  });
});

describe('amount field helpers', () => {
  it('cleans typing', () => {
    expect(cleanAmountInput('12a,3.4', 2)).toBe('12,34');
    expect(cleanAmountInput('7,4059', 2)).toBe('7,40');
    expect(cleanAmountInput('€ 20', 2)).toBe('20');
    expect(cleanAmountInput('0.1234567890123', 12)).toBe('0.123456789012');
    expect(cleanAmountInput('12345678901', 2)).toBe('123456789');
  });

  it('writes an amount into a field in either unit', () => {
    expect(toInputText(296_000_000_000n, 'eur', rate25, 'de-DE')).toBe('7,40');
    expect(toInputText(296_000_000_000n, 'eur', rate25, 'en')).toBe('7.40');
    expect(toInputText(296_000_000_000n, 'xch', rate25, 'de')).toBe('0,296');
    expect(toInputText(296_000_000_000n, 'eur', null, 'en')).toBe('0.296');
  });
});
