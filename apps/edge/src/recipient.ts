// SPDX-License-Identifier: AGPL-3.0-or-later
// Choosing between recipients a person pasted out of a group chat.
//
// The browser finds the candidates itself (`scanRecipients`) and checks each one against the
// address and handle shapes; only when more than one survives does it ask here. So this never
// produces a recipient, it only picks one of the ones it was given, and the send screen still
// shows the whole chosen address before anything moves. The API key stays on this side.

/** What the browser asks about. */
export interface RecipientQuestion {
  /** The text that was pasted, as typed. */
  readonly text: string;
  /** The candidates the browser found and checked, two or more. */
  readonly candidates: readonly string[];
  /** The address of the person pasting, so it is never chosen. Optional. */
  readonly ownAddress?: string | undefined;
}

/** The chosen candidate, or null for "none of them". */
export interface RecipientPick {
  readonly value: string | null;
  /** How concentrated the choice was, 0 to 1. */
  readonly confidence: number;
}

/** Dependencies, all replaceable in tests. */
export interface RecipientDeps {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
}

/** Sentinel for "none of these"; not a possible candidate, because no candidate starts with `_`. */
const NONE = '__none__';

/** Longest pasted text forwarded; a chat line is far shorter and this is not a document service. */
export const MAX_TEXT_CHARS = 2000;
/** Most candidates considered. Beyond a handful the person is pasting something else entirely. */
export const MAX_CANDIDATES = 12;
/** The judgment is an optional convenience: it never delays the field for long. */
export const RECIPIENT_TIMEOUT_MS = 4000;

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';

// Wording matters more than it looks: an earlier version asked which recipient the sender
// "wants money sent to", which made a bare pasted address score as "no recipient at all",
// because a bare address expresses no intent. Naming the situation fixed it.
const INSTRUCTIONS = {
  task: 'Someone pasted `pasted_text` into the recipient field of a payment app. Which candidate is the address or handle they intend to pay?',
  rules: [
    'If `pasted_text` is just an address or handle on its own, that is the intended recipient.',
    'When several appear, choose the one the text points to as the destination, not one it rejects, supersedes or merely mentions.',
    '`wallet_owner_address` is the person doing the pasting, so it is never the recipient.',
  ],
};

const NONE_DESCRIPTION =
  'None of the candidates is a destination: the text asks a question about an address, warns against using it, or says not to send yet.';

function isChoiceAnswer(value: unknown): value is { choice: string; confidence: number } {
  if (typeof value !== 'object' || value === null) return false;
  const answer = value as { choice?: unknown; confidence?: unknown };
  return typeof answer.choice === 'string' && typeof answer.confidence === 'number';
}

/** Reads the one answer out of a System One response body; null when it is not what we asked for. */
export function parsePick(body: unknown, candidates: readonly string[]): RecipientPick | null {
  if (typeof body !== 'object' || body === null) return null;
  const answers = (body as { answers?: unknown }).answers;
  if (typeof answers !== 'object' || answers === null) return null;
  const answer = (answers as Record<string, unknown>).pick;
  if (!isChoiceAnswer(answer)) return null;
  const confidence = Number.isFinite(answer.confidence)
    ? Math.min(1, Math.max(0, answer.confidence))
    : 0;
  if (answer.choice === NONE) return { value: null, confidence };
  // A choice that is not one of the candidates is a broken answer, not a recipient.
  return candidates.includes(answer.choice) ? { value: answer.choice, confidence } : null;
}

/**
 * Picks the intended recipient among `candidates`. Resolves to null whenever the judgment is
 * unavailable or unusable: the send screen then simply asks the person which one they meant.
 */
export async function pickRecipient(
  deps: RecipientDeps,
  question: RecipientQuestion,
): Promise<RecipientPick | null> {
  const candidates = question.candidates.slice(0, MAX_CANDIDATES);
  if (candidates.length < 2) return null;

  const criteria: Record<string, string | null> = {};
  for (const candidate of candidates) criteria[candidate] = null;
  criteria[NONE] = NONE_DESCRIPTION;

  const state: Record<string, unknown> = {
    pasted_text: Array.from(question.text).slice(0, MAX_TEXT_CHARS).join(''),
  };
  if (question.ownAddress !== undefined) state.wallet_owner_address = question.ownAddress;

  let response: Response;
  try {
    response = await deps.fetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        state,
        model: MODEL,
        questions: { pick: { type: 'choice', instructions: INSTRUCTIONS, criteria } },
      }),
      signal: AbortSignal.timeout(RECIPIENT_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  try {
    return parsePick(await response.json(), candidates);
  } catch {
    return null;
  }
}

// The same shapes the browser used, repeated here: what arrives over the wire is not trusted,
// and a candidate that is not an address or a handle never reaches the model.
const ADDRESS = /^t?xch1[02-9ac-hj-np-z]{20,}$/;
const HANDLE = /^@[a-z0-9][a-z0-9_.-]{1,29}$/;

function isRecipientShape(value: unknown): value is string {
  return typeof value === 'string' && (ADDRESS.test(value) || HANDLE.test(value));
}

/**
 * Narrows a posted body to a question worth asking, or null.
 *
 * Refuses anything that is not two or more well-shaped candidates, so this route cannot be
 * turned into a general-purpose way to spend the deployment's tokens.
 */
export function readRecipientQuestion(body: unknown): RecipientQuestion | null {
  if (typeof body !== 'object' || body === null) return null;
  const { text, candidates, ownAddress } = body as {
    text?: unknown;
    candidates?: unknown;
    ownAddress?: unknown;
  };
  if (typeof text !== 'string' || text === '') return null;
  if (!Array.isArray(candidates)) return null;

  const clean: string[] = [];
  for (const candidate of candidates) {
    if (!isRecipientShape(candidate)) return null;
    if (!text.includes(candidate)) return null; // it must actually be in the text it came from
    if (!clean.includes(candidate)) clean.push(candidate);
  }
  if (clean.length < 2 || clean.length > MAX_CANDIDATES) return null;

  return {
    text,
    candidates: clean,
    ownAddress: isRecipientShape(ownAddress) ? ownAddress : undefined,
  };
}
