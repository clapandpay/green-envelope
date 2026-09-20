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

/**
 * Whether the balance covers `total` **and the fee that goes with it**. The fee is paid out of
 * the same coins, so leaving it out here let somebody send their exact balance, reach the
 * confirm step and the passkey prompt, and only then be told there was not enough.
 */
function checkFunds(total: bigint, fee: bigint, balance: Balance | null): AmountError | null {
  if (balance === null) return null;
  const needed = total + fee;
  if (needed <= balance.confirmed) return null;
  const arriving = balance.pending > 0n && needed <= balance.confirmed + balance.pending;
  return arriving ? 'still_arriving' : 'insufficient_funds';
}

/** Checks a plain payment amount against the balance. An empty field is not an error. */
export function checkAmount(
  text: string,
  unit: Unit,
  rate: Rate | null,
  balance: Balance | null,
  fee = 0n,
): AmountCheck {
  if (text.trim() === '') return { total: null, error: null };
  if (unit === 'eur' && rate === null) return { total: null, error: 'no_price' };
  const total = parseAmount(text, unit, rate);
  if (total === null || total <= 0n) return { total: null, error: 'amount_invalid' };
  return { total, error: checkFunds(total, fee, balance) };
}

/** Checks the envelope form: the amount, the number of shares and the minimum per share. */
export function checkEnvelope(input: {
  amountText: string;
  unit: Unit;
  shares: number;
  rate: Rate | null;
  balance: Balance | null;
  fee?: bigint;
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
  return { total: amount.total, error: checkFunds(amount.total, input.fee ?? 0n, input.balance) };
}

/** Keeps the share count inside 1 to 100 whatever was typed or stepped. */
export function clampShares(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SHARES;
  return Math.min(MAX_SHARES, Math.max(MIN_SHARES, Math.round(value)));
}

/** What the recipient field looks like; the service has the last word. */
export function recipientKind(to: string): 'handle' | 'address' | null {
  const text = to.trim();
  if (HANDLE_WHOLE.test(text)) return 'handle';
  if (ADDRESS_WHOLE.test(text)) return 'address';
  return null;
}

const HANDLE_WHOLE = /^@[a-z0-9][a-z0-9_.-]{1,29}$/i;
const ADDRESS_WHOLE = /^t?xch1[02-9ac-hj-np-z]{20,}$/;

// The same two shapes, found anywhere in a block of text rather than anchored to all of it.
// Deliberately generous: a candidate that is not really an address is dropped by the checks
// above, and a candidate that is never found can never be chosen.
const ADDRESS_ANYWHERE = /\b(t?xch1[02-9ac-hj-np-z]{20,})\b/g;
const HANDLE_ANYWHERE = /(?<![\w@])@([a-z0-9][a-z0-9_.-]{1,29})\b/gi;

/** One recipient found inside a larger piece of text. */
export interface RecipientCandidate {
  /** Exactly as it appears in the text, ready to be copied into the field. */
  readonly value: string;
  readonly kind: 'handle' | 'address';
}

/**
 * Every address and @handle inside `text`, in the order they appear, without repeats.
 *
 * People paste whole lines out of a group chat: "ok send it to @anna 🙏", an address with a
 * full stop after it, two addresses where one is superseded. `recipientKind` answers about the
 * whole string and so says null to all of those. This finds the parts that could be a
 * recipient; choosing between them is a separate step, and only needed when there is more
 * than one.
 */
export function scanRecipients(text: string): RecipientCandidate[] {
  const seen = new Set<string>();
  // The position is carried from the match, not looked up afterwards: a handle is stored
  // lowercased, so `text.indexOf('@anna')` is -1 for a message that said "@Anna" and would
  // sort it in front of everything.
  const found: Array<RecipientCandidate & { at: number }> = [];
  const add = (value: string, kind: 'handle' | 'address', at: number) => {
    if (seen.has(value)) return;
    seen.add(value);
    found.push({ value, kind, at });
  };
  for (const match of text.matchAll(ADDRESS_ANYWHERE)) {
    const value = match[1];
    if (value !== undefined && ADDRESS_WHOLE.test(value)) add(value, 'address', match.index);
  }
  for (const match of text.matchAll(HANDLE_ANYWHERE)) {
    const value = match[1];
    if (value !== undefined) {
      const handle = `@${value.toLowerCase()}`;
      if (HANDLE_WHOLE.test(handle)) add(handle, 'handle', match.index);
    }
  }
  // Document order, so a picker lists them the way the message reads.
  return found.sort((a, b) => a.at - b.at).map(({ value, kind }) => ({ value, kind }));
}

/** Null for blank optional text, trimmed otherwise. */
export function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}
