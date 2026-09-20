// SPDX-License-Identifier: AGPL-3.0-or-later
// Fill an envelope: how much, for how many, lucky dip or equal, a name and a few words.
import { useEffect, useRef, useState } from 'preact/hooks';
import { AmountField, type AmountValue } from '../../components/AmountField';
import { BackIcon, MinusIcon, PlusIcon } from '../../components/icons';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import {
  type AmountError,
  checkEnvelope,
  clampShares,
  DEFAULT_SHARES,
  MAX_MESSAGE,
  MAX_NAME,
  MAX_SHARES,
  MIN_SHARE_MOJOS,
  MIN_SHARES,
  optionalText,
} from '../../lib/envelope-form';
import { errorCode, errorText } from '../../lib/errors';
import { formatMoney, toInputText } from '../../lib/money';
import { PREF_NAME, readPref, writePref } from '../../lib/storage';
import { useRate } from '../../lib/use-rate';
import { onLinkClick } from '../../router';
import { useServices } from '../../services/context';
import type { Balance, SentEnvelope } from '../../services/types';
import { ShareSheet } from './ShareSheet';
import '../../styles/create.css';

const BALANCE_POLL_MS = 5000;

function amountErrorText(error: AmountError, minTotal: string, t: Dict): string {
  switch (error) {
    case 'amount_invalid':
      return t.create.errAmount;
    case 'no_price':
      return t.create.errNoPrice;
    case 'shares_range':
      return t.create.errShares;
    case 'min_per_share':
      return t.create.errMinPerShare(minTotal);
    case 'still_arriving':
      return t.create.errArriving;
    case 'insufficient_funds':
      return t.errors.insufficient;
  }
}

