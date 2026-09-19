// SPDX-License-Identifier: AGPL-3.0-or-later
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { ChiaError } from './errors';

/** Raw bytes; the only byte representation used inside the code. */
export type Bytes = Uint8Array;

const HEX_CHARS = '0123456789abcdef';
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Lookup tables are built on first use so that importing this module does no work.
let hexTable: string[] | undefined;
let b64Reverse: Int8Array | undefined;

function hexPairs(): string[] {
  if (hexTable === undefined) {
    hexTable = [];
    for (let i = 0; i < 256; i++) {
      hexTable.push(HEX_CHARS.charAt(i >> 4) + HEX_CHARS.charAt(i & 15));
    }
  }
  return hexTable;
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 97 && code <= 102) return code - 87; // a-f
  if (code >= 65 && code <= 70) return code - 55; // A-F
  return -1;
}

/** Lowercase hex without a `0x` prefix. */
export function toHex(b: Bytes): string {
  const table = hexPairs();
  let out = '';
  for (let i = 0; i < b.length; i++) out += table[b[i] ?? 0];
  return out;
}

/** Parses hex with an optional `0x` prefix; throws `ChiaError('bad_hex')` on anything else. */
export function fromHex(hex: string): Bytes {
  if (typeof hex !== 'string') throw new ChiaError('bad_hex', 'hex must be a string');
  const start = hex.startsWith('0x') || hex.startsWith('0X') ? 2 : 0;
  const digits = hex.length - start;
  if (digits % 2 !== 0) throw new ChiaError('bad_hex', 'hex has an odd number of digits');
  const out = new Uint8Array(digits / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = hexNibble(hex.charCodeAt(start + 2 * i));
    const lo = hexNibble(hex.charCodeAt(start + 2 * i + 1));
    if (hi < 0 || lo < 0) throw new ChiaError('bad_hex', 'hex has a character outside 0-9a-f');
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/** Joins byte arrays into one new array with a single allocation. */
export function concatBytes(...parts: Bytes[]): Bytes {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Byte-wise equality; runs in time independent of where the arrays differ. */
export function equalBytes(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** SHA-256 of the concatenation of `parts`, without concatenating them. */
export function sha256(...parts: Bytes[]): Bytes {
  if (parts.length === 1 && parts[0] !== undefined) return nobleSha256(parts[0]);
  const hasher = nobleSha256.create();
  for (const part of parts) hasher.update(part);
  return hasher.digest();
}

/** Base64url (RFC 4648 section 5) without padding. */
export function toBase64Url(b: Bytes): string {
  let out = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out +=
      B64_CHARS.charAt(n >> 18) +
      B64_CHARS.charAt((n >> 12) & 63) +
      B64_CHARS.charAt((n >> 6) & 63) +
      B64_CHARS.charAt(n & 63);
  }
  const rest = b.length - i;
  if (rest === 1) {
    const n = (b[i] ?? 0) << 16;
    out += B64_CHARS.charAt(n >> 18) + B64_CHARS.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8);
    out +=
      B64_CHARS.charAt(n >> 18) +
      B64_CHARS.charAt((n >> 12) & 63) +
      B64_CHARS.charAt((n >> 6) & 63);
  }
  return out;
}

function b64Value(code: number): number {
  if (b64Reverse === undefined) {
    b64Reverse = new Int8Array(128).fill(-1);
    for (let i = 0; i < B64_CHARS.length; i++) b64Reverse[B64_CHARS.charCodeAt(i)] = i;
  }
  return code < 128 ? (b64Reverse[code] ?? -1) : -1;
}

/** Parses unpadded base64url strictly: no padding, no stray bits; throws `ChiaError('bad_base64url')`. */
export function fromBase64Url(s: string): Bytes {
  if (typeof s !== 'string') throw new ChiaError('bad_base64url', 'base64url must be a string');
  const rest = s.length % 4;
  if (rest === 1) throw new ChiaError('bad_base64url', 'base64url has an impossible length');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let offset = 0;
  for (let i = 0; i < s.length; i++) {
    const value = b64Value(s.charCodeAt(i));
    if (value < 0) throw new ChiaError('bad_base64url', 'base64url has an invalid character');
    acc = ((acc << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset++] = (acc >> bits) & 0xff;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) {
    throw new ChiaError('bad_base64url', 'base64url has non-zero trailing bits');
  }
  return out;
}
