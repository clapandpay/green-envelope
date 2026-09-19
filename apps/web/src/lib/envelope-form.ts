// SPDX-License-Identifier: AGPL-3.0-or-later
// Validation of the "new envelope" and "send" forms. Pure functions, tested without rendering.
import type { Balance } from '../services/types';
import { centsToMojos, EUR_DECIMALS, parseDecimal, type Rate, XCH_DECIMALS } from './money';

export const MIN_SHARES = 1;
export const MAX_SHARES = 100;
export const DEFAULT_SHARES = 5;
export const MAX_MESSAGE = 120;
export const MAX_NAME = 24;
/** Smallest share worth opening (0.001 XCH): each share pays its own way to the opener. */
export const MIN_SHARE_MOJOS = 1_000_000_000n;

export type Unit = 'eur' | 'xch';

export type AmountError =
  | 'amount_invalid'
  | 'no_price'
  | 'shares_range'
  | 'min_per_share'
  | 'still_arriving'
  | 'insufficient_funds';

export interface AmountCheck {
  /** The amount in mojos, when the text is a usable number. */
  total: bigint | null;
  error: AmountError | null;
}

/** The typed amount in mojos. Null when empty or not a number. */
export function parseAmount(text: string, unit: Unit, rate: Rate | null): bigint | null {
  if (unit === 'xch') return parseDecimal(text, XCH_DECIMALS);
  const cents = parseDecimal(text, EUR_DECIMALS);
  return cents === null || rate === null ? null : centsToMojos(cents, rate);
}

function checkFunds(total: bigint, balance: Balance | null): AmountError | null {
  if (balance === null || total <= balance.confirmed) return null;
  const arriving = balance.pending > 0n && total <= balance.confirmed + balance.pending;
  return arriving ? 'still_arriving' : 'insufficient_funds';
}

/** Checks a plain payment amount against the balance. An empty field is not an error. */
export function checkAmount(
  text: string,
  unit: Unit,
  rate: Rate | null,
  balance: Balance | null,
): AmountCheck {
  if (text.trim() === '') return { total: null, error: null };
  if (unit === 'eur' && rate === null) return { total: null, error: 'no_price' };
  const total = parseAmount(text, unit, rate);
  if (total === null || total <= 0n) return { total: null, error: 'amount_invalid' };
  return { total, error: checkFunds(total, balance) };
}

/** Checks the envelope form: the amount, the number of shares and the minimum per share. */
export function checkEnvelope(input: {
  amountText: string;
  unit: Unit;
  shares: number;
  rate: Rate | null;
  balance: Balance | null;
}): AmountCheck {
  const { shares } = input;
  if (!Number.isInteger(shares) || shares < MIN_SHARES || shares > MAX_SHARES) {
    return { total: null, error: 'shares_range' };
  }
  const amount = checkAmount(input.amountText, input.unit, input.rate, null);
  if (amount.total === null) return amount;
  if (amount.total < MIN_SHARE_MOJOS * BigInt(shares)) {
    return { total: amount.total, error: 'min_per_share' };
  }
  return { total: amount.total, error: checkFunds(amount.total, input.balance) };
}

/** Keeps the share count inside 1 to 100 whatever was typed or stepped. */
export function clampShares(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SHARES;
  return Math.min(MAX_SHARES, Math.max(MIN_SHARES, Math.round(value)));
}

/** What the recipient field looks like; the service has the last word. */
export function recipientKind(to: string): 'handle' | 'address' | null {
  const text = to.trim();
  if (/^@[a-z0-9][a-z0-9_.-]{1,29}$/i.test(text)) return 'handle';
  if (/^t?xch1[02-9ac-hj-np-z]{20,}$/.test(text)) return 'address';
  return null;
}

/** Null for blank optional text, trimmed otherwise. */
export function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}
