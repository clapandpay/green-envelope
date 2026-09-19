// SPDX-License-Identifier: AGPL-3.0-or-later
// Bech32m (BIP-350) for Chia addresses: the 32-byte puzzle hash under the prefix `xch` or `txch`.
import type { Bytes } from './bytes';
import { ChiaError } from './errors';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymodStep(chk: number, value: number): number {
  const top = chk >>> 25;
  let next = ((chk & 0x1ffffff) << 5) ^ value;
  for (let i = 0; i < 5; i++) {
    if (((top >>> i) & 1) !== 0) next ^= GENERATORS[i] ?? 0;
  }
  return next;
}

function prefixChecksum(prefix: string): number {
  let chk = 1;
  for (let i = 0; i < prefix.length; i++) chk = polymodStep(chk, prefix.charCodeAt(i) >>> 5);
  chk = polymodStep(chk, 0);
  for (let i = 0; i < prefix.length; i++) chk = polymodStep(chk, prefix.charCodeAt(i) & 31);
  return chk;
}

function checkPrefix(prefix: string): void {
  if (prefix.length < 1 || prefix.length > 83) {
    throw new ChiaError('bad_address', 'address prefix must be 1 to 83 characters');
  }
  for (let i = 0; i < prefix.length; i++) {
    const code = prefix.charCodeAt(i);
    if (code < 33 || code > 126 || (code >= 65 && code <= 90)) {
      throw new ChiaError('bad_address', 'address prefix must be lowercase printable ASCII');
    }
  }
}

/** Bech32m address of a 32-byte puzzle hash, e.g. prefix `xch` or `txch`. */
export function encodeAddress(puzzleHash: Bytes, prefix: string): string {
  if (puzzleHash.length !== 32) throw new ChiaError('bad_length', 'puzzle hash must be 32 bytes');
  checkPrefix(prefix);

  let chk = prefixChecksum(prefix);
  let out = `${prefix}1`;
  // 8-bit bytes to 5-bit groups, padded with zero bits.
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < puzzleHash.length; i++) {
    acc = ((acc << 8) | (puzzleHash[i] ?? 0)) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const group = (acc >> bits) & 31;
      chk = polymodStep(chk, group);
      out += CHARSET.charAt(group);
    }
  }
  if (bits > 0) {
    const group = (acc << (5 - bits)) & 31;
    chk = polymodStep(chk, group);
    out += CHARSET.charAt(group);
  }
  for (let i = 0; i < 6; i++) chk = polymodStep(chk, 0);
  chk ^= BECH32M_CONST;
  for (let i = 0; i < 6; i++) out += CHARSET.charAt((chk >>> (5 * (5 - i))) & 31);
  return out;
}

/** Parses a bech32m address; throws `ChiaError('bad_address')` unless it holds exactly 32 bytes. */
export function decodeAddress(address: string): { puzzleHash: Bytes; prefix: string } {
  if (typeof address !== 'string') throw new ChiaError('bad_address', 'address must be a string');
  const lower = address.toLowerCase();
  if (address !== lower && address !== address.toUpperCase()) {
    throw new ChiaError('bad_address', 'address mixes upper and lower case');
  }
  const separator = lower.lastIndexOf('1');
  if (separator < 1) throw new ChiaError('bad_address', 'address has no prefix');
  const prefix = lower.slice(0, separator);
  checkPrefix(prefix);
  const dataLength = lower.length - separator - 1 - 6;
  // 32 bytes are 52 five-bit groups (256 bits plus 4 bits of padding).
  if (dataLength !== 52) throw new ChiaError('bad_address', 'address does not hold 32 bytes');

  let chk = prefixChecksum(prefix);
  const puzzleHash = new Uint8Array(32);
  let acc = 0;
  let bits = 0;
  let offset = 0;
  for (let i = separator + 1; i < lower.length; i++) {
    const value = CHARSET.indexOf(lower.charAt(i));
    if (value < 0) throw new ChiaError('bad_address', 'address has an invalid character');
    chk = polymodStep(chk, value);
    if (i >= lower.length - 6) continue; // checksum characters
    acc = ((acc << 5) | value) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      puzzleHash[offset++] = (acc >> bits) & 0xff;
    }
  }
  if (chk !== BECH32M_CONST) throw new ChiaError('bad_address', 'address checksum is wrong');
  if ((acc & ((1 << bits) - 1)) !== 0) {
    throw new ChiaError('bad_address', 'address has non-zero padding');
  }
  return { puzzleHash, prefix };
}
