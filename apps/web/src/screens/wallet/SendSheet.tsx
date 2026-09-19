// SPDX-License-Identifier: AGPL-3.0-or-later
// Send: who and how much, then one look at the whole recipient before it goes.
import { useState } from 'preact/hooks';
import { Amount } from '../../components/Amount';
import { AmountField, type AmountValue } from '../../components/AmountField';
import { TickIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import { checkAmount, recipientKind } from '../../lib/envelope-form';
import { errorCode, errorText } from '../../lib/errors';
import type { Rate } from '../../lib/money';
import { useServices } from '../../services/context';
import type { Balance } from '../../services/types';

type Step = 'form' | 'confirm' | 'sending' | 'done';

export function SendSheet(props: {
  rate: Rate | null;
  balance: Balance | null;
  onClose: () => void;
  /** Called when money left, and again when that is confirmed. */
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const services = useServices();
  const { rate } = props;
  const [step, setStep] = useState<Step>('form');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState<AmountValue>({ text: '', unit: rate ? 'eur' : 'xch' });
  const [nudged, setNudged] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const recipient = to.trim();
  const recipientOk = recipientKind(recipient) !== null;
  const check = checkAmount(amount.text, amount.unit, rate, props.balance);
  const amountError =
    check.error === 'insufficient_funds' || check.error === 'still_arriving'
      ? check.error === 'still_arriving'
        ? t.create.errArriving
        : t.errors.insufficient
      : check.error !== null || (nudged && check.total === null)
        ? check.error === 'no_price'
          ? t.create.errNoPrice
          : t.create.errAmount
        : null;

  const next = (event: Event) => {
    event.preventDefault();
    setNudged(true);
    if (recipientOk && check.total !== null && check.error === null) setStep('confirm');
  };

  const send = async () => {
    if (check.total === null) return;
    setStep('sending');
    setFailure(null);
    try {
      const result = await services.wallet.send(recipient, check.total);
      setStep('done');
      props.onChanged();
      result.confirmed.then(props.onChanged, () => {});
    } catch (error) {
      setFailure(errorText(errorCode(error), t));
      setStep('form');
    }
  };

  if (step === 'done') {
    return (
      <Sheet open title={t.wallet.sendTitle} onClose={props.onClose}>
        <div class="stack">
          <p class="claim__status claim__status--done" role="status">
            <TickIcon />
            {t.wallet.sendDone}
          </p>
          <button type="button" class="btn btn--primary" onClick={props.onClose}>
            {t.common.close}
          </button>
        </div>
      </Sheet>
    );
  }

  if (step === 'confirm' || step === 'sending') {
    return (
      <Sheet open title={t.wallet.confirmTitle} onClose={props.onClose}>
        <div class="stack">
          <div class="card stack">
            <div>
              <p class="eyebrow">{t.wallet.confirmAmount}</p>
              <Amount mojos={check.total} rate={rate} size="m" align="left" />
            </div>
            <div>
              <p class="eyebrow">{t.wallet.confirmTo}</p>
              <p class="address num">{recipient}</p>
            </div>
          </div>
          <p class="soft">{t.wallet.confirmWarn}</p>
          <button
            type="button"
            class="btn btn--primary btn--huge"
            aria-busy={step === 'sending'}
            disabled={step === 'sending'}
            onClick={send}
          >
            {step === 'sending' ? t.wallet.sending : t.wallet.sendNow}
          </button>
          <button
            type="button"
            class="btn"
            disabled={step === 'sending'}
            onClick={() => setStep('form')}
          >
            {t.common.back}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open title={t.wallet.sendTitle} onClose={props.onClose}>
      <form class="stack" onSubmit={next} noValidate>
        <label class="field">
          <span class="field__label">{t.wallet.toLabel}</span>
          <input
            class="input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellcheck={false}
            placeholder={t.wallet.toPlaceholder}
            value={to}
            aria-invalid={nudged && !recipientOk}
            onInput={(event) => setTo(event.currentTarget.value)}
          />
          <span class="field__hint" aria-live="polite">
            {nudged && !recipientOk && <span class="field__error">{t.wallet.toInvalid}</span>}
          </span>
        </label>
        <AmountField
          label={t.wallet.amountLabel}
          value={amount}
          rate={rate}
          error={amountError}
          onChange={setAmount}
        />
        {failure && (
          <p class="notice" role="alert">
            {failure}
          </p>
        )}
        <button type="submit" class="btn btn--primary">
          {t.wallet.next}
        </button>
      </form>
    </Sheet>
  );
}
