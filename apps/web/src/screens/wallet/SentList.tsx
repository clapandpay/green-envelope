// SPDX-License-Identifier: AGPL-3.0-or-later
// The envelopes this person made: cards with progress, not a table.
import { useState } from 'preact/hooks';
import { CopyButton } from '../../components/CopyButton';
import { EnvelopeMark } from '../../components/Envelope';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import { errorCode, errorText } from '../../lib/errors';
import { formatMoney, type Rate } from '../../lib/money';
import { useServices } from '../../services/context';
import type { SentEnvelope } from '../../services/types';

const MAX_SEGMENTS = 20;

function statusText(status: SentEnvelope['status'], t: Dict): string {
  switch (status) {
    case 'pending':
      return t.wallet.statusPending;
    case 'active':
      return t.wallet.statusActive;
    case 'finished':
      return t.wallet.statusFinished;
    case 'taken_back':
      return t.wallet.statusTakenBack;
  }
}

/** Can anything still come back from this envelope? Pure. */
export function canTakeBack(envelope: SentEnvelope): boolean {
  const open = envelope.status === 'active' || envelope.status === 'pending';
  return open && envelope.sharesOpened < envelope.sharesTotal;
}

/** Is this envelope over (all opened, or taken back), so it can leave the list? Pure. */
export function canRemove(envelope: SentEnvelope): boolean {
  return envelope.status === 'finished' || envelope.status === 'taken_back';
}

function Progress(props: { opened: number; total: number }) {
  const { opened, total } = props;
  if (total > MAX_SEGMENTS) {
    return (
      <div class="progress" aria-hidden="true">
        <i class="progress__bar" style={`width:${(opened / total) * 100}%`} />
      </div>
    );
  }
  return (
    <div class="progress progress--segments" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} class={i < opened ? 'progress__seg progress__seg--on' : 'progress__seg'} />
      ))}
    </div>
  );
}

export function SentList(props: {
  envelopes: SentEnvelope[];
  rate: Rate | null;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const services = useServices();
  const [asking, setAsking] = useState<SentEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const takeBack = async (envelope: SentEnvelope) => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await services.envelopes.takeBack(envelope.id);
      setAsking(null);
      props.onChanged();
      result.confirmed.then(props.onChanged, () => {});
    } catch (error) {
      setFailure(errorText(errorCode(error), t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (envelope: SentEnvelope) => {
    try {
      await services.envelopes.remove(envelope.id);
    } finally {
      props.onChanged();
    }
  };

  if (props.envelopes.length === 0) return <p class="soft">{t.wallet.sentEmpty}</p>;

  return (
    <>
      <ul class="stack">
        {props.envelopes.map((envelope) => (
          <li key={envelope.id} class={`sent sent--${envelope.status}`}>
            <div class="sent__top">
              <EnvelopeMark />
              <strong class="num sent__total">
                {formatMoney(envelope.total, props.rate, locale)}
              </strong>
              <span class="sent__status">{statusText(envelope.status, t)}</span>
            </div>
            <Progress opened={envelope.sharesOpened} total={envelope.sharesTotal} />
            <p class="num sent__count">
              {t.wallet.opened(envelope.sharesOpened, envelope.sharesTotal)}
            </p>
            {canTakeBack(envelope) && (
              <div class="sent__actions">
                <CopyButton text={envelope.link} label={t.create.copyLink} class="btn btn--small" />
                <button type="button" class="btn btn--small" onClick={() => setAsking(envelope)}>
                  {t.wallet.takeBack}
                </button>
              </div>
            )}
            {canRemove(envelope) && (
              <div class="sent__actions">
                <button
                  type="button"
                  class="btn btn--small btn--plain"
                  aria-label={t.wallet.removeLabel}
                  onClick={() => remove(envelope)}
                >
                  {t.wallet.remove}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {asking && (
        <Sheet open title={t.wallet.takeBackTitle} onClose={() => setAsking(null)}>
          <div class="stack">
            <p>
              {t.wallet.takeBackBody(
                formatMoney(asking.total - asking.amountOpened, props.rate, locale),
              )}
            </p>
            {failure && (
              <p class="notice" role="alert">
                {failure}
              </p>
            )}
            <button
              type="button"
              class="btn btn--primary"
              aria-busy={busy}
              disabled={busy}
              onClick={() => takeBack(asking)}
            >
              {busy ? t.wallet.takingBack : t.wallet.takeBackConfirm}
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => setAsking(null)}>
              {t.common.cancel}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