export function CreateScreen(props: { prefill: bigint | null }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const { rate, ready } = useRate();
  const amountInput = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState<AmountValue>({ text: '', unit: 'eur' });
  const [shares, setShares] = useState(DEFAULT_SHARES);
  const [mode, setMode] = useState<'random' | 'equal'>('random');
  const [name, setName] = useState(() => readPref(PREF_NAME) ?? '');
  const [message, setMessage] = useState('');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [nudged, setNudged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [made, setMade] = useState<SentEnvelope | null>(null);

  // Once the price is known (or known to be missing): pick the unit and place the prefill.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!ready || prefilled.current) return;
    prefilled.current = true;
    const unit = rate ? 'eur' : 'xch';
    const text = props.prefill === null ? '' : toInputText(props.prefill, unit, rate, locale);
    setAmount((current) => (current.text === '' ? { unit, text } : current));
  }, [ready, rate, props.prefill, locale]);

  const check = checkEnvelope({
    amountText: amount.text,
    unit: amount.unit,
    shares,
    rate,
    balance,
  });
  const arriving = check.error === 'still_arriving';

  // The balance; asked again every few seconds while money is still on its way.
  useEffect(() => {
    let alive = true;
    const load = () =>
      services.wallet.balance().then(
        (next) => alive && setBalance(next),
        () => {},
      );
    load();
    const timer = arriving ? setInterval(load, BALANCE_POLL_MS) : null;
    return () => {
      alive = false;
      if (timer !== null) clearInterval(timer);
    };
  }, [services, arriving]);

  const money = (mojos: bigint) => formatMoney(mojos, rate, locale);
  const showError = check.error !== null || (nudged && check.total === null);
  const amountError = check.error
    ? amountErrorText(check.error, money(MIN_SHARE_MOJOS * BigInt(shares)), t)
    : showError
      ? t.create.errAmount
      : null;
  const perShare =
    check.total === null || check.error === 'min_per_share'
      ? null
      : mode === 'equal'
        ? t.create.perShare(money(check.total / BigInt(shares)))
        : t.create.perShareRandom(money(check.total / BigInt(shares)));

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (check.total === null || check.error !== null) {
      setNudged(true);
      amountInput.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await services.wallet.ensure();
      const from = optionalText(name);
      writePref(PREF_NAME, from ?? '');
      const sent = await services.envelopes.create({
        total: check.total,
        shares,
        mode,
        from,
        message: optionalText(message),
      });
      setMade(sent);
    } catch (error) {
      setFailure(errorText(errorCode(error), t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="stack create" onSubmit={submit} noValidate>
      <div class="screen-head">
        <a class="icon-btn" href="/" onClick={onLinkClick} aria-label={t.common.back}>
          <BackIcon />
        </a>
        <h1 class="title">{t.create.title}</h1>
      </div>

      <div class="card stack">
        <AmountField
          label={t.create.amountLabel}
          value={amount}
          rate={rate}
          error={amountError}
          hint={perShare}
          onChange={setAmount}
          inputRef={amountInput}
        />
        <p class="create__balance num">
          {balance === null ? '\u00a0' : t.create.balance(money(balance.confirmed))}
        </p>
      </div>

      <div class="create__pair">
        <fieldset class="field">
          <legend class="field__label">{t.create.sharesLabel}</legend>
          <div class="stepper">
            <button
              type="button"
              class="btn stepper__btn"
              aria-label={t.create.fewer}
              disabled={shares <= MIN_SHARES}
              onClick={() => setShares(clampShares(shares - 1))}
            >
              <MinusIcon />
            </button>
            <input
              class="input num stepper__value"
              type="text"
              inputMode="numeric"
              aria-label={t.create.sharesLabel}
              value={String(shares)}
              onChange={(event) => {
                const next = clampShares(Number.parseInt(event.currentTarget.value, 10));
                event.currentTarget.value = String(next);
                setShares(next);
              }}
            />
            <button
              type="button"
              class="btn stepper__btn"
              aria-label={t.create.more}
              disabled={shares >= MAX_SHARES}
              onClick={() => setShares(clampShares(shares + 1))}
            >
              <PlusIcon />
            </button>
          </div>
        </fieldset>

        <fieldset class="field">
          <legend class="field__label">{t.create.splitLabel}</legend>
          <div class="choices">
            {(['random', 'equal'] as const).map((option) => (
              <label key={option} class="choice">
                <input
                  type="radio"
                  name="mode"
                  value={option}
                  checked={mode === option}
                  onChange={() => setMode(option)}
                />
                <span class="choice__card">
                  <SplitPicture mode={option} />
                  <strong>{option === 'random' ? t.create.random : t.create.equal}</strong>
                </span>
              </label>
            ))}
          </div>
          <p class="field__hint">{mode === 'random' ? t.create.randomHint : t.create.equalHint}</p>
        </fieldset>
      </div>

      <div class="card stack create__words">
        <label class="field">
          <span class="field__label">
            {t.create.nameLabel} <small>{t.create.optional}</small>
          </span>
          <input
            class="input"
            type="text"
            autoComplete="given-name"
            maxLength={MAX_NAME}
            placeholder={t.create.namePlaceholder}
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span class="field__label">
            {t.create.messageLabel}
            <small class="num">{t.create.charsLeft(MAX_MESSAGE - message.length)}</small>
          </span>
          <textarea
            class="input"
            rows={2}
            maxLength={MAX_MESSAGE}
            placeholder={t.create.messagePlaceholder}
            value={message}
            onInput={(event) => setMessage(event.currentTarget.value)}
          />
        </label>
      </div>

      {failure && (
        <p class="notice" role="alert">
          {failure}
        </p>
      )}
      <button type="submit" class="btn btn--primary btn--huge create__submit" aria-busy={busy}>
        {busy ? t.create.making : t.create.submit}
      </button>

      {made && <ShareSheet envelope={made} from={optionalText(name)} />}
    </form>
  );
}

/** Bars that show the split at a glance: uneven for the lucky dip, even for equal. */
function SplitPicture(props: { mode: 'random' | 'equal' }) {
  const heights = props.mode === 'random' ? [14, 30, 9, 22] : [19, 19, 19, 19];
  return (
    <svg viewBox="0 0 64 36" class="choice__picture" aria-hidden="true" focusable="false">
      {heights.map((height, i) => (
        <rect key={i} x={3 + i * 15} y={33 - height} width="11" height={height} />
      ))}
    </svg>
  );
}
