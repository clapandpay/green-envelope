// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { ChainLookup } from './chain';
import { createHandler } from './handler';
import {
  assetsWith,
  chainWith,
  coins,
  SHELL_WITHOUT_TAGS,
  testConfig,
  testDeps,
  VALID_PK,
} from './test-fakes';

const ORIGIN = 'https://edge.test';
const PUBLIC = 'https://clapandpay.test';

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(ORIGIN + path, { headers });
}

function metaContent(html: string, key: string): string | null {
  const match = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html);
  return match?.[1] ?? null;
}

describe('GET /g/:pk', () => {
  it('renders the shell with per-link tags and live share state', async () => {
    const handler = createHandler(
      testDeps({ chain: chainWith(coins(true, true, false, false, false)) }),
    );
    const response = await handler(get(`/g/${VALID_PK}?from=Anna&m=Happy+birthday`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html).toContain('<title>🟢 Green envelope from Anna</title>');
    expect(metaContent(html, 'og:title')).toBe('🟢 Green envelope from Anna');
    expect(metaContent(html, 'og:description')).toBe('Happy birthday — 3 of 5 left · tap to open');
    expect(metaContent(html, 'description')).toBe('Happy birthday — 3 of 5 left · tap to open');
    expect(metaContent(html, 'og:image')).toBe(`${PUBLIC}/og/envelope.png`);
    expect(metaContent(html, 'og:url')).toBe(
      `${PUBLIC}/g/${VALID_PK}?from=Anna&amp;m=Happy+birthday`,
    );
    expect(metaContent(html, 'og:type')).toBe('website');
    expect(metaContent(html, 'og:site_name')).toBe('Clap and Pay');
    expect(metaContent(html, 'twitter:card')).toBe('summary_large_image');
    expect(html).toContain('<div id="app"></div>');
  });

  it('sets cache, vary, robots and security headers', async () => {
    const response = await createHandler(testDeps())(get(`/g/${VALID_PK}`));
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=30, stale-while-revalidate=120',
    );
    expect(response.headers.get('vary')).toBe('accept-language');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('permissions-policy')).toBe(
      'publickey-credentials-get=(self), publickey-credentials-create=(self)',
    );
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self'; " +
        "connect-src 'self' https://node-a.test https://node-b.test; manifest-src 'self'; " +
        "worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it('answers in German when Accept-Language starts with de', async () => {
    const handler = createHandler(testDeps({ chain: chainWith(coins(false, true)) }));
    const response = await handler(
      get(`/g/${VALID_PK}?from=Anna`, { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' }),
    );
    const html = await response.text();
    expect(metaContent(html, 'og:title')).toBe('🟢 Grüner Umschlag von Anna');
    expect(metaContent(html, 'og:description')).toBe('Noch 1 von 2 · tippen zum Öffnen');
    expect(metaContent(html, 'og:locale')).toBe('de_DE');
  });

  it('switches copy and image when every share is opened', async () => {
    const handler = createHandler(testDeps({ chain: chainWith(coins(true, true, true)) }));
    const html = await (await handler(get(`/g/${VALID_PK}`))).text();
    expect(metaContent(html, 'og:description')).toBe('All opened. Make your own.');
    expect(metaContent(html, 'og:image')).toBe(`${PUBLIC}/og/envelope-empty.png`);
  });

  it('has no counts when no coin is found', async () => {
    const html = await (await createHandler(testDeps())(get(`/g/${VALID_PK}?m=Hi`))).text();
    expect(metaContent(html, 'og:description')).toBe('Hi — Tap to open');
  });

  it('stays fast and count-free when the chain hangs', async () => {
    const hanging: ChainLookup = { coinRecordsByPuzzleHashes: () => new Promise(() => {}) };
    const started = performance.now();
    const response = await createHandler(testDeps({ chain: hanging }))(get(`/g/${VALID_PK}`));
    expect(performance.now() - started).toBeLessThan(500);
    expect(response.status).toBe(200);
    expect(metaContent(await response.text(), 'og:description')).toBe('Tap to open');
  });

  it('escapes and trims what the sender wrote', async () => {
    const rlo = String.fromCodePoint(0x202e);
    const from = `"><script>alert(1)</script>${rlo}`;
    const path = `/g/${VALID_PK}?from=${encodeURIComponent(from)}&m=${'🟢'.repeat(500)}`;
    const html = await (await createHandler(testDeps())(get(path))).text();
    expect(html.split('<script').length - 1).toBe(1);
    expect(html).not.toContain(rlo);
    expect(html).toContain('from &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
    expect(metaContent(html, 'og:description')).toBe(`${'🟢'.repeat(120)} — Tap to open`);
  });

  it.each([
    '/g/',
    '/g',
    '/g/short',
    `/g/${'A'.repeat(63)}`,
    `/g/${'A'.repeat(65)}`,
    `/g/${'A'.repeat(63)}=`,
    `/g/${'A'.repeat(63)}+`,
    `/g/${VALID_PK}/extra`,
    `/g/${'%00'.repeat(64)}`,
  ])('answers %s with the generic shell and 404, never 500', async (path) => {
    const chain = chainWith(coins(false));
    const spy = vi.spyOn(chain, 'coinRecordsByPuzzleHashes');
    const response = await createHandler(testDeps({ chain }))(get(path));
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(metaContent(html, 'og:title')).toBe('Green Envelope · Clap and Pay');
    expect(response.headers.get('content-security-policy')).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('still previews when the key is not a curve point or the shell is missing', async () => {
    const deps = testDeps({
      assets: assetsWith(null),
      shares: () => {
        throw new Error('not on curve');
      },
    });
    const response = await createHandler(deps)(get(`/g/${VALID_PK}?from=Anna`));
    expect(response.status).toBe(200);
    expect(metaContent(await response.text(), 'og:title')).toBe('🟢 Green envelope from Anna');
  });

  it('uses the request origin when no public origin is configured', async () => {
    const deps = testDeps({ config: testConfig({ publicOrigin: null }) });
    const html = await (await createHandler(deps)(get(`/g/${VALID_PK}`))).text();
    expect(metaContent(html, 'og:image')).toBe(`${ORIGIN}/og/envelope.png`);
  });

  it('follows one redirect to find the shell and reads it once per TTL', async () => {
    const clock = { ms: 0 };
    const assets = vi.fn((request: Request) => {
      const { pathname } = new URL(request.url);
      return Promise.resolve(
        pathname === '/index.html'
          ? new Response(null, { status: 307, headers: { location: '/' } })
          : new Response(SHELL_WITHOUT_TAGS, { headers: { 'content-type': 'text/html' } }),
      );
    });
    const handler = createHandler(testDeps({ assets, now: () => clock.ms }));
    expect(await (await handler(get(`/g/${VALID_PK}`))).text()).toContain('index-abc.js');
    await handler(get(`/g/${VALID_PK}`));
    expect(assets).toHaveBeenCalledTimes(2);
    clock.ms = 60_000;
    await handler(get(`/g/${VALID_PK}`));
    expect(assets).toHaveBeenCalledTimes(4);
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const handler = createHandler(testDeps());
    const head = await handler(new Request(`${ORIGIN}/g/${VALID_PK}`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await head.text()).toBe('');
    const post = await handler(new Request(`${ORIGIN}/g/${VALID_PK}`, { method: 'POST' }));
    expect(post.status).toBe(405);
  });
});

describe('static assets and the SPA fallback', () => {
  it.each(['/', '/new', '/new/anything'])(
    'serves the shell with generic tags at %s',
    async (path) => {
      const response = await createHandler(testDeps())(get(path));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(metaContent(html, 'og:title')).toBe('Green Envelope · Clap and Pay');
      expect(metaContent(html, 'og:url')).toBe(`${PUBLIC}/`);
      expect(response.headers.get('x-robots-tag')).toBeNull();
      expect(response.headers.get('content-security-policy')).not.toBeNull();
    },
  );

  it('serves the front door with its own preview tags', async () => {
    const handler = createHandler(testDeps());
    const en = await (await handler(get('/hello'))).text();
    expect(metaContent(en, 'og:title')).toBe('🟢 Get your green envelope');
    expect(metaContent(en, 'og:url')).toBe(`${PUBLIC}/hello`);
    expect(metaContent(en, 'og:image')).toBe(`${PUBLIC}/og/envelope.png`);
    const de = await handler(
      new Request(`${ORIGIN}/hello`, { headers: { 'accept-language': 'de-AT' } }),
    );
    expect(metaContent(await de.text(), 'og:title')).toBe('🟢 Hol dir deinen grünen Umschlag');
    expect((await handler(new Request(`${ORIGIN}/hello`, { method: 'POST' }))).status).toBe(405);
  });

  it('passes other paths to the assets untouched', async () => {
    const handler = createHandler(testDeps());
    const script = await handler(get('/assets/app.js'));
    expect(await script.text()).toBe('export {};');
    expect(script.headers.get('content-security-policy')).toBeNull();
    expect((await handler(get('/assets/missing.js'))).status).toBe(404);
    expect((await handler(get('/newsletter'))).status).toBe(404);
  });

  it('adds the security headers to HTML that comes from the assets', async () => {
    const response = await createHandler(testDeps())(get('/index.html'));
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('GET /healthz', () => {
  it('is 200', async () => {
    const response = await createHandler(testDeps())(get('/healthz'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});

describe('GET /api/price', () => {
  it('returns the quote with a 60 s cache header', async () => {
    const fetchFake = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{"chia":{"eur":11.5}}')),
    );
    const handler = createHandler(testDeps({ fetch: fetchFake }));
    const response = await handler(get('/api/price'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await response.json()).toEqual({ eur: 11.5, at: 1_700_000_000 });
    await handler(get('/api/price'));
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it('is 503 with a null price when nothing is available', async () => {
    const response = await createHandler(testDeps())(get('/api/price'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ eur: null });
  });
});

describe('/api/rpc/:method', () => {
  const upstream: typeof fetch = () => Promise.resolve(new Response('{"success":true}'));

  function rpc(method: string, headers: Record<string, string> = {}): Request {
    return new Request(`${ORIGIN}/api/rpc/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: '{}',
    });
  }

  it('proxies allow-listed methods only', async () => {
    const handler = createHandler(testDeps({ fetch: upstream }));
    expect((await handler(rpc('get_blockchain_state'))).status).toBe(200);
    expect((await handler(rpc('get_routes'))).status).toBe(404);
    expect((await handler(get('/api/rpc/push_tx'))).status).toBe(405);
    expect((await handler(get('/api/unknown'))).status).toBe(404);
  });

  it('allows cross-origin use from the public origin only', async () => {
    const handler = createHandler(testDeps({ fetch: upstream }));
    const allowed = await handler(rpc('get_blockchain_state', { origin: PUBLIC }));
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PUBLIC);
    expect(allowed.headers.get('vary')).toBe('origin');
    const foreign = await handler(rpc('get_blockchain_state', { origin: 'https://evil.test' }));
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect(foreign.headers.get('vary')).toBe('origin');
  });

  it('answers the preflight', async () => {
    const handler = createHandler(testDeps());
    const preflight = (origin: string) =>
      handler(
        new Request(`${ORIGIN}/api/rpc/push_tx`, {
          method: 'OPTIONS',
          headers: { origin, 'access-control-request-method': 'POST' },
        }),
      );
    const allowed = await preflight(PUBLIC);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PUBLIC);
    expect(allowed.headers.get('access-control-allow-methods')).toContain('POST');
    expect(allowed.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(
      (await preflight('https://evil.test')).headers.get('access-control-allow-origin'),
    ).toBeNull();
  });

  it('sends no CORS headers at all without a configured public origin', async () => {
    const deps = testDeps({ fetch: upstream, config: testConfig({ publicOrigin: null }) });
    const response = await createHandler(deps)(rpc('get_blockchain_state', { origin: ORIGIN }));
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('failures', () => {
  it('turns an exception into a bare 500', async () => {
    const deps = testDeps({ assets: () => Promise.reject(new Error('secret detail')) });
    const response = await createHandler(deps)(get('/assets/app.js'));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('internal error');
  });
});
