// SPDX-License-Identifier: AGPL-3.0-or-later
// The amount input shared by "new envelope" and "send": euro or XCH, with the other shown below.
import type { RefObject } from 'preact';
import { useId } from 'preact/hooks';
import { useI18n } from '../i18n';
import { parseAmount, type Unit } from '../lib/envelope-form';
import {
  cleanAmountInput,
  EUR_DECIMALS,
  formatEur,
  formatXch,
  mojosToCents,
  type Rate,
  toInputText,
  XCH_DECIMALS,
} from '../lib/money';

export interface AmountValue {
  text: string;
  unit: Unit;
}

export function AmountField(props: {
  label: string;
  value: AmountValue;
  rate: Rate | null;
  error: string | null;
  hint?: string | null;
  onChange: (value: AmountValue) => void;
  inputRef?: RefObject<HTMLInputElement>;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const { value, rate } = props;
  const mojos = parseAmount(value.text, value.unit, rate);
  const other =
    mojos === null || mojos === 0n
      ? null
      : value.unit === 'xch'
        ? rate && formatEur(mojosToCents(mojos, rate), locale)
        : formatXch(mojos, locale);

  const switchUnit = () => {
    const unit: Unit = value.unit === 'eur' ? 'xch' : 'eur';
    props.onChange({ unit, text: mojos === null ? '' : toInputText(mojos, unit, rate, locale) });
  };

  return (
    <div class="field">
      <label class="field__label" for={id}>
        {props.label}
      </label>
      <div class="money-input">
        <input
          id={id}
          {...(props.inputRef ? { ref: props.inputRef } : {})}
          class="input num"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value.text}
          aria-invalid={props.error !== null}
          aria-describedby={`${id}-hint`}
          onInput={(event) => {
            const decimals = value.unit === 'eur' ? EUR_DECIMALS : XCH_DECIMALS;
            const text = cleanAmountInput(event.currentTarget.value, decimals);
            event.currentTarget.value = text;
            props.onChange({ unit: value.unit, text });
          }}
        />
        <span class="money-input__unit num" aria-hidden="true">
          {value.unit === 'eur' ? '€' : 'XCH'}
        </span>
      </div>
      <div id={`${id}-hint`} class="field__hint" aria-live="polite">
        {props.error ? (
          <span class="field__error">{props.error}</span>
        ) : (
          [other && t.create.equals(other), props.hint].filter(Boolean).join(' · ')
        )}
      </div>
      {rate && (
        <button type="button" class="btn btn--plain money-input__switch" onClick={switchUnit}>
          {value.unit === 'eur' ? t.create.useXch : t.create.useEur}
        </button>
      )}
    </div>
  );
}
