// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { PREF_LANG } from '../lib/storage';
import { de } from './de';
import { en } from './en';
import { I18nProvider, localeFor, pickLanguage, useI18n } from './index';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('pickLanguage', () => {
  it('follows the browser', () => {
    expect(pickLanguage(null, ['de-AT', 'en'])).toBe('de');
    expect(pickLanguage(null, ['en-GB'])).toBe('en');
    expect(pickLanguage(null, ['fr-FR', 'de'])).toBe('de');
  });

  it('falls back to English', () => {
    expect(pickLanguage(null, ['fr-FR', 'ja'])).toBe('en');
    expect(pickLanguage(null, [])).toBe('en');
  });

  it('lets a stored choice win, and ignores a broken one', () => {
    expect(pickLanguage('en', ['de-DE'])).toBe('en');
    expect(pickLanguage('de', ['en-US'])).toBe('de');
    expect(pickLanguage('klingon', ['de-DE'])).toBe('de');
    expect(pickLanguage('', ['fr'])).toBe('en');
  });
});

describe('localeFor', () => {
  it('uses the regional variant only when it matches the language', () => {
    expect(localeFor('de', ['de-AT', 'en'])).toBe('de-AT');
    expect(localeFor('en', ['de-AT'])).toBe('en');
    expect(localeFor('de', [])).toBe('de');
  });
});

describe('dictionaries', () => {
  const NOT_FOR_PEOPLE =
    /\b(coins?|mojos?|blockchain|spend bundle|wallet|token|crypto|krypto|münzen?)\b/i;

  function texts(node: unknown, out: string[] = []): string[] {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'function') out.push(String(node('Anna', 3)));
    else if (Array.isArray(node)) for (const item of node) texts(item, out);
    else if (node && typeof node === 'object')
      for (const item of Object.values(node)) texts(item, out);
    return out;
  }

  it('keeps technical vocabulary away from people, in both languages', () => {
    for (const text of [...texts(en), ...texts(de)]) {
      expect(text, text).not.toMatch(NOT_FOR_PEOPLE);
      expect(text.trim(), 'empty text').not.toBe('');
    }
  });
});

describe('I18nProvider', () => {
  function Probe() {
    const { t, lang, setLang } = useI18n();
    return (
      <button type="button" onClick={() => setLang(lang === 'de' ? 'en' : 'de')}>
        {t.claim.open}
      </button>
    );
  }

  it('switches, remembers the choice and tells the document', () => {
    render(
      <I18nProvider initial="en">
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Öffnen' })).toBeTruthy();
    expect(localStorage.getItem(PREF_LANG)).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('starts from the stored choice', () => {
    localStorage.setItem(PREF_LANG, 'de');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Öffnen' })).toBeTruthy();
  });
});
