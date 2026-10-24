// SPDX-License-Identifier: AGPL-3.0-or-later
import { parsePublicKey } from './bytes';
import type { Config } from './config';
import {
  allOpened,
  envelopeCopy,
  genericCopy,
  helloCopy,
  type Language,
  MAX_FROM_CHARS,
  MAX_MESSAGE_CHARS,
  type PreviewCopy,
  pickLanguage,
} from './copy';
import { FALLBACK_SHELL, prepareShell, renderShell, type ShellTemplate } from './head';
import type { SecurityHeaders } from './security';
import { type ShareStateLookup, shareCount } from './share-state';
import { sanitizeText } from './text';

/** Serves a request from the static assets. */
export type AssetsFn = (request: Request) => Promise<Response>;

/** The HTML pages the server renders: the app shell with per-request tags in `<head>`. */
export interface Pages {
  /** `GET /g/:pk`; a segment that is not a public key gives the generic shell with status 404. */
  envelope(request: Request, url: URL, segment: string): Promise<Response>;
  /** The shell with generic tags, for the app's own routes. */
  generic(request: Request, url: URL, status: number): Promise<Response>;
  /** The shell with the tags of the front door, `/hello`: the page the marketing site links to. */
  hello(request: Request, url: URL): Promise<Response>;
}

/** Dependencies of `createPages`. */
export interface PagesDeps {
  readonly assets: AssetsFn;
  readonly config: Config;
  readonly shareState: ShareStateLookup;
  readonly securityHeaders: SecurityHeaders;
  /** Unix milliseconds. */
  readonly now: () => number;
}

/** Path of the app shell inside the static assets. */
export const SHELL_PATH = '/index.html';
/** Cache policy of every rendered page, for crawlers and people alike. */
export const PAGE_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=120';
/** Paths of the preview images relative to the public origin (PNG: WhatsApp ignores SVG). */
export const OG_IMAGES = { full: '/og/envelope.png', empty: '/og/envelope-empty.png' } as const;

const LOCALES: Readonly<Record<Language, string>> = { en: 'en_US', de: 'de_DE' };

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

function sanitizeParam(url: URL, name: string, maxChars: number): string {
  return sanitizeText(url.searchParams.get(name), maxChars);
}

/** Canonical URL of an envelope: the path plus the sanitised `from` and `m`, never a fragment. */
export function envelopeUrl(
  origin: string,
  segment: string,
  from: string,
  message: string,
  shares?: number,
): string {
  const query = new URLSearchParams();
  if (shares !== undefined) query.set('n', String(shares));
  if (from !== '') query.set('from', from);
  if (message !== '') query.set('m', message);
  const search = query.toString();
  return `${origin}/g/${segment}${search === '' ? '' : `?${search}`}`;
}

/** Creates the page renderer; the parsed shell is kept in memory for `config.shellTtlSeconds`. */
export function createPages(deps: PagesDeps): Pages {
  const { assets, config, now } = deps;
  let shell: { readonly template: ShellTemplate; readonly expiresAt: number } | null = null;
  const fallback = prepareShell(FALLBACK_SHELL);

  // Asset servers that use clean URLs answer `/index.html` with a redirect to `/`: follow it once.
  const fetchShell = async (origin: string): Promise<Response> => {
    const first = await assets(new Request(new URL(SHELL_PATH, origin)));
    const location = first.headers.get('location');
    if (!isRedirect(first) || location === null) return first;
    await first.body?.cancel();
    return assets(new Request(new URL(location, origin)));
  };

  const loadShell = async (origin: string): Promise<ShellTemplate> => {
    if (shell !== null && shell.expiresAt > now()) return shell.template;
    const response = await fetchShell(origin).catch(() => null);
    if (response === null || !response.ok) {
      await response?.body?.cancel();
      return fallback;
    }
    const template = await response.text().then(prepareShell, () => null);
    if (template === null) return fallback;
    shell = { template, expiresAt: now() + config.shellTtlSeconds * 1000 };
    return template;
  };

  // The node the browser should use, read from the environment at start (never in the image).
  const chainTag =
    config.browserChain === null
      ? undefined
      : JSON.stringify({
          network: config.network,
          endpoints: config.browserChain.endpoints,
          apiKey: config.browserChain.apiKey,
        });

  const respond = async (
    shellReady: Promise<ShellTemplate>,
    language: Language,
    copy: PreviewCopy,
    page: { readonly status: number; readonly canonical: string; readonly image: string },
    extraHeaders: SecurityHeaders,
  ): Promise<Response> => {
    const html = renderShell(await shellReady, {
      ...copy,
      image: page.image,
      url: page.canonical,
      locale: LOCALES[language],
      ...(chainTag === undefined ? {} : { chain: chainTag }),
    });
    const headers = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': PAGE_CACHE_CONTROL,
      vary: 'accept-language',
    });
    for (const [name, value] of [...extraHeaders, ...deps.securityHeaders])
      headers.set(name, value);
    return new Response(html, { status: page.status, headers });
  };

  const generic = (request: Request, url: URL, status: number): Promise<Response> => {
    const origin = config.publicOrigin ?? url.origin;
    const language = pickLanguage(request.headers.get('accept-language'));
    const page = { status, canonical: `${origin}/`, image: origin + OG_IMAGES.full };
    return respond(loadShell(url.origin), language, genericCopy(language), page, []);
  };

  const hello = (request: Request, url: URL): Promise<Response> => {
    const origin = config.publicOrigin ?? url.origin;
    const language = pickLanguage(request.headers.get('accept-language'));
    const page = { status: 200, canonical: `${origin}/hello`, image: origin + OG_IMAGES.full };
    return respond(loadShell(url.origin), language, helloCopy(language), page, []);
  };

  return {
    generic,
    hello,
    async envelope(request, url, segment) {
      const publicKey = parsePublicKey(segment);
      if (publicKey === null) return generic(request, url, 404);

      const origin = config.publicOrigin ?? url.origin;
      const language = pickLanguage(request.headers.get('accept-language'));
      const from = sanitizeParam(url, 'from', MAX_FROM_CHARS);
      const message = sanitizeParam(url, 'm', MAX_MESSAGE_CHARS);
      // The shell and the chain are independent: fetch both at once.
      const shellReady = loadShell(url.origin);
      const hint = Number(url.searchParams.get('n') ?? Number.NaN);
      const shares = shareCount(hint) === hint ? hint : undefined;
      const state = await deps.shareState(segment, publicKey, shares);
      const page = {
        status: 200,
        canonical: envelopeUrl(origin, segment, from, message, shares),
        image: origin + (allOpened(state) ? OG_IMAGES.empty : OG_IMAGES.full),
      };
      // Envelope links are for the chat they were sent to, not for search results.
      const noIndex: SecurityHeaders = [['x-robots-tag', 'noindex']];
      const copy = envelopeCopy(language, from, message, state);
      return respond(shellReady, language, copy, page, noIndex);
    },
  };
}
