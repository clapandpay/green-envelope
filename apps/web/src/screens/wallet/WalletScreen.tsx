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
import { relyingPartyId } from '../../lib/relying-party';
import { useRate } from '../../lib/use-rate';
import { onLinkClick } from '../../router';
import { useServices } from '../../services/context';
import type { Balance, SentEnvelope, WalletInfo } from '../../services/types';
import { KlimperSheet } from './KlimperSheet';
import { ReceiveSheet } from './ReceiveSheet';
import { SendSheet } from './SendSheet';
import { SentList } from './SentList';
import '../../styles/wallet.css';

const REFRESH_MS = 8000;
/**
 * How long the opened envelope is held before the wallet takes its place.
 *
 * This is the ceremony's own length plus a breath, and the two are written down together:
 * styles/wallet.css tightens the opening to 980 ms for this screen, so the sun finishes
 * swelling and the note finishes rising before anything replaces them.
 *
 * It used to be 1500 ms against a 1720 ms opening, and every motion was cut. It survived
 * because `refresh` was slow enough to overrun the hold — so making the loading fast is what
 * exposed it. The wait is deliberate now rather than borrowed from a slow network.
 */
const OPEN_HOLD_MS = 1040;

/** The site the passkey belongs to: clapandpay.com in production, the page's own host elsewhere. */
const passkeyDomain = () => relyingPartyId(location.hostname) ?? location.hostname;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface WalletData {
  wallet: WalletInfo | null;
  /** Null while the chain is still being asked; the amount shows a skeleton until then. */
  balance: Balance | null;
  /** Null while still loading, which is not the same as "none yet". */
  sent: SentEnvelope[] | null;
  /** False when logging out would take the money with it. */
  restorable: boolean;
  /** A second account can be opened: there is a passkey here to replace. */
  canMakeNew: boolean;
  /** Money in the old wallet (keys in the browser), to move into the vault once. */
  earlier: { balance: bigint } | null;
}

/** Errors after which "create a new passkey" is offered: the passkey did not open a wallet. */
const PASSKEY_FAILED: ReadonlySet<string> = new Set([
  'wallet_cancelled',
  'no_wallet_here',
  'passkey_unavailable',
  'unknown',
]);

type Load = { s: 'loading' } | { s: 'failed'; message: string } | ({ s: 'ready' } & WalletData);

/** What a button on this screen is busy doing. */
type Work = 'start' | 'fresh' | 'new' | 'out' | 'move';

