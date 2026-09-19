// SPDX-License-Identifier: AGPL-3.0-or-later
// Duplicates `toBase64Url` / `fromBase64Url` of `@ge/chia` until that package lands.

/** Base64url without padding. Meant for short values (keys, secrets). */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes unpadded base64url; returns `null` instead of throwing on bad input. */
export function tryFromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
