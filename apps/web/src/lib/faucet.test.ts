// SPDX-License-Identifier: AGPL-3.0-or-later
import { encodeLink } from '@ge/envelope';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptFaucetLink,
  DEFAULT_RETRY_SECONDS,
  FAUCET_TIMEOUT_MS,
  type FaucetConfig,
  faucetConfig,
  MAX_RETRY_SECONDS,
  parseFaucetBody,
  parseRemembered,
  parseRetryAfter,
  requestFaucet,
} from './faucet';

const PAGE = 'https://app.test';
const ORIGINS = [PAGE, 'https://clapandpay.com'];
const key = new Uint8Array(48).fill(7);
const secret = new Uint8Array(16).fill(9);
const good = (origin = PAGE) =>
  encodeLink(origin, { publicKey: key, secret, shares: 1, from: 'Clap and Pay' });
const KEY_B64 = 'A'.repeat(64);
const SECRET_B64 = 'B'.repeat(22);

afterEach(() => vi.useRealTimers());

describe('faucetConfig', () => {
  it('is off without a usable URL', () => {
    for (const url of [
      undefined,
      '',
      '   ',
      'not a url',
      'javascript:alert(1)',
      'http://faucet.example/x',
      'https://u:p@faucet.example/',
    ]) {
      expect(faucetConfig(url, undefined, PAGE), String(url)).toBeNull();
    }
  });

  it('allows http only on localhost, and keeps only safe extra origins', () => {
    expect(faucetConfig('http://localhost:8787/faucet', undefined, PAGE)?.url).toBe(
      'http://localhost:8787/faucet',
    );
    const config = faucetConfig(
      'https://f.test/api',
      'https://clapandpay.com, javascript:x, http://evil.test, nonsense',
      PAGE,
    );
    expect(config?.origins).toEqual([PAGE, 'https://clapandpay.com']);
  });
});

describe('acceptFaucetLink', () => {
  it('turns a good link into an in-app path, secret and all', () => {
    const path = acceptFaucetLink(good(), ORIGINS);
    expect(path).toMatch(/^\/g\/[A-Za-z0-9_-]{64}\?n=1&from=Clap\+and\+Pay#[A-Za-z0-9_-]{22}$/);
  });

  it('accepts an allowlisted origin but only ever returns a path', () => {
    expect(acceptFaucetLink(good('https://clapandpay.com'), ORIGINS)?.startsWith('/g/')).toBe(true);
  });

  it('drops parameters it does not know', () => {
    const noisy = good().replace('?', '?redirect=https://evil.test&utm=x&');
    const path = acceptFaucetLink(noisy, ORIGINS);
    expect(path).not.toBeNull();
    expect(path).not.toContain('evil');
    expect(path).not.toContain('utm');
  });

  it.each([
    ['javascript url', 'javascript:alert(1)//g/AAAA#BBBB'],
    ['data url', 'data:text/html,<script>1</script>'],
    ['other origin', good('https://evil.test')],
    ['lookalike origin', good('https://app.test.evil.test')],
    ['userinfo trick', `https://app.test@evil.test/g/${KEY_B64}#${SECRET_B64}`],
    ['protocol-relative', `//evil.test/g/${KEY_B64}#${SECRET_B64}`],
    ['backslash', `https://app.test\\@evil.test/g/${KEY_B64}#${SECRET_B64}`],
    ['no fragment', good().split('#')[0]],
    ['empty fragment', `${good().split('#')[0]}#`],
    ['short key', `${PAGE}/g/AAAA#${SECRET_B64}`],
    ['wrong path', good().replace('/g/', '/x/')],
    ['trailing path', good().replace('?', '/more?')],
    ['newline', `${good()}\n`],
    ['space', ` ${good()}`],
    ['plain http', good().replace('https:', 'http:')],
    ['too long', `${good()}${'a'.repeat(3000)}`],
    ['empty', ''],
  ])('refuses %s', (_name, link) => {
    expect(acceptFaucetLink(link, ORIGINS)).toBeNull();
  });

  it('refuses everything that is not a string', () => {
    for (const value of [undefined, null, 1, true, {}, [good()], { toString: () => good() }]) {
      expect(acceptFaucetLink(value, ORIGINS)).toBeNull();
    }
  });

  it('never throws and only ever returns an envelope path, whatever it is fed', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.webUrl(), fc.anything()), (link) => {
        const path = acceptFaucetLink(link, ORIGINS);
        if (path !== null) expect(path).toMatch(/^\/g\/[A-Za-z0-9_-]+(\?[^#]*)?#[A-Za-z0-9_-]+$/);
      }),
      { numRuns: 500 },
    );
  });

  it('keeps the key and the secret of any link the codec made', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 48, maxLength: 48 }),
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        fc.string({ maxLength: 20 }),
        (publicKey, sec, from) => {
          const link = encodeLink(PAGE, { publicKey, secret: sec, shares: 3, from });
          const path = acceptFaucetLink(link, ORIGINS);
          expect(path).not.toBeNull();
          const out = new URL(`${PAGE}${path}`);
          expect(out.pathname).toBe(new URL(link).pathname);
          expect(out.hash).toBe(new URL(link).hash);
        },
      ),
    );
  });
});

