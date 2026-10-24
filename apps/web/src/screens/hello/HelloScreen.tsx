// SPDX-License-Identifier: AGPL-3.0-or-later
// The front door: one envelope, one button. The button asks the faucet (lib/faucet.ts) for a
// fresh envelope and walks the person into the ordinary claim route. Every state has a next
// action, and the hero stays on screen in all of them. Without a faucet there is nothing to give:
// /hello then goes straight to the app's start.
import '../../styles/hello.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Envelope, type EnvelopeState } from '../../components/Envelope';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import {
  type FaucetConfig,
  faucetConfig,
  PREF_FAUCET,
  parseRemembered,
  requestFaucet,
} from '../../lib/faucet';
import { readPref, writePref } from '../../lib/storage';
import { navigate, onLinkClick } from '../../router';

type Phase =
  | { s: 'ready' }
  | { s: 'fetching' }
  | { s: 'already'; path: string }
  | { s: 'empty' }
  | { s: 'limited'; until: number }
  | { s: 'offline' }
  | { s: 'broken' };

/** The deployment's faucet, or null: then /hello goes to the app's start. */
function configuredFaucet(): FaucetConfig | null {
  const env = import.meta.env;
  return faucetConfig(env.VITE_FAUCET_URL, env.VITE_FAUCET_ORIGINS, location.origin);
}

function heroState(phase: Phase['s']): EnvelopeState {
  if (phase === 'empty') return 'empty';
  if (phase === 'offline' || phase === 'broken') return 'ghost';
  return 'sealed';
}

// The envelope is drawn by the shared component; this only gives it a place to stand.
function Hero(props: { state: EnvelopeState }) {
  return (
    <div class="hello__hero">
      <Envelope state={props.state} />
    </div>
  );
}

function Steps() {
  const { t } = useI18n();
  return (
    <ol class="hello__steps" aria-label={t.hello.stepsLabel}>
      {t.hello.steps.map((step, n) => (
        <li key={step.title}>
          <span class="hello__num" aria-hidden="true">
            {n + 1}
          </span>
          <strong>{step.title}</strong>
          <span class="soft">{step.body}</span>
        </li>
      ))}
    </ol>
  );
}

function Extras() {
  const { t } = useI18n();
  return (
    <>
      <Steps />
      <details class="hello__what">
        <summary>{t.hello.whatTitle}</summary>
        <p>{t.hello.whatBody}</p>
      </details>
      <a class="hello__own" href="/new" onClick={onLinkClick}>
        {t.hello.makeOwn}
      </a>
    </>
  );
}

function messageFor(phase: Phase['s'], t: Dict): { title: string; body: string } | null {
  switch (phase) {
    case 'empty':
      return { title: t.hello.emptyTitle, body: t.hello.emptyBody };
    case 'limited':
      return { title: t.hello.limitedTitle, body: t.hello.limitedBody };
    case 'offline':
      return { title: t.hello.offlineTitle, body: t.hello.offlineBody };
    case 'broken':
      return { title: t.hello.brokenTitle, body: t.hello.brokenBody };
    default:
      return null;
  }
}

/** Seconds left until `until`, ticking once a second, and 0 when it is over. */
function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * No faucet on this deployment: no envelope to give, so no page to show. The visitor goes to the
 * app's start (their wallet, or where to begin), in place of /hello so "back" does not loop.
 */
function NoFaucet() {
  useEffect(() => {
    navigate('/', { replace: true });
  }, []);
  return null;
}

function LiveScreen(props: { faucet: FaucetConfig; fetcher?: typeof fetch }) {
  const { t } = useI18n();
  const { faucet, fetcher } = props;
  const [phase, setPhase] = useState<Phase>(() => {
    const path = parseRemembered(readPref(PREF_FAUCET), location.origin);
    return path === null ? { s: 'ready' } : { s: 'already', path };
  });
  const busy = useRef(false);
  const alive = useRef(true);
  const trap = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const left = useCountdown(phase.s === 'limited' ? phase.until : null);
  useEffect(() => {
    if (phase.s === 'limited' && left === 0) setPhase({ s: 'ready' });
  }, [phase.s, left]);

  async function get() {
    if (busy.current) return; // double click, double tap, Enter held down
    // A person never fills the hidden field. A script that fills every field gets "empty".
    if (trap.current && trap.current.value !== '') {
      setPhase({ s: 'empty' });
      return;
    }
    busy.current = true;
    setPhase({ s: 'fetching' });
    const result = await requestFaucet(faucet, fetcher);
    busy.current = false;
    if (result.kind === 'link') {
      // Remember it even if the person has already left: the envelope must not be lost.
      writePref(PREF_FAUCET, result.path);
      if (alive.current) navigate(result.path);
      return;
    }
    if (!alive.current) return;
    if (result.kind === 'limited') {
      setPhase({ s: 'limited', until: Date.now() + result.retryAfterSeconds * 1000 });
    } else {
      setPhase({ s: result.kind });
    }
  }

  const message = messageFor(phase.s, t);
  const fetching = phase.s === 'fetching';
  const label = fetching
    ? t.hello.getting
    : phase.s === 'limited'
      ? t.hello.limitedWait(left)
      : phase.s === 'empty'
        ? t.hello.emptyAgain
        : phase.s === 'offline' || phase.s === 'broken'
          ? t.common.retry
          : t.hello.get;

  return (
    <div class="hello">
      <p class="eyebrow">{t.hello.eyebrow}</p>
      <h1 class="title">{phase.s === 'already' ? t.hello.alreadyTitle : t.hello.title}</h1>
      <Hero state={heroState(phase.s)} />

      {phase.s === 'already' ? (
        <>
          <p>{t.hello.alreadyBody}</p>
          <button
            type="button"
            class="btn btn--primary btn--huge"
            onClick={() => navigate(phase.path)}
          >
            {t.hello.alreadyOpen}
          </button>
          <button type="button" class="btn" onClick={() => navigate('/')}>
            {t.hello.alreadyMoney}
          </button>
        </>
      ) : (
        <>
          {message ? (
            <div class="hello__note" role={phase.s === 'empty' ? 'status' : 'alert'}>
              <strong>{message.title}</strong>
              <span>{message.body}</span>
            </div>
          ) : (
            <p class="soft">{t.hello.lead}</p>
          )}
          {/* the honeypot: out of sight, out of the tab order, ignored by assistive tech */}
          <div class="hello__trap" aria-hidden="true">
            <label>
              {t.hello.honeypot}
              <input ref={trap} type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <button
            type="button"
            class="btn btn--primary btn--huge"
            aria-busy={fetching}
            disabled={phase.s === 'limited'}
            onClick={get}
          >
            {label}
          </button>
        </>
      )}
      <Extras />
    </div>
  );
}

export function HelloScreen(props: { faucet?: FaucetConfig | null; fetcher?: typeof fetch }) {
  const faucet = useMemo(
    () => (props.faucet === undefined ? configuredFaucet() : props.faucet),
    [props.faucet],
  );
  return faucet === null ? (
    <NoFaucet />
  ) : (
    <LiveScreen faucet={faucet} {...(props.fetcher ? { fetcher: props.fetcher } : {})} />
  );
}

/** What the router mounts: the deployment's own faucet, no overrides. */
export function HelloRoute() {
  return <HelloScreen />;
}
