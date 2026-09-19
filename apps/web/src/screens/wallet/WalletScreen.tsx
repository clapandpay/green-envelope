// SPDX-License-Identifier: AGPL-3.0-or-later
// The small wallet: what you have, three things you can do, the envelopes you made.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Amount } from '../../components/Amount';
import { Envelope } from '../../components/Envelope';
import { DownIcon, PlusIcon, UpIcon } from '../../components/icons';
import { useI18n } from '../../i18n';
import { errorCode, errorText } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { useRate } from '../../lib/use-rate';
import { onLinkClick } from '../../router';
import { useServices } from '../../services/context';
import type { Balance, SentEnvelope, WalletInfo } from '../../services/types';
import { ReceiveSheet } from './ReceiveSheet';
import { SendSheet } from './SendSheet';
import { SentList } from './SentList';
import '../../styles/wallet.css';

const REFRESH_MS = 8000;

interface WalletData {
  wallet: WalletInfo | null;
  balance: Balance | null;
  sent: SentEnvelope[];
  canSecure: boolean;
}

type Load = { s: 'loading' } | { s: 'failed'; message: string } | ({ s: 'ready' } & WalletData);

export function WalletScreen() {
  const { t, locale } = useI18n();
  const services = useServices();
  const { rate } = useRate();
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [sheet, setSheet] = useState<'receive' | 'send' | null>(null);
  const [working, setWorking] = useState<'start' | 'secure' | null>(null);
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
          ]).then(([balance, sent, canSecure]) => ({ wallet, balance, sent, canSecure }))
        : { wallet: null, balance: null, sent: [], canSecure: false };
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

  const run = async (kind: 'start' | 'secure') => {
    setWorking(kind);
    setMessage(null);
    try {
      if (kind === 'start') await services.wallet.ensure();
      else await services.wallet.upgradeToPasskey();
      if (kind === 'secure') setMessage({ tone: 'good', text: t.wallet.secured });
      await refresh();
    } catch (error) {
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

  const notice = message && (
    <p class={message.tone === 'good' ? 'notice notice--calm' : 'notice'} role="alert">
      {message.text}
    </p>
  );

  if (load.wallet === null) {
    return (
      <div class="stack first-run">
        <div class="first-run__picture">
          <Envelope state="sealed" />
        </div>
        <h1 class="title">{t.wallet.firstRunTitle}</h1>
        <p>{t.wallet.firstRunBody}</p>
        {notice}
        <button
          type="button"
          class="btn btn--primary btn--huge"
          aria-busy={working === 'start'}
          disabled={working !== null}
          onClick={() => run('start')}
        >
          {working === 'start' ? t.wallet.starting : t.wallet.start}
        </button>
      </div>
    );
  }

  const { balance } = load;
  const pending = balance?.pending ?? 0n;
  return (
    <div class="stack wallet">
      <section class="card balance" aria-labelledby="balance-title">
        <h1 id="balance-title" class="eyebrow">
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
        <section class="card card--sun stack" aria-labelledby="secure-title">
          <h2 id="secure-title" class="wallet__h2">
            {t.wallet.secureTitle}
          </h2>
          <p>{t.wallet.secureBody}</p>
          <button
            type="button"
            class="btn"
            aria-busy={working === 'secure'}
            disabled={working !== null}
            onClick={() => run('secure')}
          >
            {working === 'secure' ? t.wallet.securing : t.wallet.secureAction}
          </button>
        </section>
      )}

      <section class="stack" aria-labelledby="sent-title">
        <h2 id="sent-title" class="wallet__h2 wallet__h2--list">
          {t.wallet.sentTitle}
        </h2>
        <SentList envelopes={load.sent} rate={rate} onChanged={refresh} />
      </section>

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
