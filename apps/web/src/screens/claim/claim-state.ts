// SPDX-License-Identifier: AGPL-3.0-or-later
// The claim screen as a state machine. Pure: the hook in use-claim.ts feeds it events.
import type { EnvelopeView, ServiceErrorCode } from '../../services/types';

export type ClaimNotice = 'cancelled' | 'network' | 'unknown';

export type ClaimState =
  | { s: 'loading' }
  | { s: 'sealed'; view: EnvelopeView; notice: ClaimNotice | null }
  | { s: 'opening'; view: EnvelopeView }
  /** `fresh`: opened just now (celebrate), not on an earlier visit. */
  | { s: 'opened'; view: EnvelopeView; amount: bigint; confirmed: boolean; fresh: boolean }
  | { s: 'gone'; reason: 'empty' | 'expired'; view: EnvelopeView | null }
  | { s: 'failed'; reason: 'bad_link' | 'network' | 'unknown' };

export type ClaimEvent =
  | { e: 'reload' }
  | { e: 'inspected'; view: EnvelopeView }
  | { e: 'inspect_failed'; code: ServiceErrorCode }
  | { e: 'open_started' }
  | { e: 'open_done'; amount: bigint }
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
      return { s: 'opened', view, amount: event.amount, confirmed: false, fresh: true };
    }
    case 'open_failed': {
      if (state.s !== 'opening') return state;
      const { code } = event;
      if (code === 'already_opened') return INITIAL_CLAIM; // the hook looks again
      if (code === 'wallet_cancelled')
        return { s: 'sealed', view: state.view, notice: 'cancelled' };
      if (code === 'network') return { s: 'sealed', view: state.view, notice: 'network' };
      if (code === 'envelope_empty' || code === 'envelope_expired' || code === 'bad_link') {
        return failure(code, viewOf(state));
      }
      return { s: 'sealed', view: state.view, notice: 'unknown' };
    }
    case 'confirmed':
      return state.s === 'opened' ? { ...state, confirmed: true } : state;
  }
}
