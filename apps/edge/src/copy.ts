// SPDX-License-Identifier: AGPL-3.0-or-later

/** Languages the link preview is written in. */
export type Language = 'en' | 'de';

/** What the chain said about an envelope's shares; `unknown` covers timeouts, errors and "no coins seen yet". */
export type ShareState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'counted'; readonly total: number; readonly left: number };

/** Title and description of one page, as plain (unescaped) text. */
export interface PreviewCopy {
  readonly title: string;
  readonly description: string;
}

/** Longest sender name shown in a preview, in code points. */
export const MAX_FROM_CHARS = 40;
/** Longest sender message shown in a preview, in code points. */
export const MAX_MESSAGE_CHARS = 120;
/** Site name for `og:site_name` and the generic title. */
export const SITE_NAME = 'Clap and Pay';

interface Strings {
  readonly titleFrom: (from: string) => string;
  readonly titleAnonymous: string;
  readonly left: (left: number, total: number) => string;
  readonly allOpened: string;
  readonly tapToOpen: string;
  readonly genericTitle: string;
  readonly genericDescription: string;
  readonly helloTitle: string;
  readonly helloDescription: string;
}

const STRINGS: Readonly<Record<Language, Strings>> = {
  en: {
    titleFrom: (from) => `🟢 Green envelope from ${from}`,
    titleAnonymous: '🟢 A green envelope for you',
    left: (left, total) => `${left} of ${total} left · tap to open`,
    allOpened: 'All opened. Make your own.',
    tapToOpen: 'Tap to open',
    genericTitle: `Green Envelope · ${SITE_NAME}`,
    genericDescription: 'Money as a link in the group chat. Tap, open, and it is yours.',
    helloTitle: '🟢 Get your green envelope',
    helloDescription:
      'Tap, and an envelope with real money is yours. Then pass it on. No app, no account.',
  },
  de: {
    titleFrom: (from) => `🟢 Grüner Umschlag von ${from}`,
    titleAnonymous: '🟢 Ein grüner Umschlag für dich',
    left: (left, total) => `Noch ${left} von ${total} · tippen zum Öffnen`,
    allOpened: 'Alle geöffnet. Mach deinen eigenen.',
    tapToOpen: 'Tippen zum Öffnen',
    genericTitle: `Grüner Umschlag · ${SITE_NAME}`,
    genericDescription: 'Geld als Link im Gruppenchat. Tippen, öffnen, und es gehört dir.',
    helloTitle: '🟢 Hol dir deinen grünen Umschlag',
    helloDescription:
      'Tippen, und ein Umschlag mit echtem Geld gehört dir. Dann gib ihn weiter. Keine App, kein Konto.',
  },
};

/** German when `Accept-Language` starts with `de`, otherwise English. */
export function pickLanguage(acceptLanguage: string | null): Language {
  return acceptLanguage?.trimStart().toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** True when every share that exists has been opened. */
export function allOpened(state: ShareState): boolean {
  return state.kind === 'counted' && state.left === 0;
}

function statusLine(strings: Strings, state: ShareState): string {
  if (state.kind === 'unknown') return strings.tapToOpen;
  return state.left === 0 ? strings.allOpened : strings.left(state.left, state.total);
}

/** Preview copy of one envelope; `from` and `message` are already sanitised and may be empty. */
export function envelopeCopy(
  language: Language,
  from: string,
  message: string,
  state: ShareState,
): PreviewCopy {
  const strings = STRINGS[language];
  const status = statusLine(strings, state);
  return {
    title: from === '' ? strings.titleAnonymous : strings.titleFrom(from),
    description: message === '' ? status : `${message} — ${status}`,
  };
}

/** Preview copy of every page that is not a valid envelope. */
export function genericCopy(language: Language): PreviewCopy {
  const strings = STRINGS[language];
  return { title: strings.genericTitle, description: strings.genericDescription };
}

/** Preview copy of the front door, `/hello`. */
export function helloCopy(language: Language): PreviewCopy {
  const strings = STRINGS[language];
  return { title: strings.helloTitle, description: strings.helloDescription };
}
