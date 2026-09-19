// SPDX-License-Identifier: AGPL-3.0-or-later
// Money maths for display and input. Everything is bigint: mojos for XCH, cents for euro.
// The only float in the app is the price as it arrives; it is turned into a bigint rate at once.

export const MOJOS_PER_XCH = 1_000_000_000_000n;
export const XCH_DECIMALS = 12;
export const EUR_DECIMALS = 2;

/** Euro price of one XCH in micro-euros (1e-6 €), so conversion stays in integers. */
export interface Rate {
  readonly microEurPerXch: bigint;
}

// mojos -> cents: mojos * microEur / 1e12 (per XCH) / 1e4 (micro-euro per cent)
const MOJO_CENT_SCALE = 10n ** 16n;

/** Turns the price service's float into an integer rate. Null for missing or nonsense prices. */
export function toRate(eurPerXch: number | null): Rate | null {
  if (eurPerXch === null || !Number.isFinite(eurPerXch) || eurPerXch <= 0) return null;
  const micro = BigInt(Math.round(eurPerXch * 1e6));
  return micro > 0n ? { microEurPerXch: micro } : null;
}

/** Integer division rounded half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  return n < 0n ? -((-n + d / 2n) / d) : (n + d / 2n) / d;
}

/** Mojos to euro cents at `rate`, rounded to the nearest cent. */
export function mojosToCents(mojos: bigint, rate: Rate): bigint {
  return divRound(mojos * rate.microEurPerXch, MOJO_CENT_SCALE);
}

/** Euro cents to mojos at `rate`, rounded to the nearest mojo. */
export function centsToMojos(cents: bigint, rate: Rate): bigint {
  return divRound(cents * MOJO_CENT_SCALE, rate.microEurPerXch);
}

/**
 * Parses what a person typed ("7,40", "7.4", ".5") into the smallest unit.
 * Null when it is not a plain non-negative decimal or has more than `decimals` places.
 */
export function parseDecimal(text: string, decimals: number): bigint | null {
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return null;
  if (fraction.length > decimals) return null;
  return (
    BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  );
}

/** Exact decimal string with a dot, trailing zeros trimmed down to `minDecimals`. */
export function toDecimalString(value: bigint, decimals: number, minDecimals = 0): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  let fraction = decimals > 0 ? digits.slice(-decimals) : '';
  while (fraction.length > minDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Keeps digits and one separator while typing; cuts places beyond `decimals`. */
export function cleanAmountInput(raw: string, decimals: number): string {
  let out = '';
  let separator = false;
  let places = 0;
  let wholeDigits = 0;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (separator) {
        if (places >= decimals) continue;
        places += 1;
      } else {
        if (wholeDigits >= 9) continue;
        wholeDigits += 1;
      }
      out += ch;
    } else if ((ch === ',' || ch === '.') && !separator && decimals > 0) {
      separator = true;
      out += ch;
    }
  }
  return out;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, key: string, options: Intl.NumberFormatOptions) {
  const id = `${locale}|${key}`;
  let found = formatters.get(id);
  if (!found) {
    found = new Intl.NumberFormat(locale, options);
    formatters.set(id, found);
  }
  return found;
}

// Intl takes exact decimal strings (older engines read them as a Number, which is still right
// to the cent for any amount a person can hold).
function formatExact(format: Intl.NumberFormat, decimal: string): string {
  return format.format(decimal as Intl.StringNumericLiteral);
}

/** "7,40 €" / "€7.40" */
export function formatEur(cents: bigint, locale: string): string {
  const format = formatter(locale, 'eur', { style: 'currency', currency: 'EUR' });
  return formatExact(format, toDecimalString(cents, EUR_DECIMALS, EUR_DECIMALS));
}

/**
 * "0,296 XCH". Cut (never rounded up) to `maxDecimals`; an amount too small to show at that
 * precision is shown in full rather than as zero.
 */
export function formatXch(mojos: bigint, locale: string, maxDecimals = 6): string {
  const cut = 10n ** BigInt(XCH_DECIMALS - Math.min(maxDecimals, XCH_DECIMALS));
  const truncated = (mojos / cut) * cut;
  const shown = truncated === 0n && mojos !== 0n ? mojos : truncated;
  const places = shown === truncated ? maxDecimals : XCH_DECIMALS;
  const format = formatter(locale, `xch${places}`, {
    minimumFractionDigits: 2,
    maximumFractionDigits: places,
  });
  return `${formatExact(format, toDecimalString(shown, XCH_DECIMALS))}\u00a0XCH`;
}

/** One amount in one line: euro when there is a price, XCH otherwise. */
export function formatMoney(mojos: bigint, rate: Rate | null, locale: string): string {
  return rate ? formatEur(mojosToCents(mojos, rate), locale) : formatXch(mojos, locale);
}

/** Text for an amount field in the given unit, with the locale's decimal separator. */
export function toInputText(mojos: bigint, unit: 'eur' | 'xch', rate: Rate | null, locale: string) {
  const plain =
    unit === 'eur' && rate
      ? toDecimalString(mojosToCents(mojos, rate), EUR_DECIMALS, EUR_DECIMALS)
      : toDecimalString(mojos, XCH_DECIMALS);
  return locale.startsWith('de') ? plain.replace('.', ',') : plain;
}
