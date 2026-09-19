// SPDX-License-Identifier: AGPL-3.0-or-later
// Language: the phone's, unless the person chose one. Two languages, both in the first load
// (a few kB of text) so switching never waits for the network.
import { type ComponentChildren, createContext } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { PREF_LANG, readPref, writePref } from '../lib/storage';
import { de } from './de';
import { type Dict, en } from './en';

export type Lang = 'en' | 'de';
export const LANGS: readonly Lang[] = ['de', 'en'];
const DICTS: Record<Lang, Dict> = { en, de };

function asLang(tag: string | null | undefined): Lang | null {
  const base = tag?.toLowerCase().split('-')[0];
  return base === 'de' || base === 'en' ? base : null;
}

/** A stored choice wins, then the first supported browser language, then English. */
export function pickLanguage(stored: string | null, preferred: readonly string[]): Lang {
  const chosen = stored === 'de' || stored === 'en' ? stored : null;
  if (chosen) return chosen;
  for (const tag of preferred) {
    const lang = asLang(tag);
    if (lang) return lang;
  }
  return 'en';
}

/** The number-format locale: the browser's regional variant when it matches the language. */
export function localeFor(lang: Lang, preferred: readonly string[]): string {
  return preferred.find((tag) => asLang(tag) === lang) ?? lang;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export interface I18n {
  lang: Lang;
  locale: string;
  t: Dict;
  setLang(lang: Lang): void;
}

const I18nContext = createContext<I18n>({ lang: 'en', locale: 'en', t: en, setLang: () => {} });

export function I18nProvider(props: { initial?: Lang; children: ComponentChildren }) {
  const [lang, setLangState] = useState<Lang>(
    () => props.initial ?? pickLanguage(readPref(PREF_LANG), browserLanguages()),
  );
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({
      lang,
      locale: localeFor(lang, browserLanguages()),
      t: DICTS[lang],
      setLang(next) {
        writePref(PREF_LANG, next);
        setLangState(next);
      },
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

/** Texts, locale and the language switch. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
