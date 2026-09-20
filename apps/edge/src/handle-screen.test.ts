// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { MAX_KNOWN, parseVerdict, readHandleQuestion, screenHandle } from './handle-screen';

const KNOWN = ['@clapandpay', '@maxim', '@anna'];

function verdictBody(noul: number, choice: string) {
  return {
    answers: {
      imitation: { type: 'noul', noul },
      which: { type: 'choice', choice, confidence: 0.9 },
    },
  };
}

function answer(noul: number, choice: string): Response {
  return new Response(JSON.stringify(verdictBody(noul, choice)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseVerdict', () => {
  it('names the handle being imitated when the judgment fires', () => {
    expect(parseVerdict(verdictBody(0.91, '@clapandpay'), KNOWN)).toEqual({
      imitates: '@clapandpay',
      probability: 0.91,
    });
  });

  // The Choice is asked speculatively, in the same request, and is meaningless on its own:
  // it always names its best guess. Only the Noul decides whether it is read at all.
  it('ignores the speculative choice when the judgment does not fire', () => {
    expect(parseVerdict(verdictBody(0.08, '@clapandpay'), KNOWN)).toEqual({
      imitates: null,
      probability: 0.08,
    });
  });

  it('says nothing when the choice is "none of them"', () => {
    expect(parseVerdict(verdictBody(0.8, '__none__'), KNOWN)?.imitates).toBeNull();
  });

  it('refuses to warn about a name that was never on offer', () => {
    expect(parseVerdict(verdictBody(0.9, '@somebody-else'), KNOWN)?.imitates).toBeNull();
  });

  it('holds the probability inside 0 to 1', () => {
    expect(parseVerdict(verdictBody(3, '@anna'), KNOWN)?.probability).toBe(1);
  });

  it('is null for a body that is not an answer', () => {
    expect(parseVerdict(null, KNOWN)).toBeNull();
    expect(parseVerdict({ answers: {} }, KNOWN)).toBeNull();
    expect(parseVerdict({ answers: { imitation: { noul: 'high' } } }, KNOWN)).toBeNull();
  });
});

describe('readHandleQuestion', () => {
  it('accepts a handle and the handles already paid', () => {
    expect(readHandleQuestion({ handle: '@c1apandpay', known: KNOWN })?.known).toEqual(KNOWN);
  });

  it('drops repeats in the known list', () => {
    expect(
      readHandleQuestion({ handle: '@x1', known: ['@anna', '@anna', '@maxim'] })?.known,
    ).toEqual(['@anna', '@maxim']);
  });

  it('refuses anything that is not a handle', () => {
    expect(readHandleQuestion({ handle: 'no-at-sign', known: KNOWN })).toBeNull();
    expect(readHandleQuestion({ handle: '@anna', known: ['not-a-handle'] })).toBeNull();
    expect(readHandleQuestion({ handle: '@anna', known: [] })).toBeNull();
    expect(readHandleQuestion(null)).toBeNull();
  });

  it('refuses a known list longer than it will compare', () => {
    const many = Array.from({ length: MAX_KNOWN + 1 }, (_, i) => `@person${i}`);
    expect(readHandleQuestion({ handle: '@anna', known: many })).toBeNull();
  });
});

describe('screenHandle', () => {
  const deps = (fetchFn: typeof fetch) => ({ fetch: fetchFn, apiKey: 'k' });

  it('asks both questions in one request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(answer(0.9, '@clapandpay'));
    const verdict = await screenHandle(deps(fetchFn), { handle: '@c1apandpay', known: KNOWN });
    expect(verdict?.imitates).toBe('@clapandpay');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(Object.keys(sent.questions)).toEqual(['imitation', 'which']);
    expect(sent.questions.imitation.type).toBe('noul');
    expect(sent.questions.which.type).toBe('choice');
    expect(sent.state.typed_handle).toBe('@c1apandpay');
  });

  it('never asks about a handle that is itself one already paid', async () => {
    const fetchFn = vi.fn();
    expect(await screenHandle(deps(fetchFn), { handle: '@anna', known: KNOWN })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never asks when there is nothing to be mistaken for', async () => {
    const fetchFn = vi.fn();
    expect(await screenHandle(deps(fetchFn), { handle: '@anna', known: [] })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is null when the service fails, and the caller treats that as no warning', async () => {
    const failing = vi.fn().mockResolvedValue(new Response('no', { status: 503 }));
    expect(await screenHandle(deps(failing), { handle: '@x1', known: KNOWN })).toBeNull();

    const throwing = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await screenHandle(deps(throwing), { handle: '@x1', known: KNOWN })).toBeNull();
  });
});
