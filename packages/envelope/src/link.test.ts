// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toBase64Url, tryFromBase64Url } from './base64url';
import { MAX_FROM_CHARS, MAX_MESSAGE_CHARS, PUBLIC_KEY_BYTES, SECRET_BYTES } from './constants';
import { EnvelopeError } from './errors';
import { decodeLink, type EnvelopeLink, encodeLink } from './link';
import { sanitizeText } from './text';

const ORIGIN = 'https://clapandpay.com';
const publicKey = Uint8Array.from({ length: PUBLIC_KEY_BYTES }, (_, i) => 255 - i);
const secret = Uint8Array.from({ length: SECRET_BYTES }, (_, i) => i * 17);
const PK = toBase64Url(publicKey);
const SECRET = toBase64Url(secret);

const anyText = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 150 }),
  fc.string({ unit: 'binary', maxLength: 150 }),
  fc.constantFrom(
    'Anna',
    'Jürgen Müller',
    '👨‍👩‍👧‍👦 Familie',
    'שלום',
    '  x  ',
    'a&b=c#d?e+f%20g',
    '生日快乐 🎂',
  ),
);

function expectBadLink(url: string): void {
  expect(() => decodeLink(url)).toThrow(EnvelopeError);
  expect(() => decodeLink(url)).toThrow(expect.objectContaining({ code: 'bad_link' }));
}

describe('encodeLink', () => {
  it('matches the documented shape', () => {
    const url = encodeLink(`${ORIGIN}/`, {
      publicKey,
      secret,
      from: 'Anna',
      message: 'Happy birthday',
    });
    expect(url).toBe(`${ORIGIN}/g/${PK}?from=Anna&m=Happy+birthday#${SECRET}`);
    expect(PK).toHaveLength(64);
    expect(SECRET).toHaveLength(22);
  });

  it('leaves out empty fields and the question mark with them', () => {
    expect(encodeLink(ORIGIN, { publicKey, secret, from: '   ' })).toBe(
      `${ORIGIN}/g/${PK}#${SECRET}`,
    );
  });

  it('refuses wrong lengths', () => {
    expect(() => encodeLink(ORIGIN, { publicKey: publicKey.slice(1), secret })).toThrow(
      EnvelopeError,
    );
    expect(() => encodeLink(ORIGIN, { publicKey, secret: new Uint8Array(32) })).toThrow(
      EnvelopeError,
    );
  });
});

describe('round trip', () => {
  it('returns the same bytes and the sanitized texts, unicode and emoji included', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: PUBLIC_KEY_BYTES, maxLength: PUBLIC_KEY_BYTES }),
        fc.uint8Array({ minLength: SECRET_BYTES, maxLength: SECRET_BYTES }),
        fc.option(anyText, { nil: undefined }),
        fc.option(anyText, { nil: undefined }),
        (pk, sec, from, message) => {
          const link: EnvelopeLink = { publicKey: pk, secret: sec };
          if (from !== undefined) link.from = from;
          if (message !== undefined) link.message = message;
          const url = encodeLink(ORIGIN, link);
          const back = decodeLink(url);
          expect(back.publicKey).toEqual(pk);
          expect(back.secret).toEqual(sec);
          const wantFrom = sanitizeText(from ?? '', MAX_FROM_CHARS);
          const wantMessage = sanitizeText(message ?? '', MAX_MESSAGE_CHARS);
          expect(back.from).toBe(wantFrom === '' ? undefined : wantFrom);
          expect(back.message).toBe(wantMessage === '' ? undefined : wantMessage);
          expect('from' in back).toBe(wantFrom !== '');
          expect(encodeLink(ORIGIN, back)).toBe(url); // canonical
        },
      ),
      { numRuns: 500 },
    );
  });

  it('keeps emoji and non-Latin text intact', () => {
    const link = {
      publicKey,
      secret,
      from: 'Jürgen 🎉',
      message: '生日快乐 👨‍👩‍👧‍👦 & viel Glück #1?',
    };
    expect(decodeLink(encodeLink(ORIGIN, link))).toEqual(link);
  });
});

