// SPDX-License-Identifier: AGPL-3.0-or-later
// The Klimper app opened this page to get the wallet. A passkey belongs to a website, so the
// face or finger check has to happen here; the 24 words go back sealed to the asking app, in a
// clapandpay.com link that the phone gives only to Klimper (packages/handoff, TASK-129). There
// is nothing to copy: the answer is a link, and only a tap on it leaves this page.
import '../../styles/connect.css';
import { useEffect, useState } from 'preact/hooks';
import { Envelope } from '../../components/Envelope';
import { useI18n } from '../../i18n';
import { errorCode, errorText } from '../../lib/errors';
import { useServices } from '../../services/context';
import type { ServiceErrorCode } from '../../services/types';

type State =
  | { s: 'checking' }
  | { s: 'bad' }
  | { s: 'none' }
  | { s: 'too_old' }
  | { s: 'ask'; working: boolean; problem: ServiceErrorCode | null }
  | { s: 'done'; returnUrl: string };

export function ConnectScreen(props: { search: string }) {
  const { t } = useI18n();
  const { wallet } = useServices();
  const [state, setState] = useState<State>({ s: 'checking' });
  // Read once: the fragment is taken out of the address bar below, and a later render (a
  // language switch) passes an empty one.
  const [search] = useState(props.search);

  useEffect(() => {
    let current = true;
    // The key is read from props from here on: take it out of the address bar and the history.
    history.replaceState(history.state, '', location.pathname);
    // Checking the request asks for nothing: the face or finger only ever on the button.
    wallet.connectRequest(search).then(
      () => current && setState({ s: 'ask', working: false, problem: null }),
      () => current && setState({ s: 'bad' }),
    );
    return () => {
      current = false;
    };
  }, [search, wallet]);

  async function approve() {
    setState({ s: 'ask', working: true, problem: null });
    try {
      const { returnUrl } = await wallet.connectApprove(search);
      setState({ s: 'done', returnUrl });
    } catch (error) {
      const code = errorCode(error);
      if (code === 'no_wallet_here') setState({ s: 'none' });
      else if (code === 'wallet_too_old') setState({ s: 'too_old' });
      else if (code === 'bad_request') setState({ s: 'bad' });
      else setState({ s: 'ask', working: false, problem: code });
    }
  }

  if (state.s === 'checking') return <span class="skeleton" style="height:240px" />;

  if (state.s === 'bad' || state.s === 'none' || state.s === 'too_old') {
    const [title, body] =
      state.s === 'bad'
        ? [t.connect.badTitle, t.connect.badBody]
        : state.s === 'none'
          ? [t.connect.noneTitle, t.connect.noneBody]
          : [t.connect.tooOldTitle, t.connect.tooOldBody];
    return (
      <div class="connect stack">
        <div class="connect__art">
          <Envelope state="ghost" />
        </div>
        <h1 class="title">{title}</h1>
        <p role="alert">{body}</p>
      </div>
    );
  }

  if (state.s === 'done') {
    return (
      <div class="connect stack">
        <h1 class="title">{t.connect.doneTitle}</h1>
        <p>{t.connect.doneBody}</p>
        {/* A link the person taps, not a script that navigates: a tap is what a phone hands to
            the app the domain names; a navigation started by script may stay in the browser. */}
        <a
          class="btn btn--primary btn--huge"
          href={state.returnUrl}
          // The closest this page gets to knowing the money is in Klimper (TASK-131).
          onClick={() => wallet.markBackedUp()}
        >
          {t.connect.open}
        </a>
        <p class="soft">{t.connect.doneNoApp}</p>
      </div>
    );
  }

  return (
    <div class="connect stack">
      <h1 class="title">{t.connect.title}</h1>
      <p>{t.connect.body}</p>
      <p class="notice notice--calm">{t.connect.warn}</p>
      {state.problem && (
        <p class="notice" role="alert">
          {errorText(state.problem, t)}
        </p>
      )}
      <button
        type="button"
        class="btn btn--primary btn--huge"
        aria-busy={state.working}
        disabled={state.working}
        onClick={approve}
      >
        {state.working ? t.connect.working : t.connect.approve}
      </button>
    </div>
  );
}
