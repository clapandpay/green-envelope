// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  checkAmount,
  checkEnvelope,
  clampShares,
  MIN_SHARE_MOJOS,
  optionalText,
  parseAmount,
  recipientKind,
} from './envelope-form';

const rate = { microEurPerXch: 25_000_000n };
const XCH = 1_000_000_000_000n;
const rich = { confirmed: 2n * XCH, pending: 0n };
const base = { amountText: '20', unit: 'eur' as const, shares: 5, rate, balance: rich };

describe('checkEnvelope', () => {
  it('accepts 20 € for five people', () => {
    expect(checkEnvelope(base)).toEqual({ total: (XCH * 4n) / 5n, error: null });
  });

  it('does not nag about an empty field', () => {
    expect(checkEnvelope({ ...base, amountText: '' })).toEqual({ total: null, error: null });
    expect(checkEnvelope({ ...base, amountText: '  ' })).toEqual({ total: null, error: null });
  });

  it('rejects zero and nonsense', () => {
    for (const amountText of ['0', '0,00', 'abc', '1.2.3', '7,405']) {
      expect(checkEnvelope({ ...base, amountText }).error, amountText).toBe('amount_invalid');
    }
  });

  it('needs a price for euros, not for XCH', () => {
    expect(checkEnvelope({ ...base, rate: null }).error).toBe('no_price');
    expect(checkEnvelope({ ...base, rate: null, unit: 'xch', amountText: '0.5' })).toEqual({
      total: XCH / 2n,
      error: null,
    });
  });

  it('flags insufficient funds', () => {
    const poor = { confirmed: XCH / 10n, pending: 0n };
    expect(checkEnvelope({ ...base, balance: poor }).error).toBe('insufficient_funds');
    expect(checkEnvelope({ ...base, amountText: '2,50', balance: poor }).error).toBeNull(); // exactly all
    expect(checkEnvelope({ ...base, amountText: '2,51', balance: poor }).error).toBe(
      'insufficient_funds',
    );
  });

  it('says "still arriving" when the pending money would cover it', () => {
    const arriving = { confirmed: 0n, pending: XCH };
    expect(checkEnvelope({ ...base, balance: arriving }).error).toBe('still_arriving');
    expect(checkEnvelope({ ...base, amountText: '30', balance: arriving }).error).toBe(
      'insufficient_funds',
    );
  });

  it('does not judge funds before the balance is known', () => {
    expect(checkEnvelope({ ...base, amountText: '99999', balance: null }).error).toBeNull();
  });

  it('enforces the minimum per share, before funds', () => {
    const exact = { ...base, unit: 'xch' as const, amountText: '0.005' };
    expect(checkEnvelope(exact)).toEqual({ total: MIN_SHARE_MOJOS * 5n, error: null });
    expect(checkEnvelope({ ...exact, amountText: '0.004999999999' }).error).toBe('min_per_share');
    expect(checkEnvelope({ ...exact, shares: 6 }).error).toBe('min_per_share');
    expect(
      checkEnvelope({ ...exact, shares: 6, balance: { confirmed: 0n, pending: 0n } }).error,
    ).toBe('min_per_share');
  });

  it('keeps shares between 1 and 100', () => {
    for (const shares of [0, 101, -1, 2.5, Number.NaN]) {
      expect(checkEnvelope({ ...base, shares }).error, String(shares)).toBe('shares_range');
    }
    expect(checkEnvelope({ ...base, shares: 1 }).error).toBeNull();
    expect(checkEnvelope({ ...base, shares: 100, amountText: '50' }).error).toBeNull();
  });
});

describe('checkAmount (send)', () => {
  it('checks the amount against the balance, with no share minimum', () => {
    expect(checkAmount('0,01', 'eur', rate, rich)).toEqual({ total: 400_000_000n, error: null });
    expect(checkAmount('51', 'eur', rate, rich).error).toBe('insufficient_funds');
    expect(checkAmount('', 'eur', rate, rich)).toEqual({ total: null, error: null });
  });
});

describe('small helpers', () => {
  it('parses an amount in either unit', () => {
    expect(parseAmount('7,40', 'eur', rate)).toBe(296_000_000_000n);
    expect(parseAmount('0.296', 'xch', null)).toBe(296_000_000_000n);
    expect(parseAmount('7,40', 'eur', null)).toBeNull();
  });

  it('clamps the stepper', () => {
    expect(clampShares(0)).toBe(1);
    expect(clampShares(101)).toBe(100);
    expect(clampShares(7.6)).toBe(8);
    expect(clampShares(Number.NaN)).toBe(5);
  });

  it('recognises handles and addresses', () => {
    expect(recipientKind('@anna')).toBe('handle');
    expect(recipientKind(' @uncle.kai ')).toBe('handle');
    expect(recipientKind(`xch1${'q'.repeat(58)}`)).toBe('address');
    expect(recipientKind(`txch1${'q'.repeat(58)}`)).toBe('address');
    for (const bad of ['', 'anna', '@', '@a', 'xch1short', `xch1${'b'.repeat(58)}`, 'bc1qxyz']) {
      expect(recipientKind(bad), bad).toBeNull();
    }
  });

  it('turns blank optional text into null', () => {
    expect(optionalText('  ')).toBeNull();
    expect(optionalText(' Anna ')).toBe('Anna');
  });
});
