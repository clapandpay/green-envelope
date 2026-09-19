// SPDX-License-Identifier: AGPL-3.0-or-later
// After "Make envelope": the link, the way out to the chat, and how it will read there.
import { CopyButton } from '../../components/CopyButton';
import { ShareIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/en';
import { canShare, shareLink } from '../../lib/share';
import { navigate } from '../../router';
import type { SentEnvelope } from '../../services/types';

/** The line of text that travels with the link. Pure. */
export function chatLine(from: string | null, shares: number, t: Dict): string {
  return from ? t.create.chatPreview(from, shares) : t.create.chatPreviewAnon(shares);
}

export function ShareSheet(props: { envelope: SentEnvelope; from: string | null }) {
  const { t } = useI18n();
  const { envelope } = props;
  const line = chatLine(props.from, envelope.sharesTotal, t);
  const done = () => navigate('/');
  return (
    <Sheet open title={t.create.successTitle} onClose={done}>
      <div class="stack">
        <p>{t.create.successBody}</p>
        <figure class="chat">
          <figcaption class="eyebrow">{t.create.previewLabel}</figcaption>
          <blockquote class="chat__bubble">
            <p>{line}</p>
            <p class="chat__link num">{envelope.link}</p>
          </blockquote>
        </figure>
        {canShare() && (
          <button
            type="button"
            class="btn btn--primary btn--huge"
            onClick={() => shareLink(line, envelope.link)}
          >
            <ShareIcon />
            {t.create.share}
          </button>
        )}
        <CopyButton
          text={envelope.link}
          label={t.create.copyLink}
          class={canShare() ? 'btn' : 'btn btn--primary btn--huge'}
        />
        <p class="soft" style="font-size:var(--text-s)">
          {t.create.cashNote}
        </p>
        <button type="button" class="btn btn--plain" style="align-self:center" onClick={done}>
          {t.create.done}
        </button>
      </div>
    </Sheet>
  );
}
