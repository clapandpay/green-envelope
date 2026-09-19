// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { EnvelopeView } from '../../services/types';
import { type ClaimState, claimReducer, INITIAL_CLAIM } from './claim-state';

const view: EnvelopeView = {
  id: 'demo',
  from: 'Anna',
  message: 'Hi',
  sharesTotal: 5,
  sharesLeft: 3,
  openedAmount: null,
};
const sealed: ClaimState = { s: 'sealed', view, notice: null };
const opening: ClaimState = { s: 'opening', view };

describe('claimReducer', () => {
  it('walks the happy path', () => {
    let state = claimReducer(INITIAL_CLAIM, { e: 'inspected', view });
    expect(state).toEqual(sealed);
    state = claimReducer(state, { e: 'open_started' });
    expect(state).toEqual(opening);
    state = claimReducer(state, { e: 'open_done', amount: 7n });
    expect(state).toEqual({
      s: 'opened',
      view: { ...view, sharesLeft: 2 },
      amount: 7n,
      confirmed: false,
      fresh: true,
    });
    state = claimReducer(state, { e: 'confirmed' });
    expect(state).toMatchObject({ s: 'opened', confirmed: true, fresh: true });
  });

  it('shows an earlier opening without celebrating', () => {
    const state = claimReducer(INITIAL_CLAIM, {
      e: 'inspected',
      view: { ...view, openedAmount: 9n },
    });
    expect(state).toMatchObject({ s: 'opened', amount: 9n, fresh: false, confirmed: true });
  });

  it('an earlier opening wins over "all opened"', () => {
    const state = claimReducer(INITIAL_CLAIM, {
      e: 'inspected',
      view: { ...view, sharesLeft: 0, openedAmount: 9n },
    });
    expect(state.s).toBe('opened');
  });

  it('knows empty, expired, broken and offline on arrival', () => {
    expect(
      claimReducer(INITIAL_CLAIM, { e: 'inspected', view: { ...view, sharesLeft: 0 } }),
    ).toMatchObject({ s: 'gone', reason: 'empty' });
    const failed = (code: Parameters<typeof claimReducer>[1] & { e: 'inspect_failed' }) =>
      claimReducer(INITIAL_CLAIM, code);
    expect(failed({ e: 'inspect_failed', code: 'envelope_empty' })).toMatchObject({
      s: 'gone',
      reason: 'empty',
    });
    expect(failed({ e: 'inspect_failed', code: 'envelope_expired' })).toMatchObject({
      s: 'gone',
      reason: 'expired',
    });
    expect(failed({ e: 'inspect_failed', code: 'bad_link' })).toEqual({
      s: 'failed',
      reason: 'bad_link',
    });
    expect(failed({ e: 'inspect_failed', code: 'network' })).toEqual({
      s: 'failed',
      reason: 'network',
    });
    expect(failed({ e: 'inspect_failed', code: 'unknown' })).toEqual({
      s: 'failed',
      reason: 'unknown',
    });
  });

  it('keeps the envelope sealed when opening fails softly', () => {
    expect(claimReducer(opening, { e: 'open_failed', code: 'wallet_cancelled' })).toEqual({
      ...sealed,
      notice: 'cancelled',
    });
    expect(claimReducer(opening, { e: 'open_failed', code: 'network' })).toEqual({
      ...sealed,
      notice: 'network',
    });
    expect(claimReducer(opening, { e: 'open_failed', code: 'insufficient_funds' })).toEqual({
      ...sealed,
      notice: 'unknown',
    });
  });

  it('handles losing the race', () => {
    expect(claimReducer(opening, { e: 'open_failed', code: 'envelope_empty' })).toEqual({
      s: 'gone',
      reason: 'empty',
      view,
    });
    expect(claimReducer(opening, { e: 'open_failed', code: 'envelope_expired' })).toMatchObject({
      s: 'gone',
      reason: 'expired',
    });
    expect(claimReducer(opening, { e: 'open_failed', code: 'already_opened' })).toEqual(
      INITIAL_CLAIM,
    );
  });

  it('ignores events that do not fit the state', () => {
    expect(claimReducer(INITIAL_CLAIM, { e: 'open_started' })).toBe(INITIAL_CLAIM);
    expect(claimReducer(sealed, { e: 'open_done', amount: 1n })).toBe(sealed);
    expect(claimReducer(sealed, { e: 'confirmed' })).toBe(sealed);
    expect(claimReducer(sealed, { e: 'open_failed', code: 'network' })).toBe(sealed);
    expect(claimReducer(sealed, { e: 'reload' })).toEqual(INITIAL_CLAIM);
  });
});