describe('decodeLink', () => {
  const plain = `${ORIGIN}/g/${PK}?from=Anna&m=Hi#${SECRET}`;
  const want = { publicKey, secret, from: 'Anna', message: 'Hi' };

  it.each([
    [
      'tracking parameters',
      `${ORIGIN}/g/${PK}?fbclid=IwAR0&from=Anna&utm_source=wa&m=Hi#${SECRET}`,
    ],
    ['a trailing slash', `${ORIGIN}/g/${PK}/?from=Anna&m=Hi#${SECRET}`],
    [
      'a path prefix and another origin',
      `http://localhost:5173/app/g/${PK}?from=Anna&m=Hi#${SECRET}`,
    ],
    ['surrounding whitespace', `  ${plain}\n`],
    ['a padded fragment', `${plain}==`],
    ['a percent-encoded padded fragment', `${plain}%3D%3D`],
    ['parameters glued to the fragment', `${plain}?fbclid=abc`],
    ['more parameters glued to the fragment', `${plain}&utm_medium=social`],
    [
      'a fully percent-encoded fragment',
      `${ORIGIN}/g/${PK}?from=Anna&m=Hi#${[...SECRET].map((c) => `%${c.charCodeAt(0).toString(16)}`).join('')}`,
    ],
    ['an encoded hash sign', `${ORIGIN}/g/${PK}?from=Anna&m=Hi%23${SECRET}`],
  ])('accepts %s', (_, url) => {
    expect(decodeLink(url)).toEqual(want);
  });

  it('accepts an encoded hash sign when there is no query', () => {
    expect(decodeLink(`${ORIGIN}/g/${PK}%23${SECRET}`)).toEqual({ publicKey, secret });
  });

  it('takes the first of duplicated parameters', () => {
    expect(decodeLink(`${ORIGIN}/g/${PK}?from=Anna&from=Eve#${SECRET}`).from).toBe('Anna');
  });

  it('sanitizes hostile text from the link', () => {
    const long = 'x'.repeat(500);
    const url = `${ORIGIN}/g/${PK}?from=%E2%80%AEevil%00%0A%20name&m=${long}#${SECRET}`;
    const link = decodeLink(url);
    expect(link.from).toBe('evil name');
    expect(link.message).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it.each([
    ['not a URL', 'hello'],
    ['empty', ''],
    ['no /g/ path', `${ORIGIN}/x/${PK}#${SECRET}`],
    ['no fragment', `${ORIGIN}/g/${PK}?from=Anna`],
    ['an empty fragment', `${ORIGIN}/g/${PK}#`],
    ['a short key', `${ORIGIN}/g/${PK.slice(4)}#${SECRET}`],
    ['a long key', `${ORIGIN}/g/${PK}AAAA#${SECRET}`],
    ['a key with a bad character', `${ORIGIN}/g/${PK.slice(1)}*#${SECRET}`],
    ['a short secret', `${ORIGIN}/g/${PK}#${SECRET.slice(2)}`],
    ['a long secret', `${ORIGIN}/g/${PK}#${SECRET}AAAA`],
    ['an impossible base64 length', `${ORIGIN}/g/${PK}#${SECRET.slice(1)}`],
    ['a fragment that starts with junk', `${ORIGIN}/g/${PK}#?${SECRET}`],
    ['broken percent-encoding', `${ORIGIN}/g/${PK}#%E0%A4%A`],
  ])('refuses %s', (_, url) => {
    expectBadLink(url);
  });
});

describe('sanitizeText', () => {
  it('is idempotent and respects the limit for any input', () => {
    fc.assert(
      fc.property(anyText, fc.integer({ min: 1, max: 130 }), (text, max) => {
        const once = sanitizeText(text, max);
        expect(sanitizeText(once, max)).toBe(once);
        expect(Array.from(once).length).toBeLessThanOrEqual(max);
        expect(once).toBe(once.trim());
        expect(/\p{Cc}/u.test(once)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it('collapses whitespace, strips controls and bidi overrides, never splits an emoji', () => {
    expect(sanitizeText(' a\t\n b\u0000\u{202E}c ', 40)).toBe('a bc');
    expect(sanitizeText('a \u0001 b', 40)).toBe('a b');
    expect(sanitizeText('e\u0001\u{301}', 40)).toBe('é');
    expect(sanitizeText('ab🎂', 3)).toBe('ab🎂');
    expect(sanitizeText('ab🎂', 2)).toBe('ab');
    expect(sanitizeText('👨‍👩', 2)).toBe('👨'); // no dangling joiner
    expect(sanitizeText('\uD83D', 5)).toBe(String.fromCodePoint(0xfffd));
    expect(sanitizeText('x'.repeat(50), MAX_FROM_CHARS)).toHaveLength(MAX_FROM_CHARS);
  });
});

describe('base64url', () => {
  it('round-trips and has no padding or URL-unsafe characters', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const text = toBase64Url(bytes);
        expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
        expect(tryFromBase64Url(text)).toEqual(bytes);
      }),
    );
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe('-_8');
  });

  it('returns null for bad input', () => {
    expect(tryFromBase64Url('a+b/')).toBeNull();
    expect(tryFromBase64Url('abcde')).toBeNull();
    expect(tryFromBase64Url('ab=')).toBeNull();
  });
});
