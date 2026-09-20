// SPDX-License-Identifier: AGPL-3.0-or-later
// The small wallet: what you have, three things you can do, the envelopes you made.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Amount } from '../../components/Amount';
import { Envelope, type EnvelopeState } from '../../components/Envelope';
import { DownIcon, PlusIcon, UpIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import { errorCode, errorText } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { prefersReducedMotion } from '../../lib/motion';
import { useRate } from '../../lib/use-rate';
import { onLinkClick } from '../../router';
import { useServices } from '../../services/context';
import type { Balance, SentEnvelope, WalletInfo } from '../../services/types';
import { ReceiveSheet } from './ReceiveSheet';
import { SendSheet } from './SendSheet';
import { SentList } from './SentList';
import '../../styles/wallet.css';

const REFRESH_MS = 8000;
/**
 * How long the opened envelope is held before the wallet takes its place. The flap takes
 * 260 + 420 ms and the note inside only starts rising at +520 ms over 900 ms, so anything
 * shorter than this cuts the envelope off before the money is out of it.
 */
const OPEN_HOLD_MS = 1500;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface WalletData {
  wallet: WalletInfo | null;
  balance: Balance | null;
  sent: SentEnvelope[];
  canSecure: boolean;
  /** False when logging out would take the money with it. */
  restorable: boolean;
}

type Load = { s: 'loading' } | { s: 'failed'; message: string } | ({ s: 'ready' } & WalletData);

export function WalletScreen() {
  const { t, locale } = useI18n();
  const services = useServices();
  const { rate } = useRate();
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [sheet, setSheet] = useState<'receive' | 'send' | 'out' | null>(null);
  const [working, setWorking] = useState<'start' | 'secure' | 'make' | 'out' | null>(null);
  /** Shown once opening found nothing: the two things that could have meant. */
  const [offering, setOffering] = useState(false);
  const [opened, setOpened] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const wallet = await services.wallet.current();
      const data: WalletData = wallet
        ? await Promise.all([
            services.wallet.balance(),
            services.envelopes.listSent(),
            services.wallet.canUpgradeToPasskey(),
            services.wallet.canRestoreElsewhere(),
          ]).then(([balance, sent, canSecure, restorable]) => ({
            wallet,
            balance,
            sent,
            canSecure,
            restorable,
          }))
        : { wallet: null, balance: null, sent: [], canSecure: false, restorable: false };
      if (alive.current) setLoad({ s: 'ready', ...data });
    } catch (error) {
      // Keep what is on screen when a background refresh fails.
      if (alive.current) {
        setLoad((current) =>
          current.s === 'ready'
            ? current
            : { s: 'failed', message: errorText(errorCode(error), t) },
        );
      }
    }
  }, [services, t]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  // While money is on the move, look again every few seconds.
  const moving = load.s === 'ready' && load.balance !== null && load.balance.pending !== 0n;
  const settling =
    load.s === 'ready' && load.sent.some((envelope) => envelope.status === 'pending');
  useEffect(() => {
    if (!moving && !settling) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [moving, settling, refresh]);

  const run = async (kind: 'start' | 'secure' | 'make' | 'out') => {
    setWorking(kind);
    setMessage(null);
    try {
      if (kind === 'start' || kind === 'make') {
        // `open` never creates, so nothing here can turn a returning person into a second,
        // empty wallet. `ensure` is the asked-for step that makes one.
        if (kind === 'make') await services.wallet.ensure();
        else await services.wallet.open();
        setOpened(true);
        // The balance, the envelopes and the two probes are fetched **while** the envelope
        // opens, not after it. The animation is then the waiting, instead of something a
        // person sits through before the waiting starts: whichever takes longer sets the
        // pace, and a quick network still gets the full turn of the flap.
        //
        // `working` stays set throughout. Clearing it here would re-enable the envelope for
        // the length of the hold while the screen still shows it, and a second tap would ask
        // for a face again right after a successful one.
        await Promise.all([refresh(), pause(prefersReducedMotion() ? 0 : OPEN_HOLD_MS)]);
      } else if (kind === 'out') {
        await services.wallet.forget();
        setSheet(null);
        setOpened(false);
        await refresh();
      } else {
        await services.wallet.upgradeToPasskey();
        setMessage({ tone: 'good', text: t.wallet.secured });
        await refresh();
      }
    } catch (error) {
      setOpened(false);
      // Nothing to open, or a prompt that was dismissed: WebAuthn says the same thing either
      // way, so the screen stops guessing and asks.
      setOffering(true);
      setMessage({ tone: 'bad', text: errorText(errorCode(error), t) });
    } finally {
      setWorking(null);
    }
  };

  if (load.s === 'loading') {
    return (
      <div class="stack" aria-busy="true">
        <h1 class="title">{t.wallet.title}</h1>
        <span class="skeleton" style="height:150px" />
        <span class="skeleton" style="height:76px" />
      </div>
    );
  }

  if (load.s === 'failed') {
    return (
      <div class="stack">
        <h1 class="title">{t.wallet.title}</h1>
        <p class="notice" role="alert">
          {load.message}
        </p>
        <button
          type="button"
          class="btn btn--primary"
          onClick={() => {
            setLoad({ s: 'loading' });
            refresh();
          }}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  // sealed invites the tap, opening plays while the phone asks, open is the reward held for a
  // moment before the wallet itself arrives.
  const firstRunEnvelope: EnvelopeState = opened
    ? 'open'
    : working === 'start'
      ? 'opening'
      : 'sealed';

  const notice = message && (
    <p class={message.tone === 'good' ? 'notice notice--calm' : 'notice'} role="alert">
      {message.text}
    </p>
  );

  if (load.wallet === null) {
    // Nothing but the envelope: one tap unlocks what is here, adopts the passkey this person
    // already has, or makes a new wallet. The animation and the passkey call start together,
    // because a timer between the tap and `navigator.credentials` loses the user activation
    // that Safari insists on.
    return (
      <div class={`first-run${opened ? ' first-run--opened' : ''}`}>
        <h1 class="sr-only">{t.wallet.firstRunTitle}</h1>
        <button
          type="button"
          class="first-run__open"
          aria-label={t.wallet.firstRunTitle}
          aria-busy={working === 'start'}
          // The envelope alone keeps the broad guard: a second tap here would ask for a face
          // again. The dashboard's buttons each answer for their own action, so none of them
          // sits inert while something unrelated finishes.
          disabled={working !== null}
          onClick={() => run('start')}
        >
          <span class="first-run__stage">
            <Envelope state={firstRunEnvelope} />
          </span>
          {/* The one instruction on the screen, and it waits a beat before asking. */}
          <span
            class={`first-run__cue${working === null && !opened ? '' : ' first-run__cue--now'}`}
          >
            {opened
              ? t.wallet.firstRunOpened
              : working === 'start'
                ? t.wallet.starting
                : t.wallet.firstRunCue}
          </span>
        </button>
        {notice}
        {offering && (
          <div class="first-run__choice">
            <button
              type="button"
              class="btn btn--primary"
              aria-busy={working === 'make'}
              disabled={working !== null}
              onClick={() => run('make')}
            >
              {t.wallet.firstRunMake}
            </button>
            <button
              type="button"
              class="btn"
              disabled={working !== null}
              onClick={() => run('start')}
            >
              {t.wallet.firstRunRetry}
            </button>
          </div>
        )}
      </div>
    );
  }

  const { balance } = load;
  const pending = balance?.pending ?? 0n;
  return (
    <div class="stack wallet">
      <section class="card balance" aria-labelledby="balance-title">
        {/* The amount is the heading. Naming it "Your money" above it says the same thing
            twice, so the words stay for screen readers and leave the screen to the number. */}
        <h1 id="balance-title" class="sr-only">
          {t.wallet.title}
        </h1>
        <Amount mojos={balance?.confirmed ?? null} rate={rate} align="left" />
        <p class="balance__pending num" aria-live="polite">
          {pending !== 0n && (
            <>
              <span class="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t.wallet.onTheMove(formatMoney(pending < 0n ? -pending : pending, rate, locale))}
            </>
          )}
        </p>
      </section>

      <a class="btn btn--primary btn--huge" href="/new" onClick={onLinkClick}>
        <PlusIcon />
        {t.wallet.newEnvelope}
      </a>
      <div class="row">
        <button type="button" class="btn" onClick={() => setSheet('receive')}>
          <DownIcon />
          {t.wallet.receive}
        </button>
        <button type="button" class="btn" onClick={() => setSheet('send')}>
          <UpIcon />
          {t.wallet.send}
        </button>
      </div>

      {notice}
      {load.canSecure && (
        // One line and one tap. It explains itself by what it does — the phone asks for a face
        // or a finger — and it is gone the moment it has been done, because `canUpgradeToPasskey`
        // is false once the wallet is behind a passkey.
        <button
          type="button"
          class="btn wallet__secure"
          aria-busy={working === 'secure'}
          disabled={working === 'secure'}
          onClick={() => run('secure')}
        >
          {working === 'secure' ? t.wallet.securing : t.wallet.secureAction}
        </button>
      )}

      <section class="stack" aria-labelledby="sent-title">
        <h2 id="sent-title" class="wallet__h2 wallet__h2--list">
          {t.wallet.sentTitle}
        </h2>
        <SentList envelopes={load.sent} rate={rate} onChanged={refresh} />
      </section>

      <button type="button" class="btn btn--plain wallet__out" onClick={() => setSheet('out')}>
        {t.wallet.logOut}
      </button>

      {sheet === 'out' && (
        <Sheet open title={t.wallet.logOutTitle} onClose={() => setSheet(null)}>
          <div class="stack">
            {/* What logging out costs is not the same for everyone, so neither is the warning. */}
            <p
              class={load.restorable ? 'soft' : 'notice'}
              role={load.restorable ? undefined : 'alert'}
            >
              {load.restorable ? t.wallet.logOutSafe : t.wallet.logOutLoses}
            </p>
            {!load.restorable && load.canSecure && (
              <button
                type="button"
                class="btn btn--primary"
                disabled={working === 'secure'}
                onClick={() => {
                  setSheet(null);
                  run('secure');
                }}
              >
                {t.wallet.secureAction}
              </button>
            )}
            <button
              type="button"
              class="btn"
              aria-busy={working === 'out'}
              disabled={working === 'out'}
              onClick={() => run('out')}
            >
              {working === 'out' ? t.wallet.loggingOut : t.wallet.logOutConfirm}
            </button>
            <button type="button" class="btn btn--plain" onClick={() => setSheet(null)}>
              {t.common.cancel}
            </button>
          </div>
        </Sheet>
      )}

      {sheet === 'receive' && (
        <ReceiveSheet address={load.wallet.address} onClose={() => setSheet(null)} />
      )}
      {sheet === 'send' && (
        <SendSheet
          rate={rate}
          balance={balance}
          onClose={() => setSheet(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
