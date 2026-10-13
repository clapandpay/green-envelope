// SPDX-License-Identifier: AGPL-3.0-or-later
// The alpha notice, as on mempoolxch.space: one slim line above everything, until dismissed.
import { useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import { PREF_ALPHA_DISMISSED, readPref, writePref } from '../lib/storage';

export function AlphaBanner() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => readPref(PREF_ALPHA_DISMISSED) === '1');
  if (dismissed) return null;
  return (
    <div class="alpha" role="note" aria-label={t.common.alphaLabel}>
      <p class="alpha__text">{t.common.alphaText}</p>
      <button
        type="button"
        class="alpha__close"
        aria-label={t.common.alphaDismiss}
        onClick={() => {
          writePref(PREF_ALPHA_DISMISSED, '1');
          setDismissed(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
