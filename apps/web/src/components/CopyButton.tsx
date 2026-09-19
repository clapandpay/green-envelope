// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import { copyText } from '../lib/share';
import { CopyIcon, TickIcon } from './icons';

/** Copies `text` and says so for two seconds. */
export function CopyButton(props: { text: string; label?: string; class?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      class={props.class ?? 'btn'}
      onClick={() => copyText(props.text).then(setCopied)}
    >
      {copied ? <TickIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? t.common.copied : (props.label ?? t.common.copy)}</span>
    </button>
  );
}
