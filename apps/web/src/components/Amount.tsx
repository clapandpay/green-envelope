// SPDX-License-Identifier: AGPL-3.0-or-later
// An amount: euro large, XCH small underneath. Without a price, XCH takes the large line.
// Both lines always take their space, so a number arriving never moves the page.
import { useI18n } from '../i18n';
import { formatEur, formatXch, mojosToCents, type Rate } from '../lib/money';
import { useCountUp } from '../lib/motion';

/** The two lines of text for an amount. Pure. */
export function amountLines(mojos: bigint, rate: Rate | null, locale: string) {
  const xch = formatXch(mojos, locale);
  return rate
    ? { main: formatEur(mojosToCents(mojos, rate), locale), sub: xch }
    : { main: xch, sub: '' };
}

export function Amount(props: {
  /** Null shows a placeholder of the same size. */
  mojos: bigint | null;
  rate: Rate | null;
  countUp?: boolean;
  /** Holds the count at zero for this long first, so it starts when the number is visible. */
  countUpDelayMs?: number;
  size?: 'l' | 'm';
  align?: 'center' | 'left';
}) {
  const { locale } = useI18n();
  const target = props.mojos ?? 0n;
  const shown = useCountUp(
    target,
    props.countUp === true && props.mojos !== null,
    900,
    props.countUpDelayMs ?? 0,
  );
  const final = amountLines(target, props.rate, locale);
  const lines = shown === target ? final : amountLines(shown, props.rate, locale);
  const classes = [
    'amount',
    props.size === 'm' ? 'amount--m' : '',
    props.align === 'left' ? 'amount--left' : '',
    final.main.length > 9 ? 'amount--long' : '',
  ];
  return (
    <div class={classes.filter(Boolean).join(' ')}>
      {props.mojos === null ? (
        <>
          <span class="amount__main">
            <span class="skeleton" />
          </span>
          <span class="amount__sub skeleton" />
        </>
      ) : (
        <>
          <span class="amount__main">{lines.main}</span>
          <span class="amount__sub">{lines.sub}</span>
        </>
      )}
    </div>
  );
}
