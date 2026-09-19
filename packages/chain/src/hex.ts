// SPDX-License-Identifier: AGPL-3.0-or-later
// Duplicates `toHex` / `fromHex` of `@ge/chia` (plus the 0x prefix) until that package lands.
import type { Bytes } from './types';

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

/** Lowercase hex with the `0x` prefix the Chia RPC expects. */
export function toHex0x(bytes: Bytes): string {
  let out = '0x';
  for (const byte of bytes) out += HEX[byte];
  return out;
}

function nibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 97 && code <= 102) return code - 87; // a-f
  if (code >= 65 && code <= 70) return code - 55; // A-F
  return -1;
}

/** Parses hex with an optional `0x` prefix; returns `null` instead of throwing on bad input. */
export function tryFromHex(hex: string): Bytes | null {
  const start = hex.startsWith('0x') || hex.startsWith('0X') ? 2 : 0;
  const digits = hex.length - start;
  if (digits % 2 !== 0) return null;
  const out = new Uint8Array(digits / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = nibble(hex.charCodeAt(start + 2 * i));
    const lo = nibble(hex.charCodeAt(start + 2 * i + 1));
    if (hi < 0 || lo < 0) return null;
    out[i] = (hi << 4) | lo;
  }
  return out;
}
