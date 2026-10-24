// SPDX-License-Identifier: AGPL-3.0-or-later
// The hot path: a link from a chat lands here. Until it is opened there is only the envelope;
// then the ceremony runs and the words arrive one by one (timeline in styles/claim.css).
import { useEffect, useState } from 'preact/hooks';
import { Amount, amountLines } from '../../components/Amount';
import { Confetti } from '../../components/Confetti';
import { Envelope, type EnvelopeState } from '../../components/Envelope';
import { ExplorerLink } from '../../components/ExplorerLink';
import { TickIcon } from '../../components/icons';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import type { Rate } from '../../lib/money';
import { useRate } from '../../lib/use-rate';
import { navigate } from '../../router';
import { useServices } from '../../services/context';
import type { EnvelopeView } from '../../services/types';
import { preloadScreens } from '../lazy';
import type { ClaimNotice, ClaimState } from './claim-state';
import { useClaim } from './use-claim';

/** When the amount starts counting, after the ceremony: see the timeline in styles/claim.css. */
const COUNT_UP_DELAY_MS = 360 + 1500 + 3 * 170;
const BARS = 11;

function envelopeState(state: ClaimState): EnvelopeState {
  switch (state.s) {
    case 'opening':
      return 'opening';
    case 'opened':
      return 'open';
    case 'gone':
      return 'empty';
    case 'failed':
      return 'ghost';
    default:
      return 'sealed';
  }
}

function problemTitle(state: ClaimState & { s: 'gone' | 'failed' }, t: Dict): string {
  if (state.s === 'gone') {
    return state.reason === 'empty' ? t.claim.emptyTitle : t.claim.expiredTitle;
  }
  if (state.reason === 'bad_link') return t.claim.badTitle;
  if (state.reason === 'not_ready') return t.claim.notReadyTitle;
  return state.reason === 'network' ? t.claim.offlineTitle : t.claim.unknownTitle;
}

function noticeText(notice: ClaimNotice, t: Dict): string {
  if (notice === 'cancelled') return t.errors.cancelled;
  if (notice === 'no_passkey') return t.errors.passkeyUnavailable;
  return notice === 'network' ? t.errors.network : t.errors.unknown;
}

/** Raster bars across the whole screen, once: the machine announces the moment. */
function Bars() {
  return (
    <div class="bars" aria-hidden="true">
      {Array.from({ length: BARS }, (_, n) => (
        <i key={n} style={`--n:${n}`} />
      ))}
    </div>
  );
}

