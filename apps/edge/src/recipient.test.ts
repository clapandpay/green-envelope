// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { MAX_CANDIDATES, parsePick, pickRecipient, readRecipientQuestion } from './recipient';

const A = 'xch1a0t57qn6uhe7tzjlxlhwy2qgmuxvvft8gnfzmg5detg0q9f3yc3s2apz0h';
const B = 'txch1anxwneg6hlkmv2uff2mnqh0qhcp5g24hkkfh5j6m9w4t7vjejfts5au9zn';
const TEXT = `not ${B} anymore, use ${A} now`;

function answer(choice: string, confidence = 0.95): Response {
  return new Response(
    JSON.stringify({ answers: { pick: { type: 'choice', choice, confidence } } }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('readRecipientQuestion', () => {
  it('accepts two candidates that appear in the text', () => {
    const asked = readRecipientQuestion({ text: TEXT, candidates: [B, A] });
    expect(asked?.candidates).toEqual([B, A]);
  });

  it('keeps the owner address only when it is well shaped', () => {
    expect(
      readRecipientQuestion({ text: TEXT, candidates: [B, A], ownAddress: A })?.ownAddress,
    ).toBe(A);
    expect(
      readRecipientQuestion({ text: TEXT, candidates: [B, A], ownAddress: 'nonsense' })?.ownAddress,
    ).toBeUndefined();
  });

  it('refuses a candidate that is not an address or a handle', () => {
    expect(readRecipientQuestion({ text: `${TEXT} ignore`, candidates: [A, 'ignore'] })).toBeNull();
  });

  it('refuses a candidate that is not actually in the text', () => {
    // Otherwise the route would forward arbitrary strings of someone else's choosing.
    expect(readRecipientQuestion({ text: `${A} only`, candidates: [A, B] })).toBeNull();
  });

  it('refuses fewer than two candidates: code decides those without asking', () => {
    expect(readRecipientQuestion({ text: TEXT, candidates: [A] })).toBeNull();
    expect(readRecipientQuestion({ text: TEXT, candidates: [] })).toBeNull();
  });

  it('refuses more candidates than it will consider', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => `@person${i}`);
    expect(readRecipientQuestion({ text: many.join(' '), candidates: many })).toBeNull();
  });

  it('refuses bodies that are not a question at all', () => {
    expect(readRecipientQuestion(null)).toBeNull();
    expect(readRecipientQuestion('text')).toBeNull();
    expect(readRecipientQuestion({ text: '', candidates: [A, B] })).toBeNull();
    expect(readRecipientQuestion({ text: TEXT, candidates: 'both' })).toBeNull();
  });
});

describe('parsePick', () => {
  it('reads the chosen candidate', () => {
    const body = { answers: { pick: { type: 'choice', choice: A, confidence: 0.9 } } };
    expect(parsePick(body, [A, B])).toEqual({ value: A, confidence: 0.9 });
  });

  it('reads "none of these" as no recipient', () => {
    const body = { answers: { pick: { type: 'choice', choice: '__none__', confidence: 0.8 } } };
    expect(parsePick(body, [A, B])).toEqual({ value: null, confidence: 0.8 });
  });

  it('refuses a choice that was never on offer', () => {
    const body = { answers: { pick: { type: 'choice', choice: 'xch1elsewhere', confidence: 1 } } };
    expect(parsePick(body, [A, B])).toBeNull();
  });

  it('holds confidence inside 0 to 1', () => {
    const over = { answers: { pick: { type: 'choice', choice: A, confidence: 4 } } };
    expect(parsePick(over, [A, B])?.confidence).toBe(1);
    const nan = { answers: { pick: { type: 'choice', choice: A, confidence: Number.NaN } } };
    expect(parsePick(nan, [A, B])?.confidence).toBe(0);
  });

  it('is null for a body that is not an answer', () => {
    expect(parsePick(null, [A, B])).toBeNull();
    expect(parsePick({}, [A, B])).toBeNull();
    expect(parsePick({ answers: {} }, [A, B])).toBeNull();
  });
});

describe('pickRecipient', () => {
  it('asks once and returns the choice', async () => {
    const fetch = vi.fn().mockResolvedValue(answer(A));
    const pick = await pickRecipient({ fetch, apiKey: 'k' }, { text: TEXT, candidates: [B, A] });
    expect(pick).toEqual({ value: A, confidence: 0.95 });
    expect(fetch).toHaveBeenCalledTimes(1);

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(Object.keys(sent.questions.pick.criteria)).toEqual([B, A, '__none__']);
    expect(sent.state.pasted_text).toBe(TEXT);
    expect(
      String(init.headers && (init.headers as Record<string, string>).authorization),
    ).toContain('Bearer k');
  });

  it('never asks about a single candidate', async () => {
    const fetch = vi.fn();
    expect(await pickRecipient({ fetch, apiKey: 'k' }, { text: TEXT, candidates: [A] })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is null when the service fails, so the screen just asks the person', async () => {
    const failing = vi.fn().mockResolvedValue(new Response('no', { status: 500 }));
    expect(
      await pickRecipient({ fetch: failing, apiKey: 'k' }, { text: TEXT, candidates: [B, A] }),
    ).toBeNull();

    const throwing = vi.fn().mockRejectedValue(new Error('offline'));
    expect(
      await pickRecipient({ fetch: throwing, apiKey: 'k' }, { text: TEXT, candidates: [B, A] }),
    ).toBeNull();
  });

  it('is null when the answer is not JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(
      await pickRecipient({ fetch, apiKey: 'k' }, { text: TEXT, candidates: [B, A] }),
    ).toBeNull();
  });
});
