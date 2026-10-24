// SPDX-License-Identifier: AGPL-3.0-or-later
// Move to Klimper: everything here goes to the address of the person's own Klimper wallet.
// Klimper keeps its own 24 words; nothing about this wallet's passkey leaves it. One look at
// the whole address and the amount, then one face or finger.
import { useState } from 'preact/hooks';
import { Amount } from '../../components/Amount';
import { ExplorerLink } from '../../components/ExplorerLink';
import { FeeLine } from '../../components/FeeLine';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import { errorCode, errorText } from '../../lib/errors';
import { KLIMPER_DOWNLOAD } from '../../lib/klimper';
import type { Rate } from '../../lib/money';
import { useServices } from '../../services/context';

type Step = 'form' | 'confirm' | 'moving' | 'done';

const ADDRESS = /^(xch|txch)1[02-9ac-hj-np-z]{58}$/;

export function KlimperSheet(props: {
  rate: Rate | null;
  balance: bigint;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const services = useServices();
  const [step, setStep] = useState<Step>('form');
  const [to, setTo] = useState('');
  const [nudged, setNudged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [movedCoin, setMovedCoin] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ fee: bigint; arriving: bigint } | null>(null);
  const address = to.trim().toLowerCase();
  const valid = ADDRESS.test(address);

  async function move() {
    setStep('moving');
    setProblem(null);
    try {
      const moved = await services.wallet.moveToKlimper(address, quote?.fee);
      setMore(moved.more);
      setMovedCoin(moved.coinId);
      setStep('done');
      props.onChanged();
    } catch (error) {
      setProblem(errorText(errorCode(error), t));
      setStep('confirm');
    }
  }

  if (step === 'done') {
    return (
      <Sheet open title={t.wallet.klimperTitle} onClose={props.onClose}>
        <div class="stack">
          <p class="notice notice--calm" role="status">
            {more ? t.wallet.klimperMore : t.wallet.klimperDone}
          </p>
          {movedCoin !== null && <ExplorerLink coinId={movedCoin} />}
          <button type="button" class="btn btn--primary" onClick={props.onClose}>
            {t.common.close}
          </button>
        </div>
      </Sheet>
    );
  }

  if (step === 'confirm' || step === 'moving') {
    return (
      <Sheet open title={t.wallet.klimperConfirmTitle} onClose={props.onClose}>
        <div class="stack">
          {/* What arrives in Klimper: everything here, less the network fee. */}
          <Amount mojos={quote?.arriving ?? null} rate={props.rate} align="left" />
          <FeeLine fee={quote?.fee ?? null} />
          <div class="field">
            <span class="field__label">{t.wallet.klimperTo}</span>
            <p class="address num">{address}</p>
          </div>
          <p class="soft">{t.wallet.klimperCheck}</p>
          {problem !== null && (
            <p class="notice" role="alert">
              {problem}
            </p>
          )}
          <button
            type="button"
            class="btn btn--primary btn--huge"
            aria-busy={step === 'moving'}
            disabled={step === 'moving' || quote === null}
            onClick={move}
          >
            {step === 'moving' ? t.wallet.klimperMoving : t.wallet.klimperMove}
          </button>
          <button type="button" class="btn btn--plain" onClick={() => setStep('form')}>
            {t.common.cancel}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open title={t.wallet.klimperTitle} onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setNudged(true);
          if (valid) {
            setQuote(null);
            setStep('confirm');
            services.wallet.quotePayment('all').then(setQuote, (error: unknown) => {
              setProblem(errorText(errorCode(error), t));
            });
          }
        }}
      >
        <p class="soft">{t.wallet.klimperBody}</p>
        <ol class="soft klimper-steps">
          <li>
            {t.wallet.klimperStepGet} <a href={KLIMPER_DOWNLOAD}>{t.wallet.backupGet}</a>
          </li>
          <li>{t.wallet.klimperStepReceive}</li>
          <li>{t.wallet.klimperStepPaste}</li>
        </ol>
        <label class="field">
          <span class="field__label">{t.wallet.klimperAddressLabel}</span>
          <input
            class="input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellcheck={false}
            placeholder="xch1…"
            value={to}
            aria-invalid={nudged && !valid}
            onInput={(event) => setTo(event.currentTarget.value)}
          />
          {nudged && !valid && <span class="field__error">{t.wallet.klimperInvalid}</span>}
        </label>
        <button type="submit" class="btn btn--primary" disabled={props.balance <= 0n}>
          {t.wallet.klimperNext}
        </button>
      </form>
    </Sheet>
  );
}
