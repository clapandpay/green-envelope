// SPDX-License-Identifier: AGPL-3.0-or-later
// Handing a link to the phone's share sheet, or to the clipboard.

/** True when the system share sheet exists (most phones; few desktops). */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Opens the share sheet. False when the person closed it or it failed. */
export async function shareLink(text: string, url: string): Promise<boolean> {
  try {
    await navigator.share({ text, url });
    return true;
  } catch {
    return false;
  }
}

/** Copies text; falls back to a hidden field where the clipboard API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let done = false;
    try {
      done = document.execCommand('copy');
    } catch {
      done = false;
    }
    field.remove();
    return done;
  }
}
