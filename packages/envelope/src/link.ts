// SPDX-License-Identifier: AGPL-3.0-or-later
import { toBase64Url, tryFromBase64Url } from './base64url';
import {
  MAX_FROM_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_SHARES,
  PUBLIC_KEY_BYTES,
  SECRET_BYTES,
} from './constants';
import { EnvelopeError } from './errors';
import { sanitizeText } from './text';

/** Everything an envelope link carries. `publicKey` is public; `secret` opens the shares. */
export interface EnvelopeLink {
  publicKey: Uint8Array;
  secret: Uint8Array;
  /** How many shares exist. A hint that saves key derivations; the chain is the truth. */
  shares?: number;
  from?: string;
  message?: string;
}

function badLink(why: string): EnvelopeError {
  return new EnvelopeError('bad_link', why);
}

/** Builds `{origin}/g/{pk b64url}?n=&from=&m=#{secret b64url}`; empty parts are left out. */
export function encodeLink(origin: string, link: EnvelopeLink): string {
  if (link.publicKey.length !== PUBLIC_KEY_BYTES) throw badLink('public key must be 48 bytes');
  if (link.secret.length !== SECRET_BYTES) throw badLink('secret must be 16 bytes');
  const query = new URLSearchParams();
  if (link.shares !== undefined) {
    if (!validShares(link.shares)) throw badLink('shares must be 1 to 100');
    query.set('n', String(link.shares));
  }
  const from = sanitizeText(link.from ?? '', MAX_FROM_CHARS);
  const message = sanitizeText(link.message ?? '', MAX_MESSAGE_CHARS);
  if (from !== '') query.set('from', from);
  if (message !== '') query.set('m', message);
  const search = query.size > 0 ? `?${query}` : '';
  const base = origin.replace(/\/+$/, '');
  return `${base}/g/${toBase64Url(link.publicKey)}${search}#${toBase64Url(link.secret)}`;
}

function validShares(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_SHARES;
}

function parseUrl(text: string): URL {
  let raw = text.trim();
  // Some apps percent-encode the whole link, which hides the fragment inside the query or path.
  if (!raw.includes('#')) {
    const at = raw.toLowerCase().lastIndexOf('%23');
    if (at >= 0) raw = `${raw.slice(0, at)}#${raw.slice(at + 3)}`;
  }
  try {
    return new URL(raw);
  } catch {
    throw badLink('not a URL');
  }
}

function decodeBytes(text: string, length: number, what: string): Uint8Array {
  const bytes = tryFromBase64Url(text);
  if (bytes === null || bytes.length !== length) throw badLink(`${what} must be ${length} bytes`);
  return bytes;
}

function secretFromFragment(hash: string): Uint8Array {
  let fragment = hash.replace(/^#/, '');
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // keep the raw fragment
  }
  // Take the leading base64url run; tolerate padding and anything a messenger glued on after it.
  const match = /^([A-Za-z0-9_-]+)=*(?:[^A-Za-z0-9_=-].*)?$/s.exec(fragment);
  if (match?.[1] === undefined) throw badLink('no secret in the fragment');
  return decodeBytes(match[1], SECRET_BYTES, 'secret');
}

/** Parses an envelope link; tolerates tracking parameters and an encoded fragment. Throws `EnvelopeError('bad_link')`. */
export function decodeLink(url: string): EnvelopeLink {
  const parsed = parseUrl(url);
  const path = /\/g\/([A-Za-z0-9_-]+)=*\/?$/.exec(parsed.pathname);
  if (path?.[1] === undefined) throw badLink('no /g/{key} path');
  const link: EnvelopeLink = {
    publicKey: decodeBytes(path[1], PUBLIC_KEY_BYTES, 'public key'),
    secret: secretFromFragment(parsed.hash),
  };
  // A damaged count is ignored, not fatal: the opener then scans for shares.
  const shares = Number(parsed.searchParams.get('n') ?? Number.NaN);
  if (validShares(shares)) link.shares = shares;
  const from = sanitizeText(parsed.searchParams.get('from') ?? '', MAX_FROM_CHARS);
  const message = sanitizeText(parsed.searchParams.get('m') ?? '', MAX_MESSAGE_CHARS);
  if (from !== '') link.from = from;
  if (message !== '') link.message = message;
  return link;
}