export function WalletScreen() {
  const { t, locale } = useI18n();
  const services = useServices();
  const { rate } = useRate();
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [sheet, setSheet] = useState<'receive' | 'send' | 'out' | 'new' | 'klimper' | null>(null);
  const [working, setWorking] = useState<Work | null>(null);
  /** The passkey failed or was not found: offer to make a new one (never a browser-only wallet). */
  const [offerNew, setOfferNew] = useState(false);
  const [opened, setOpened] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const alive = useRef(true);

  /**
   * Brings the screen up, then fills it in.
   *
   * Only two of these need the chain — the balance, and the sent list, which asks about every
   * envelope this person has made. Waiting for them before showing anything meant the opening
   * animation finished into a blank screen on a slow network. Everything the screen needs to
   * *exist* is local: who the wallet is, and two questions for the keystore. So that comes
   * first and the screen appears; the two slow answers land in it when they arrive, into a
   * skeleton that is already the right shape.
   */
  const refresh = useCallback(async () => {
    try {
      const wallet = await services.wallet.current();
      if (wallet === null) {
        if (alive.current) {
          setLoad({
            s: 'ready',
            wallet: null,
            balance: null,
            sent: [],
            restorable: false,
            canMakeNew: false,
            earlier: null,
          });
        }
        return;
      }
      const [restorable, canMakeNew] = await Promise.all([
        services.wallet.canRestoreElsewhere(),
        services.wallet.canMakeNew(),
      ]);
      if (!alive.current) return;
      setLoad((current) => ({
        s: 'ready',
        wallet,
        // A refresh keeps what is already on screen rather than blinking back to skeletons.
        balance: current.s === 'ready' ? current.balance : null,
        sent: current.s === 'ready' ? current.sent : null,
        restorable,
        canMakeNew,
        earlier: current.s === 'ready' ? current.earlier : null,
      }));

      const settle = <K extends 'balance' | 'sent' | 'earlier'>(key: K, value: WalletData[K]) => {
        if (!alive.current) return;
        setLoad((current) => (current.s === 'ready' ? { ...current, [key]: value } : current));
      };
      // Not awaited, and failing separately: a chain that will not answer about envelopes
      // must not take the balance down with it, or the screen with either.
      void services.wallet.balance().then(
        (balance) => settle('balance', balance),
        () => {},
      );
      void services.envelopes.listSent().then(
        (sent) => settle('sent', sent),
        () => {},
      );
      void services.wallet.earlier().then(
        (earlier) => settle('earlier', earlier),
        () => {},
      );
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
    load.s === 'ready' && (load.sent ?? []).some((envelope) => envelope.status === 'pending');
  useEffect(() => {
    if (!moving && !settling) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [moving, settling, refresh]);

  const run = async (kind: Work) => {
    setWorking(kind);
    setMessage(null);
    try {
      if (kind === 'start' || kind === 'fresh') {
        // One tap (owner, 2026-10-09): the wallet here, else the passkey the phone has, else
        // a new one, whose creation the phone's own sheet asks about. When that fails, the
        // person can make a new passkey ('fresh'). Never a browser-only wallet.
        if (kind === 'fresh') await services.wallet.makeNew();
        else await services.wallet.ensure();
        setOfferNew(false);
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
        // The ceremony is over; the wallet, loaded behind it, takes the stage.
        setOpened(false);
      } else if (kind === 'out') {
        await services.wallet.forget();
        setSheet(null);
        setOpened(false);
        await refresh();
      } else if (kind === 'move') {
        const moved = await services.wallet.moveEarlier();
        setMessage({
          tone: 'good',
          text: moved.more ? t.wallet.earlierMore : t.wallet.earlierMoved,
        });
        await refresh();
      } else {
        await services.wallet.makeNew();
        setSheet(null);
        await refresh();
      }
    } catch (error) {
      setOpened(false);
      const code = errorCode(error);
      if ((kind === 'start' || kind === 'fresh') && PASSKEY_FAILED.has(code)) setOfferNew(true);
      setMessage({ tone: 'bad', text: errorText(code, t) });
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

  // The envelope holds the screen while there is no wallet **and** while the ceremony is still
  // playing. Without that second clause the dashboard appears the instant `refresh` resolves,
  // which is now a few milliseconds, and the opening is cut off almost before it starts. The
  // hold was only ever a delay; this is what makes it a hold.
  if (load.wallet === null || opened) {
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
        {offerNew && (
          <div class="first-run__choice">
            <p class="soft">{t.wallet.newPasskeyNote}</p>
            <button
              type="button"
              class="btn"
              aria-busy={working === 'fresh'}
              disabled={working !== null}
              onClick={() => run('fresh')}
            >
              {working === 'fresh' ? t.wallet.newPasskeyWorking : t.wallet.newPasskey}
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
        {/* Always there, never dismissable: this wallet lives in a browser (docs/wallet-security.md). */}
        <p class="soft balance__note">{t.wallet.pocketNote}</p>
        <p class="soft balance__note">{t.wallet.passkeyNote(passkeyDomain())}</p>
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
      {(balance?.confirmed ?? 0n) > 0n && (
        // Never in the way: a passkey is the only key here, so larger amounts belong in
        // Klimper, a wallet with its own 24 words. Moving is a plain send to it.
        <section class="card stack" aria-labelledby="klimper-title">
          <h2 id="klimper-title" class="wallet__h2">
            {t.wallet.backupTitle}
          </h2>
          <p class="soft">{t.wallet.backupBody}</p>
          <button type="button" class="btn" onClick={() => setSheet('klimper')}>
            {t.wallet.klimperOpen}
          </button>
        </section>
      )}
      {load.earlier !== null && (
        <section class="card stack" aria-labelledby="earlier-title">
          <h2 id="earlier-title" class="wallet__h2">
            {t.wallet.earlierTitle}
          </h2>
          <p class="soft">
            {t.wallet.earlierBody(formatMoney(load.earlier.balance, rate, locale))}
          </p>
          <button
            type="button"
            class="btn btn--primary"
            aria-busy={working === 'move'}
            disabled={working === 'move'}
            onClick={() => run('move')}
          >
            {working === 'move' ? t.wallet.earlierMoving : t.wallet.earlierMove}
          </button>
        </section>
      )}

      <section class="stack" aria-labelledby="sent-title">
        <h2 id="sent-title" class="wallet__h2 wallet__h2--list">
          {t.wallet.sentTitle}
        </h2>
        {load.sent === null ? (
          <span class="skeleton" style="height:76px" aria-hidden="true" />
        ) : (
          <SentList envelopes={load.sent} rate={rate} onChanged={refresh} />
        )}
      </section>

      {load.canMakeNew && (
        <button type="button" class="btn btn--plain" onClick={() => setSheet('new')}>
          {t.wallet.newWallet}
        </button>
      )}
      <button type="button" class="btn btn--plain wallet__out" onClick={() => setSheet('out')}>
        {t.wallet.logOut}
      </button>

      {sheet === 'new' && (
        <Sheet open title={t.wallet.newWalletTitle} onClose={() => setSheet(null)}>
          <div class="stack">
            <p class="soft">{t.wallet.newWalletBody}</p>
            <button
              type="button"
              class="btn btn--primary"
              aria-busy={working === 'new'}
              disabled={working === 'new'}
              onClick={() => run('new')}
            >
              {working === 'new' ? t.wallet.newWalletWorking : t.wallet.newWalletConfirm}
            </button>
            <button type="button" class="btn btn--plain" onClick={() => setSheet(null)}>
              {t.common.cancel}
            </button>
          </div>
        </Sheet>
      )}

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
      {sheet === 'klimper' && (
        <KlimperSheet
          rate={rate}
          balance={balance?.confirmed ?? 0n}
          onClose={() => setSheet(null)}
          onChanged={refresh}
        />
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
