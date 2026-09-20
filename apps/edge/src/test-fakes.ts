// SPDX-License-Identifier: AGPL-3.0-or-later
// Fakes shared by the tests of this app; nothing here is imported by production code.
import type { ChainLookup, ShareCoin } from './chain';
import type { Config } from './config';
import type { HandlerDeps } from './handler';
import type { SharesFn } from './share-state';

/** A path segment that is valid base64url of 48 bytes. */
export const VALID_PK = 'A'.repeat(64);

/** A shell like the one Vite builds, with its own title and social tags. */
export const SHELL_WITH_TAGS = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Green Envelope</title>
    <meta name="description" content="static > description" />
    <meta property="og:title" content="static og title" />
    <meta property='og:image' content='/static.png'>
    <meta name="twitter:card" content="summary" />
    <meta name="theme-color" content="#2DB84D" />
    <link rel="stylesheet" href="/assets/index-abc.css" />
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

/** The same shell without any managed tag. */
export const SHELL_WITHOUT_TAGS = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body><div id="app"></div></body>
</html>
`;

/** A config for tests: one or two fake endpoints and a short lookup budget. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    network: 'testnet11',
    typesafeApiKey: null,
    chainEndpoints: ['https://node-a.test', 'https://node-b.test/rpc'],
    publicOrigin: 'https://clapandpay.test',
    shareLookupBudgetMs: 20,
    shellTtlSeconds: 60,
    ...overrides,
  };
}

/** Thirty-two bytes per share, filled with the share index: no crypto. */
export const fakeShares: SharesFn = (_publicKey, count) =>
  Array.from({ length: count }, (_, index) => new Uint8Array(32).fill(index));

/** A chain that answers every lookup with the same coins. */
export function chainWith(coins: readonly ShareCoin[]): ChainLookup {
  return { coinRecordsByPuzzleHashes: () => Promise.resolve([...coins]) };
}

/** `spent` flags turned into coins of one mojo each. */
export function coins(...spent: boolean[]): ShareCoin[] {
  return spent.map((flag) => ({ amount: 1n, spent: flag }));
}

/** Static assets holding the shell at `/index.html` and one script. */
export function assetsWith(shell: string | null): (request: Request) => Promise<Response> {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/index.html' && shell !== null) {
      return Promise.resolve(
        new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      );
    }
    if (pathname === '/assets/app.js') {
      return Promise.resolve(
        new Response('export {};', { headers: { 'content-type': 'text/javascript' } }),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

/** A `fetch` that fails the test when it is reached. */
export const unreachableFetch: typeof fetch = () =>
  Promise.reject(new Error('unexpected network access'));

/** Handler dependencies with fakes everywhere; override what the test is about. */
export function testDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    shares: fakeShares,
    chain: chainWith([]),
    fetch: unreachableFetch,
    now: () => 1_700_000_000_000,
    assets: assetsWith(SHELL_WITH_TAGS),
    config: testConfig(),
    ...overrides,
  };
}
