// SPDX-License-Identifier: AGPL-3.0-or-later
// Send: who and how much, then one look at the whole recipient before it goes.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Amount } from '../../components/Amount';
import { AmountField, type AmountValue } from '../../components/AmountField';
import { ExplorerLink } from '../../components/ExplorerLink';
import { FeeLine } from '../../components/FeeLine';
import { TickIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import {
  checkAmount,
  type RecipientCandidate,
  recipientKind,
  scanRecipients,
} from '../../lib/envelope-form';
import { errorCode, errorText } from '../../lib/errors';
import type { Rate } from '../../lib/money';
import { useServices } from '../../services/context';
import type { Balance, HandleLookup } from '../../services/types';

type Step = 'form' | 'confirm' | 'sending' | 'done';

/** What the registry says about the @name being typed. */
type Lookup =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'ok'; value: HandleLookup }
  | { s: 'failed'; text: string };

/** Typing pause before an @name is looked up. */
const LOOKUP_DEBOUNCE_MS = 400;

/** What an `@name` stands for: the address, and anything worth pausing over. */
function HandleResolution(props: { lookup: Lookup; t: Dict }) {
  const { lookup, t } = props;
  if (lookup.s === 'idle') return null;
  if (lookup.s === 'loading') {
    return <span class="field__hint">{t.wallet.handleLooking}</span>;
  }
  if (lookup.s === 'failed') {
    return <span class="field__error">{lookup.text}</span>;
  }
  const { handle, address, pendingTransfer, imitates } = lookup.value;
  return (
    <span class="resolved">
      <span class="resolved__line">
        <TickIcon />
        <span>
          <strong>@{handle}</strong> {t.wallet.handleGoesTo}
        </span>
      </span>
      <span class="address num">{address}</span>
      {pendingTransfer && <span class="resolved__warn">{t.wallet.handleMoving}</span>}
      {imitates !== null && (
        <span class="resolved__warn resolved__warn--loud" role="alert">
          {t.wallet.handleLookalike(imitates)}
        </span>
      )}
    </span>
  );
}

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
  const [sentCoin, setSentCoin] = useState<string | null>(null);
  /** The fee of this payment, worked out before it is confirmed, and then paid as shown. */
  const [fee, setFee] = useState<bigint | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState<AmountValue>({ text: '', unit: rate ? 'eur' : 'xch' });
  const [nudged, setNudged] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Candidates found in one messy paste, and which of them is suggested.
  const [choices, setChoices] = useState<RecipientCandidate[]>([]);
  const [picking, setPicking] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ s: 'idle' });
  /** Counts pastes, so a slow answer to an old one is dropped. */
  const pasteRef = useRef(0);

  const recipient = to.trim();
  const kind = recipientKind(recipient);

  // An @name is only a recipient once the registry says what it pays. An address stands alone.
  const recipientOk = kind === 'address' || (kind === 'handle' && lookup.s === 'ok');

  // Look the name up while the person is still typing, but only after they pause: every
  // keystroke would be a request, and an unfinished name is always "nobody has that".
  useEffect(() => {
    if (kind !== 'handle') {
      setLookup({ s: 'idle' });
      return;
    }
    setLookup({ s: 'loading' });
    let alive = true;
    const timer = setTimeout(() => {
      services.wallet.lookupHandle(recipient).then(
        (value) => alive && setLookup({ s: 'ok', value }),
        (error) => alive && setLookup({ s: 'failed', text: errorText(errorCode(error), t) }),
      );
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [recipient, kind, services, t]);
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
    if (recipientOk && check.total !== null && check.error === null) {
      const amount = check.total;
      setFee(null);
      setStep('confirm');
      services.wallet.quotePayment(amount).then(
        (quote) => setFee(quote.fee),
        (error: unknown) => {
          setFailure(errorText(errorCode(error), t));
          setStep('form');
        },
      );
    }
  };

  /**
   * People paste a whole line out of a chat: "ok send it to @anna 🙏", an address with a full
   * stop stuck to it, or two addresses where the message says which. Code finds every candidate
   * and checks its shape; one is used straight away, and only a genuine choice is asked about.
   */
  const onPaste = (event: ClipboardEvent) => {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (pasted === '') return;
    const found = scanRecipients(pasted);
    if (found.length === 0) return; // nothing we recognise: let the paste happen as usual

    event.preventDefault();
    setChoices([]);
    if (found.length === 1) {
      setTo(found[0]?.value ?? '');
      return;
    }

    const first = found[0]?.value ?? '';
    setTo(first);
    setChoices(found);
    setPicking(true);
    // The answer arrives after the picker is already on screen and tappable. If the person has
    // chosen by then — or pasted again — their choice stands: a suggestion that quietly
    // replaces a recipient somebody just picked is the one thing this must never do.
    const ticket = ++pasteRef.current;
    services.wallet
      .pickRecipient(
        pasted,
        found.map((candidate) => candidate.value),
      )
      .then((pick) => {
        if (ticket !== pasteRef.current) return;
        setTo((current) => (current === first && pick?.value != null ? pick.value : current));
      })
      .catch(() => {})
      .finally(() => {
        if (ticket === pasteRef.current) setPicking(false);
      });
  };

  const send = async () => {
    if (check.total === null) return;
    setStep('sending');
    setFailure(null);
    try {
      // An @name pays exactly the address shown on the confirm step.
      const shown = kind === 'handle' && lookup.s === 'ok' ? lookup.value.address : undefined;
      if (kind === 'handle' && shown === undefined) return;
      const result = await services.wallet.send(recipient, check.total, fee ?? undefined, shown);
      setSentCoin(result.coinId);
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
          {sentCoin !== null && <ExplorerLink coinId={sentCoin} />}
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
              {lookup.s === 'ok' && <p class="address num soft">{lookup.value.address}</p>}
            </div>
          </div>
          <FeeLine
            fee={fee}
            total={fee === null || check.total === null ? null : check.total + fee}
          />
          {lookup.s === 'ok' && lookup.value.imitates !== null && (
            <p class="notice" role="alert">
              {t.wallet.handleLookalike(lookup.value.imitates)}
            </p>
          )}
          <p class="soft">{t.wallet.confirmWarn}</p>
          <button
            type="button"
            class="btn btn--primary btn--huge"
            aria-busy={step === 'sending'}
            disabled={step === 'sending' || fee === null}
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
            onPaste={onPaste}
          />
          <span class="field__hint" aria-live="polite">
            {kind === 'handle' ? (
              <HandleResolution lookup={lookup} t={t} />
            ) : (
              nudged && !recipientOk && <span class="field__error">{t.wallet.toInvalid}</span>
            )}
          </span>
        </label>
        {choices.length > 1 && (
          <fieldset class="field pick">
            <legend class="field__label">
              {picking ? t.wallet.pickWorking : t.wallet.pickLabel}
            </legend>
            <div class="pick__list">
              {choices.map((candidate) => (
                <button
                  key={candidate.value}
                  type="button"
                  class="pick__option num"
                  aria-pressed={to.trim() === candidate.value}
                  onClick={() => setTo(candidate.value)}
                >
                  {candidate.value}
                </button>
              ))}
            </div>
          </fieldset>
        )}
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
