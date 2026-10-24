// SPDX-License-Identifier: AGPL-3.0-or-later
import { SITE_NAME } from './copy';
import { escapeHtml } from './text';

/** Everything the server writes into `<head>`, as plain (unescaped) text. */
export interface HeadTags {
  readonly title: string;
  readonly description: string;
  /** Absolute URL of a 1200×630 image. */
  readonly image: string;
  /** Absolute canonical URL of the page. */
  readonly url: string;
  /** Open Graph locale, for example `en_US`. */
  readonly locale: string;
  /** The browser's chain node, as JSON for `<meta name="ge-chain">`; absent: none. */
  readonly chain?: string;
}

/** An app shell with the managed tags removed, split at the point where they are written back. */
export interface ShellTemplate {
  readonly before: string;
  readonly after: string;
}

/** Pixel size every preview image must have. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

// Tags are matched with quoted attribute values skipped, so a `>` inside `content="…"` does not
// end the tag early. Indentation and one line break go with a removed tag.
const TITLE = /[ \t]*<title\b[^>]*>[\s\S]*?<\/title\s*>(?:\r?\n)?/gi;
const META = /[ \t]*<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>(?:\r?\n)?/gi;
const META_KEY = /\s(?:name|property)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const HEAD_CLOSE = /<\/head\s*>/i;
const BODY_OPEN = /<body\b/i;
const TRAILING_INDENT = /[ \t]*$/;

/** The shell used when the static assets have no `index.html`: previews still work. */
export const FALLBACK_SHELL =
  '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '</head>\n<body><div id="app"></div></body>\n</html>\n';

function isManagedKey(key: string): boolean {
  return key === 'description' || key.startsWith('og:') || key.startsWith('twitter:');
}

function isManagedMeta(tag: string): boolean {
  const match = META_KEY.exec(tag);
  const key = match?.[1] ?? match?.[2] ?? match?.[3];
  return key !== undefined && isManagedKey(key.trim().toLowerCase());
}

function stripManaged(head: string): string {
  return head.replace(TITLE, '').replace(META, (tag) => (isManagedMeta(tag) ? '' : tag));
}

/** Parses the shell once: strips the title and the description, `og:*` and `twitter:*` metas from `<head>` and finds the insertion point. */
export function prepareShell(html: string): ShellTemplate {
  const headClose = html.search(HEAD_CLOSE);
  if (headClose >= 0) {
    // The indentation of `</head>` stays with it.
    const head = stripManaged(html.slice(0, headClose));
    const cut = head.length - (TRAILING_INDENT.exec(head)?.[0].length ?? 0);
    return { before: head.slice(0, cut), after: head.slice(cut) + html.slice(headClose) };
  }
  // No `</head>`: open one in front of `<body>`, or in front of everything.
  const at = Math.max(html.search(BODY_OPEN), 0);
  return { before: `${html.slice(0, at)}<head>\n`, after: `</head>\n${html.slice(at)}` };
}

function meta(attribute: 'name' | 'property', key: string, content: string): string {
  return `<meta ${attribute}="${key}" content="${escapeHtml(content)}">\n`;
}

/** The managed tags as HTML, every value escaped. */
export function renderHeadTags(tags: HeadTags): string {
  return (
    `<title>${escapeHtml(tags.title)}</title>\n` +
    meta('name', 'description', tags.description) +
    meta('property', 'og:type', 'website') +
    meta('property', 'og:site_name', SITE_NAME) +
    meta('property', 'og:locale', tags.locale) +
    meta('property', 'og:title', tags.title) +
    meta('property', 'og:description', tags.description) +
    meta('property', 'og:url', tags.url) +
    meta('property', 'og:image', tags.image) +
    meta('property', 'og:image:width', String(OG_IMAGE_SIZE.width)) +
    meta('property', 'og:image:height', String(OG_IMAGE_SIZE.height)) +
    meta('name', 'twitter:card', 'summary_large_image') +
    (tags.chain === undefined ? '' : meta('name', 'ge-chain', tags.chain))
  );
}

/** The full HTML document: the prepared shell with the tags written just before `</head>`. */
export function renderShell(template: ShellTemplate, tags: HeadTags): string {
  return template.before + renderHeadTags(tags) + template.after;
}
