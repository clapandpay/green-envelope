// SPDX-License-Identifier: AGPL-3.0-or-later
// Local on purpose: request validation and the RPC edge must not pull the BLS code of `@ge/chia`
// into every route, and the tests of this app run without the real crypto.

/** Byte length of a compressed BLS12-381 G1 public key. */
export const PUBLIC_KEY_BYTES = 48;

// 48 bytes are exactly 64 base64url characters: no padding and no spare bits, so every string
// that matches is canonical.
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{64}$/;

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

/** Lowercase hex with the `0x` prefix the Chia RPC expects. */
export function toHex0x(bytes: Uint8Array): string {
  let out = '0x';
  for (const byte of bytes) out += HEX[byte];
  return out;
}

/** Decodes the `:pk` path segment; `null` unless it is base64url of exactly 48 bytes. */
export function parsePublicKey(segment: string): Uint8Array | null {
  if (!PUBLIC_KEY_PATTERN.test(segment)) return null;
  const binary = atob(segment.replaceAll('-', '+').replaceAll('_', '/'));
  const out = new Uint8Array(PUBLIC_KEY_BYTES);
  for (let i = 0; i < PUBLIC_KEY_BYTES; i++) out[i] = binary.charCodeAt(i);
  return out;
}
