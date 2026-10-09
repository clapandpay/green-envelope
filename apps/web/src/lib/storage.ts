// SPDX-License-Identifier: AGPL-3.0-or-later
// localStorage that never throws: private windows and in-app browsers may refuse it.

/** Reads a remembered preference, or null. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remembers a preference; an empty value forgets it. */
export function writePref(key: string, value: string): void {
  try {
    if (value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the app works without remembered preferences.
  }
}

export const PREF_LANG = 'ge.lang';
export const PREF_NAME = 'ge.name';
export const PREF_ALPHA_DISMISSED = 'ge.alphaDismissed';
