// SPDX-License-Identifier: AGPL-3.0-or-later
// Is this handle dressed up as one the person already trusts?
//
// "@anna" instead of an address is friendlier, and that is the point of it; it is also the one
// place in this app where a single wrong character sends money to a stranger, for good.
// `@c1apandpay` and `@rnaxim` pass every rule a regex can state: they are valid handles, they
// resolve, they are simply not who the person meant. Only reading them like a person catches it.
//
// This never blocks a payment and never picks a recipient. It adds one sentence of warning above
// the confirm button, naming the handle the typed one resembles. The person decides.

/** What the browser asks about. */
export interface HandleQuestion {
  /** The bare handle the person typed, with its leading `@`. */
  readonly handle: string;
  /** Handles this person has paid before: the only things worth being mistaken for. */
  readonly known: readonly string[];
}

/** The verdict: which known handle this one imitates, if any. */
export interface HandleVerdict {
  /** The handle it appears to imitate, or null when nothing is wrong. */
  readonly imitates: string | null;
  /** Probability that it is a deliberate imitation, 0 to 1. */
  readonly probability: number;
}

export interface HandleScreenDeps {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
}

const NONE = '__none__';

/** Most known handles compared against. Beyond this the list is not a person's payment history. */
export const MAX_KNOWN = 12;
/** Above this the warning is shown. Measured separation was 0.04–0.09 against 0.74–0.91, so
 *  anything in the wide middle would do; this sits in the gap and errs towards warning. */
export const IMITATION_THRESHOLD = 0.5;
/** A warning is worth a moment, not a wait. */
export const SCREEN_TIMEOUT_MS = 4000;

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';

const IMITATION_INSTRUCTIONS = {
  task: 'Is `typed_handle` a deliberate visual imitation of one of `handles_user_has_paid_before`, designed so a person glancing at it mistakes it for that one?',
  note: 'Handles are lowercase letters and digits only. Look for lookalike character swaps (l/1/i, o/0, a/4, m/rn), inserted or removed characters, and added digits.',
};

const IMITATION_CRITERIA = {
  true: 'It closely mimics a known handle without being it — a person could easily mistake one for the other.',
  false:
    'It is either exactly a known handle, or a genuinely different name that merely shares some letters.',
};

// Asked in the same request as the judgment above, on the stated supposition. Both questions run
// in parallel and cannot see each other, so this one is only read once the first has fired.
const WHICH_INSTRUCTIONS =
  'Supposing `typed_handle` were an imitation of one of the handles in `handles_user_has_paid_before`, which one would it be imitating?';

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads both answers into a verdict; null when the body is not what we asked for. */
export function parseVerdict(body: unknown, known: readonly string[]): HandleVerdict | null {
  if (typeof body !== 'object' || body === null) return null;
  const answers = (body as { answers?: unknown }).answers;
  if (typeof answers !== 'object' || answers === null) return null;
  const all = answers as Record<string, unknown>;

  const imitation = all.imitation as { noul?: unknown } | undefined;
  const probability = asNumber(imitation?.noul);
  if (probability === null) return null;
  const bounded = Math.min(1, Math.max(0, probability));
  if (bounded <= IMITATION_THRESHOLD) return { imitates: null, probability: bounded };

  const which = all.which as { choice?: unknown } | undefined;
  const choice = typeof which?.choice === 'string' ? which.choice : NONE;
  // A name that was never on offer is a broken answer, and a warning that names nothing is noise.
  if (choice === NONE || !known.includes(choice)) return { imitates: null, probability: bounded };
  return { imitates: choice, probability: bounded };
}

/**
 * Screens `handle` against the handles this person has paid before. Resolves to null whenever the
 * judgment is unavailable: an absent warning must never be read as an all-clear, so the caller
 * treats null as "nothing to say", exactly like a clean result.
 */
export async function screenHandle(
  deps: HandleScreenDeps,
  question: HandleQuestion,
): Promise<HandleVerdict | null> {
  const known = question.known.slice(0, MAX_KNOWN);
  // Nothing to be mistaken for, or it is exactly one of them: no judgment needed.
  if (known.length === 0 || known.includes(question.handle)) return null;

  const criteria: Record<string, string | null> = {};
  for (const candidate of known) criteria[candidate] = null;
  criteria[NONE] = 'It imitates none of them.';

  let response: Response;
  try {
    response = await deps.fetch(API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        state: { typed_handle: question.handle, handles_user_has_paid_before: known },
        model: MODEL,
        questions: {
          imitation: {
            type: 'noul',
            instructions: IMITATION_INSTRUCTIONS,
            criteria: IMITATION_CRITERIA,
          },
          which: { type: 'choice', instructions: WHICH_INSTRUCTIONS, criteria },
        },
      }),
      signal: AbortSignal.timeout(SCREEN_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  try {
    return parseVerdict(await response.json(), known);
  } catch {
    return null;
  }
}

const HANDLE = /^@[a-z0-9][a-z0-9_.-]{1,62}$/;

/** Narrows a posted body to a question worth asking, or null. */
export function readHandleQuestion(body: unknown): HandleQuestion | null {
  if (typeof body !== 'object' || body === null) return null;
  const { handle, known } = body as { handle?: unknown; known?: unknown };
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return null;
  if (!Array.isArray(known) || known.length === 0 || known.length > MAX_KNOWN) return null;

  const clean: string[] = [];
  for (const entry of known) {
    if (typeof entry !== 'string' || !HANDLE.test(entry)) return null;
    if (!clean.includes(entry)) clean.push(entry);
  }
  return { handle, known: clean };
}
