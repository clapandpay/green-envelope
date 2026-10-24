// SPDX-License-Identifier: AGPL-3.0-or-later
// The claim screen as a state machine. Pure: the hook in use-claim.ts feeds it events.
import type { EnvelopeView, ServiceErrorCode } from '../../services/types';

/** `no_passkey`: the passkey did not give a wallet here; the screen offers a new passkey, never a browser-only wallet. */
export type ClaimNotice = 'cancelled' | 'no_passkey' | 'network' | 'unknown';

export type ClaimState =
  | { s: 'loading' }
  | { s: 'sealed'; view: EnvelopeView; notice: ClaimNotice | null }
  | { s: 'opening'; view: EnvelopeView }
  /** `fresh`: opened just now (celebrate), not on an earlier visit. */
  | {
      s: 'opened';
      view: EnvelopeView;
      amount: bigint;
      confirmed: boolean;
      fresh: boolean;
      /** The coin the money landed in, when it was opened just now. */
      coinId?: string;
    }
  | { s: 'gone'; reason: 'empty' | 'expired'; view: EnvelopeView | null }
  | { s: 'failed'; reason: 'bad_link' | 'not_ready' | 'network' | 'unknown' };

export type ClaimEvent =
  | { e: 'reload' }
  | { e: 'inspected'; view: EnvelopeView }
  | { e: 'inspect_failed'; code: ServiceErrorCode }
  | { e: 'open_started' }
  | { e: 'open_done'; amount: bigint; coinId?: string }
  | { e: 'open_failed'; code: ServiceErrorCode }
  | { e: 'confirmed' };

export const INITIAL_CLAIM: ClaimState = { s: 'loading' };

function viewOf(state: ClaimState): EnvelopeView | null {
  return 'view' in state ? state.view : null;
}

function failure(code: ServiceErrorCode, view: EnvelopeView | null): ClaimState {
  switch (code) {
    case 'envelope_empty':
      return { s: 'gone', reason: 'empty', view };
    case 'envelope_expired':
      return { s: 'gone', reason: 'expired', view };
    case 'bad_link':
      return { s: 'failed', reason: 'bad_link' };
    case 'envelope_not_ready':
      return { s: 'failed', reason: 'not_ready' };
    case 'network':
      return { s: 'failed', reason: 'network' };
    default:
      return { s: 'failed', reason: 'unknown' };
  }
}

/** Next state for an event. Events that make no sense in the current state are ignored. */
export function claimReducer(state: ClaimState, event: ClaimEvent): ClaimState {
  switch (event.e) {
    case 'reload':
      return INITIAL_CLAIM;
    case 'inspected': {
      const { view } = event;
      if (view.openedAmount !== null) {
        return { s: 'opened', view, amount: view.openedAmount, confirmed: true, fresh: false };
      }
      if (view.sharesLeft <= 0) return { s: 'gone', reason: 'empty', view };
      return { s: 'sealed', view, notice: null };
    }
    case 'inspect_failed':
      return failure(event.code, null);
    case 'open_started':
      return state.s === 'sealed' ? { s: 'opening', view: state.view } : state;
    case 'open_done': {
      if (state.s !== 'opening') return state;
      const view = { ...state.view, sharesLeft: Math.max(0, state.view.sharesLeft - 1) };
      return {
        s: 'opened',
        view,
        amount: event.amount,
        confirmed: false,
        fresh: true,
        ...(event.coinId === undefined ? {} : { coinId: event.coinId }),
      };
    }
    case 'open_failed': {
      if (state.s !== 'opening') return state;
      const { code } = event;
      if (code === 'already_opened') return INITIAL_CLAIM; // the hook looks again
      if (code === 'wallet_cancelled' || code === 'no_wallet_here')
        return { s: 'sealed', view: state.view, notice: 'cancelled' };
      if (code === 'network') return { s: 'sealed', view: state.view, notice: 'network' };
      if (code === 'passkey_unavailable')
        return { s: 'sealed', view: state.view, notice: 'no_passkey' };
      if (
        code === 'envelope_empty' ||
        code === 'envelope_expired' ||
        code === 'envelope_not_ready' ||
        code === 'bad_link'
      ) {
        return failure(code, viewOf(state));
      }
      return { s: 'sealed', view: state.view, notice: 'unknown' };
    }
    case 'confirmed':
      return state.s === 'opened' ? { ...state, confirmed: true } : state;
  }
}