/** Everything the envelope had to say, told one line after the other. */
function RevealPanel(props: {
  view: EnvelopeView;
  amount: bigint;
  rate: Rate | null;
  fresh: boolean;
  confirmed: boolean;
  coinId?: string | undefined;
}) {
  const { t } = useI18n();
  const { amount, view, fresh } = props;
  return (
    <>
      {fresh ? (
        <h1 class="claim__from rv" style="--i:0">
          {view.from ? t.claim.from(view.from) : t.claim.fromNobody}
        </h1>
      ) : (
        <h1 class="claim__title rv" style="--i:0">
          {t.claim.alreadyTitle}
        </h1>
      )}
      {fresh && view.message && (
        <p class="claim__message rv" style="--i:1">
          {view.message}
        </p>
      )}
      <span class="claim__rule rv" style="--i:2" aria-hidden="true" />
      <div class="rv" style="--i:3">
        <Amount
          mojos={amount}
          rate={props.rate}
          countUp={fresh}
          countUpDelayMs={COUNT_UP_DELAY_MS}
        />
      </div>
      <div class="rv" style="--i:4">
        {props.confirmed ? (
          <p class="claim__status claim__status--done">
            <TickIcon />
            {t.claim.arrived}
          </p>
        ) : (
          <p class="claim__status">
            <span class="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t.claim.onItsWay}
          </p>
        )}
        {props.coinId !== undefined && <ExplorerLink coinId={props.coinId} />}
      </div>
      {props.fresh && (
        <p class="claim__note soft rv" style="--i:5">
          {t.claim.backupNote}
        </p>
      )}
      <div class="claim__actions rv" style="--i:5">
        <button
          type="button"
          class="btn btn--primary"
          onClick={() => navigate(`/new?amount=${amount}`)}
        >
          {t.claim.sendOn}
        </button>
        <div class="row">
          <button type="button" class="btn" onClick={() => navigate('/')}>
            {t.claim.keep}
          </button>
          <button type="button" class="btn" disabled>
            {t.claim.play}
            <span class="tag">{t.common.comingSoon}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function ProblemPanel(props: {
  state: ClaimState & { s: 'gone' | 'failed' };
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const { state } = props;
  const body =
    state.s === 'gone'
      ? state.reason === 'empty'
        ? t.claim.emptyBody
        : t.claim.expiredBody
      : state.reason === 'bad_link'
        ? t.claim.badBody
        : state.reason === 'not_ready'
          ? t.claim.notReadyBody
          : state.reason === 'network'
            ? t.claim.offlineBody
            : t.claim.unknownBody;
  const canRetry = state.s === 'failed' && state.reason !== 'bad_link';
  return (
    <>
      <h1 class="claim__title rv" style="--i:0">
        {problemTitle(state, t)}
      </h1>
      <p class="rv" style="--i:1" role={state.s === 'failed' ? 'alert' : undefined}>
        {body}
      </p>
      {canRetry ? (
        <button type="button" class="btn btn--primary" onClick={props.onRetry}>
          {t.common.retry}
        </button>
      ) : (
        <button type="button" class="btn btn--primary" onClick={() => navigate('/new')}>
          {t.claim.makeOwn}
        </button>
      )}
    </>
  );
}

export function ClaimScreen(props: { link: string }) {
  const { t, locale } = useI18n();
  const { rate } = useRate();
  const { state, open, openWithNewPasskey, retry } = useClaim(props.link);
  // The coin that paid for the envelope: on the explorer it lists every share, opened or not.
  const envelopeCoin = 'view' in state && state.view !== null ? state.view.fundingCoinId : null;
  const opened = state.s === 'opened';
  const fresh = opened && state.fresh;
  // Until it is opened there is nothing on the page but the envelope.
  const told = opened || state.s === 'gone' || state.s === 'failed';

  useEffect(() => {
    if (opened) preloadScreens();
  }, [opened]);

  return (
    <div class={`claim${told ? ' claim--told' : ''}${fresh ? ' claim--fresh' : ''}`}>
      {!told && <h1 class="sr-only">{t.claim.sealedTitle}</h1>}
      <div class="claim__stage">
        {told || state.s === 'loading' ? (
          <div class="claim__tap">
            <Envelope state={envelopeState(state)} />
          </div>
        ) : (
          <button
            type="button"
            class="claim__tap"
            aria-label={t.claim.open}
            disabled={state.s === 'opening'}
            onClick={open}
          >
            <Envelope state={envelopeState(state)} />
          </button>
        )}
        {state.s === 'sealed' && (
          <p class="claim__cue" aria-hidden="true">
            {t.claim.cue}
          </p>
        )}
        {state.s === 'opening' && <p class="claim__cue claim__cue--now">{t.claim.opening}</p>}
        {fresh && <Bars />}
        {fresh && <Confetti />}
      </div>
      <div class="claim__panel">
        {state.s === 'sealed' && state.notice && (
          <p class="notice notice--calm" role="alert">
            {noticeText(state.notice, t)}
          </p>
        )}
        {state.s === 'sealed' &&
          (state.notice === 'no_passkey' || state.notice === 'cancelled') && (
            <>
              <p class="soft">{t.wallet.newPasskeyNote}</p>
              <button type="button" class="btn" onClick={openWithNewPasskey}>
                {t.wallet.newPasskey}
              </button>
            </>
          )}
        {state.s === 'opening' && <p class="claim__hint">{t.claim.openingHint}</p>}
        {state.s === 'opened' && (
          <RevealPanel
            view={state.view}
            amount={state.amount}
            rate={rate}
            fresh={state.fresh}
            confirmed={state.confirmed}
            coinId={state.coinId}
          />
        )}
        {(state.s === 'gone' || state.s === 'failed') && (
          <ProblemPanel state={state} onRetry={retry} />
        )}
      </div>
      {envelopeCoin !== null && (
        <p class="claim__explorer">
          <ExplorerLink coinId={envelopeCoin} label={t.claim.explorer} />
        </p>
      )}
      <output class="sr-only" aria-live="polite">
        {fresh ? t.claim.announce(amountLines(state.amount, rate, locale).main) : ''}
      </output>
    </div>
  );
}
