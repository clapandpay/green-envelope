// SPDX-License-Identifier: AGPL-3.0-or-later
// A tab opened before a release asks for the screens of that release, whose files are gone
// (each build names them by their content): the server answers 404. One reload fetches the
// current page and its current files. Only once a minute, so a phone that is really offline
// gets the "try again" message instead of a reload loop.

const KEY = 'ge.reloadedAt';
const ONCE_PER_MS = 60_000;

/** Reloads the page for a newer build, unless it already did so a moment ago. True: reloading. */
export function reloadForNewBuild(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSessionStorage(),
  now: number = Date.now(),
  reload: () => void = () => location.reload(),
): boolean {
  if (storage === null) return false; // no way to know it is not a loop, so do not start one
  try {
    const last = Number(storage.getItem(KEY) ?? '0');
    if (now - last < ONCE_PER_MS) return false;
    storage.setItem(KEY, String(now));
  } catch {
    return false; // no storage: no way to know it is not a loop, so do not start one
  }
  reload();
  return true;
}

function safeSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
