// SPDX-License-Identifier: AGPL-3.0-or-later
// The Klimper app opened this page to get the wallet. A passkey belongs to a website, so the
// face or finger check has to happen here; the result goes back as one line of text that only
// the asking app can read (packages/handoff).
import '../../styles/connect.css';
import { useEffect, useState } from 'preact/hooks';
import { Envelope } from '../../components/Envelope';
import { useI18n } from '../../i18n';
import { errorCode, errorText } from '../../lib/errors';
import { copyText } from '../../lib/share';
import { useServices } from '../../services/context';
import type { ServiceErrorCode } from '../../services/types';

type State =
  | { s: 'checking' }
  | { s: 'bad' }
  | { s: 'ask'; checkCode: string; working: boolean; problem: ServiceErrorCode | null }
  | { s: 'none' }
  | { s: 'done'; response: string; answerCode: string; copied: boolean };

/** "481516" reads better as "481 516". */
function spaced(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function ConnectScreen(props: { search: string }) {
  const { t } = useI18n();
  const { wallet } = useServices();
  const [state, setState] = useState<State>({ s: 'checking' });

  useEffect(() => {
    let current = true;
    wallet.connectRequest(props.search).then(
      ({ checkCode }) =>
        current && setState({ s: 'ask', checkCode, working: false, problem: null }),
      () => current && setState({ s: 'bad' }),
    );
    return () => {
      current = false;
    };
  }, [props.search, wallet]);

  async function approve(checkCode: string) {
    setState({ s: 'ask', checkCode, working: true, problem: null });
    try {
      const { response, answerCode } = await wallet.connectApprove(props.search);
      setState({ s: 'done', response, answerCode, copied: false });
    } catch (error) {
      const code = errorCode(error);
      if (code === 'no_wallet_here') setState({ s: 'none' });
      else if (code === 'bad_request') setState({ s: 'bad' });
      else setState({ s: 'ask', checkCode, working: false, problem: code });
    }
  }

  if (state.s === 'checking') return <span class="skeleton" style="height:240px" />;

  if (state.s === 'bad' || state.s === 'none') {
    return (
      <div class="connect stack">
        <div class="connect__art">
          <Envelope state="ghost" />
        </div>
        <h1 class="title">{state.s === 'bad' ? t.connect.badTitle : t.connect.noneTitle}</h1>
        <p role="alert">{state.s === 'bad' ? t.connect.badBody : t.connect.noneBody}</p>
      </div>
    );
  }

  if (state.s === 'done') {
    const { response, answerCode } = state;
    return (
      <div class="connect stack">
        <h1 class="title">{t.connect.doneTitle}</h1>
        <p>{t.connect.doneBody}</p>
        <p class="connect__code">
          <span class="eyebrow">{t.connect.answerLabel}</span>
          <strong class="num" data-testid="answer-code">
            {spaced(answerCode)}
          </strong>
        </p>
        <button
          type="button"
          class="btn btn--primary btn--huge"
          onClick={async () => {
            if (await copyText(response)) setState({ ...state, copied: true });
          }}
        >
          {t.connect.copy}
        </button>
        <p class="connect__status" role="status">
          {state.copied ? t.connect.copied : ''}
        </p>
      </div>
    );
  }

  return (
    <div class="connect stack">
      <h1 class="title">{t.connect.title}</h1>
      <p>{t.connect.body}</p>
      <p class="connect__code">
        <span class="eyebrow">{t.connect.codeLabel}</span>
        <strong class="num">{spaced(state.checkCode)}</strong>
      </p>
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
        onClick={() => approve(state.checkCode)}
      >
        {state.working ? t.connect.working : t.connect.approve}
      </button>
    </div>
  );
}
