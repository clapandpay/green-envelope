// SPDX-License-Identifier: AGPL-3.0-or-later
// A bottom sheet on the native <dialog>: focus trap, Escape and the backdrop come for free.
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { useI18n } from '../i18n';
import { CloseIcon } from './icons';

export function Sheet(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is the backdrop tap; the keyboard has Escape, which <dialog> handles itself
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby={titleId}
      onClose={props.onClose}
      onClick={(event) => {
        if (event.target === ref.current) props.onClose(); // a tap on the backdrop
      }}
    >
      {props.open && (
        <>
          <div class="sheet__head">
            <h2 id={titleId}>{props.title}</h2>
            <button
              type="button"
              class="icon-btn"
              aria-label={t.common.close}
              onClick={props.onClose}
            >
              <CloseIcon />
            </button>
          </div>
          {props.children}
        </>
      )}
    </dialog>
  );
}
