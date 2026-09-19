// SPDX-License-Identifier: AGPL-3.0-or-later
// The hot path: a link from a chat lands here. Sealed envelope, one button, the amount.
import { useEffect } from 'preact/hooks';
import { Amount, amountLines } from '../../components/Amount';
import { Confetti } from '../../components/Confetti';
import { Envelope, type EnvelopeState } from '../../components/Envelope';
import { TickIcon } from '../../components/icons';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import type { Rate } from '../../lib/money';
import { useRate } from '../../lib/use-rate';
import { navigate } from '../../router';
import type { EnvelopeView } from '../../services/types';
import { preloadScreens } from '../lazy';
import type { ClaimNotice, ClaimState } from './claim-state';
import { useClaim } from './use-claim';

const MAX_PIPS = 12;

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

function heading(state: ClaimState, t: Dict): string {
  switch (state.s) {
    case 'loading':
      return t.common.loading;
    case 'gone':
      return state.reason === 'empty' ? t.claim.emptyTitle : t.claim.expiredTitle;
    case 'failed':
      if (state.reason === 'bad_link') return t.claim.badTitle;
      if (state.reason === 'not_ready') return t.claim.notReadyTitle;
      return state.reason === 'network' ? t.claim.offlineTitle : t.claim.unknownTitle;
    case 'opened':
      if (!state.fresh) return t.claim.alreadyTitle;
      return state.view.from ? t.claim.from(state.view.from) : t.claim.fromNobody;
    default:
      return state.view.from ? t.claim.from(state.view.from) : t.claim.fromNobody;
  }
}

function noticeText(notice: ClaimNotice, t: Dict): string {
  if (notice === 'cancelled') return t.errors.cancelled;
  return notice === 'network' ? t.errors.network : t.errors.unknown;
}

function SharesLeft(props: { view: EnvelopeView }) {
  const { t } = useI18n();
  const { sharesLeft, sharesTotal } = props.view;
  return (
    <p class="claim__left">
      {sharesTotal <= MAX_PIPS && (
        <span class="pips" aria-hidden="true">
          {Array.from({ length: sharesTotal }, (_, i) => (
            <i key={i} class={i < sharesLeft ? 'pip pip--on' : 'pip'} />
          ))}
        </span>
      )}
      <span class="num">{t.claim.sharesLeft(sharesLeft, sharesTotal)}</span>
    </p>
  );
}

function SealedPanel(props: {
  view: EnvelopeView;
  notice: ClaimNotice | null;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {props.view.message && <p class="claim__message">{props.view.message}</p>}
      <SharesLeft view={props.view} />
      {props.notice && (
        <p class="notice notice--calm" role="alert">
          {noticeText(props.notice, t)}
        </p>
      )}
      <button type="button" class="btn btn--primary btn--huge" onClick={props.onOpen}>
        {t.claim.open}
      </button>
    </>
  );
}

function RevealPanel(props: {
  amount: bigint | null;
  rate: Rate | null;
  fresh: boolean;
  confirmed: boolean;
}) {
  const { t } = useI18n();
  const { amount } = props;
  return (
    <>
      <p class="eyebrow">
        {amount === null ? t.claim.opening : props.fresh ? t.claim.youGot : t.claim.alreadyBody}
      </p>
      <Amount mojos={amount} rate={props.rate} countUp={props.fresh} />
      {amount === null ? (
        <p class="claim__hint">{t.claim.openingHint}</p>
      ) : props.confirmed ? (
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
      {amount !== null && (
        <div class="claim__actions">
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
      )}
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
      <p role={state.s === 'failed' ? 'alert' : undefined}>{body}</p>
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
  const { state, open, retry } = useClaim(props.link);
  const opened = state.s === 'opened';

  useEffect(() => {
    if (opened) preloadScreens();
  }, [opened]);

  return (
    <div class="claim">
      <h1 class="claim__from">
        {state.s === 'loading' ? (
          <span class="sr-only">{t.common.loading}</span>
        ) : (
          heading(state, t)
        )}
      </h1>
      <div class="claim__stage">
        <Envelope state={envelopeState(state)} />
        {opened && state.fresh && <Confetti />}
      </div>
      <div class="claim__panel">
        {state.s === 'loading' && <span class="skeleton" style="height:76px;margin-top:52px" />}
        {state.s === 'sealed' && (
          <SealedPanel view={state.view} notice={state.notice} onOpen={open} />
        )}
        {state.s === 'opening' && <RevealPanel amount={null} rate={rate} fresh confirmed={false} />}
        {state.s === 'opened' && (
          <RevealPanel
            amount={state.amount}
            rate={rate}
            fresh={state.fresh}
            confirmed={state.confirmed}
          />
        )}
        {(state.s === 'gone' || state.s === 'failed') && (
          <ProblemPanel state={state} onRetry={retry} />
        )}
      </div>
      <output class="sr-only" aria-live="polite">
        {opened && state.fresh
          ? t.claim.announce(amountLines(state.amount, rate, locale).main)
          : ''}
      </output>
    </div>
  );
}
