// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'preact/hooks';
import { LANGS, useI18n } from '../i18n';
import { Sheet } from './Sheet';

// `v0.1.0 · 3e7d6fc`. Empty outside a Vite build (the tests), where there is no release to name.
const { APP_VERSION, APP_COMMIT } = import.meta.env;
const BUILD = [APP_VERSION && `v${APP_VERSION}`, APP_COMMIT].filter(Boolean).join(' · ');

export function Footer() {
  const { t, lang, setLang } = useI18n();
  const [howOpen, setHowOpen] = useState(false);
  return (
    <footer class="footer">
      <button type="button" class="btn btn--plain" onClick={() => setHowOpen(true)}>
        {t.footer.how}
      </button>
      <fieldset class="footer__lang">
        <legend class="sr-only">{t.footer.language}</legend>
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            class="lang"
            lang={code}
            aria-pressed={code === lang}
            onClick={() => setLang(code)}
          >
            {code}
          </button>
        ))}
      </fieldset>
      {BUILD && <small class="footer__version">{BUILD}</small>}
      <Sheet open={howOpen} title={t.footer.howTitle} onClose={() => setHowOpen(false)}>
        <ul class="how">
          {t.footer.howPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <button
          type="button"
          class="btn btn--primary"
          style="margin-top:20px"
          onClick={() => setHowOpen(false)}
        >
          {t.footer.howClose}
        </button>
      </Sheet>
    </footer>
  );
}