describe('parseFaucetBody', () => {
  it('reads the two documented answers', () => {
    expect(parseFaucetBody({ link: good() }, ORIGINS).kind).toBe('link');
    expect(parseFaucetBody({ status: 'empty' }, ORIGINS)).toEqual({ kind: 'empty' });
  });

  it('calls everything else broken', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      'empty',
      42,
      [],
      [{ link: good() }],
      {},
      { status: 'ok' },
      { status: 'EMPTY' },
      { status: ['empty'] },
      { status: 'empty', link: good() }, // contradicting itself
      { link: 1 },
      { link: { href: good() } },
      { link: 'javascript:alert(1)' },
      { link: good('https://evil.test') },
    ];
    for (const body of hostile) {
      expect(parseFaucetBody(body, ORIGINS), JSON.stringify(body)).toEqual({ kind: 'broken' });
    }
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');

  it('reads seconds and dates, and clamps', () => {
    expect(parseRetryAfter('12', now)).toBe(12);
    expect(parseRetryAfter(' 5 ', now)).toBe(5);
    expect(parseRetryAfter('Mon, 05 Oct 2026 12:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('0', now)).toBe(1);
    expect(parseRetryAfter('99999999', now)).toBe(MAX_RETRY_SECONDS);
    expect(parseRetryAfter('Mon, 05 Oct 2026 11:00:00 GMT', now)).toBe(1);
  });

  it('falls back to a default for anything unreadable', () => {
    expect(parseRetryAfter(null, now)).toBe(DEFAULT_RETRY_SECONDS);
    expect(parseRetryAfter('soon', now)).toBe(DEFAULT_RETRY_SECONDS);
    expect(parseRetryAfter('1.5', now)).toBe(DEFAULT_RETRY_SECONDS);
  });

  it('always lands inside the limits', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(null)), (header) => {
        const seconds = parseRetryAfter(header, now);
        expect(seconds).toBeGreaterThanOrEqual(1);
        expect(seconds).toBeLessThanOrEqual(MAX_RETRY_SECONDS);
      }),
    );
  });
});

describe('requestFaucet', () => {
  const config: FaucetConfig = { url: 'https://f.test/api', origins: ORIGINS };
  const reply = (body: string | object, init: ResponseInit = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), init);
  const as = (fn: unknown) => fn as typeof fetch;

  it('asks plainly: GET, no cookies, no referrer, no redirects', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      reply({ link: good() }),
    );
    expect((await requestFaucet(config, as(fetcher))).kind).toBe('link');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  });

  it('maps empty, 429 and server errors, and does not retry an answer', async () => {
    const empty = vi.fn(async () => reply({ status: 'empty' }));
    expect(await requestFaucet(config, as(empty))).toEqual({ kind: 'empty' });
    const limited = vi.fn(async () => reply('', { status: 429, headers: { 'retry-after': '17' } }));
    expect(await requestFaucet(config, as(limited))).toEqual({
      kind: 'limited',
      retryAfterSeconds: 17,
    });
    expect(limited).toHaveBeenCalledTimes(1);
    const bare = vi.fn(async () => reply('', { status: 429 }));
    expect(await requestFaucet(config, as(bare))).toEqual({
      kind: 'limited',
      retryAfterSeconds: DEFAULT_RETRY_SECONDS,
    });
    const down = vi.fn(async () => reply('boom', { status: 503 }));
    expect(await requestFaucet(config, as(down))).toEqual({ kind: 'broken' });
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('retries once after a network failure, and then says offline', async () => {
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply({ link: good() }));
    expect((await requestFaucet(config, as(flaky))).kind).toBe('link');
    expect(flaky).toHaveBeenCalledTimes(2);
    const dead = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await requestFaucet(config, as(dead))).toEqual({ kind: 'offline' });
    expect(dead).toHaveBeenCalledTimes(2);
  });

  it('gives up on a silent server after the timeout', async () => {
    vi.useFakeTimers();
    const hang = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = requestFaucet(config, as(hang));
    await vi.advanceTimersByTimeAsync(FAUCET_TIMEOUT_MS * 2 + 10);
    expect(await pending).toEqual({ kind: 'offline' });
    expect(hang).toHaveBeenCalledTimes(2);
  });

  it('never trusts the body', async () => {
    for (const text of ['<html>', '{"link": 5}', 'null', `{"pad":"${'x'.repeat(5000)}"}`, '[]']) {
      const fetcher = vi.fn(async () => reply(text));
      expect(await requestFaucet(config, as(fetcher)), text.slice(0, 20)).toEqual({
        kind: 'broken',
      });
    }
  });
});

describe('parseRemembered', () => {
  it('takes back only what it would have accepted fresh', () => {
    const path = acceptFaucetLink(good(), ORIGINS) ?? '';
    expect(parseRemembered(path, PAGE)).toBe(path);
    for (const bad of [
      null,
      '',
      '/g/x#y',
      'https://evil.test/x',
      '//evil.test/g/a#b',
      '/new',
      'javascript:1',
    ]) {
      expect(parseRemembered(bad, PAGE), String(bad)).toBeNull();
    }
  });
});
