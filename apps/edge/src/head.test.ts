// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FALLBACK_SHELL, type HeadTags, prepareShell, renderHeadTags, renderShell } from './head';
import { SHELL_WITH_TAGS, SHELL_WITHOUT_TAGS } from './test-fakes';

const TAGS: HeadTags = {
  title: '🟢 Green envelope from Anna',
  description: 'Happy birthday — 3 of 5 left · tap to open',
  image: 'https://clapandpay.test/og/envelope.png',
  url: 'https://clapandpay.test/g/abc?from=Anna',
  locale: 'en_US',
};

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function headOf(html: string): string {
  return html.slice(0, html.indexOf('</head>'));
}

describe('renderShell', () => {
  it('replaces the managed tags a shell already has', () => {
    const html = renderShell(prepareShell(SHELL_WITH_TAGS), TAGS);
    expect(count(html, '<title>')).toBe(1);
    expect(count(html, 'name="description"')).toBe(1);
    expect(count(html, 'og:title')).toBe(1);
    expect(count(html, 'og:image"')).toBe(1);
    expect(count(html, 'twitter:card')).toBe(1);
    expect(html).not.toContain('static');
    expect(html).toContain('<title>🟢 Green envelope from Anna</title>');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('keeps everything it does not manage', () => {
    const html = renderShell(prepareShell(SHELL_WITH_TAGS), TAGS);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<meta name="theme-color" content="#2DB84D" />');
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
    expect(html).toContain('<div id="app"></div>');
  });

  it('inserts the tags before </head> when the shell has none', () => {
    const html = renderShell(prepareShell(SHELL_WITHOUT_TAGS), TAGS);
    const head = headOf(html);
    for (const key of [
      '<title>',
      'name="description"',
      'og:title',
      'og:description',
      'og:image"',
      'og:url',
      'og:type',
      'og:site_name',
      'twitter:card',
    ]) {
      expect(count(head, key)).toBe(1);
    }
    expect(html.endsWith('</html>\n')).toBe(true);
  });

  it('writes every required value', () => {
    const tags = renderHeadTags(TAGS);
    expect(tags).toContain('<meta property="og:type" content="website">');
    expect(tags).toContain('<meta property="og:site_name" content="Clap and Pay">');
    expect(tags).toContain(`<meta property="og:image" content="${TAGS.image}">`);
    expect(tags).toContain(
      '<meta property="og:url" content="https://clapandpay.test/g/abc?from=Anna">',
    );
    expect(tags).toContain('<meta property="og:image:width" content="1200">');
  });

  it('escapes hostile text in the title and in attributes', () => {
    const hostile = `"><script>alert(1)</script><meta x='`;
    const html = renderShell(prepareShell(SHELL_WITHOUT_TAGS), {
      ...TAGS,
      title: hostile,
      description: hostile,
    });
    expect(count(html, '<script')).toBe(1);
    expect(html).not.toContain('alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;meta x=&#39;');
  });

  it('does not treat `$` sequences in user text as replacement patterns', () => {
    const html = renderShell(prepareShell(SHELL_WITH_TAGS), { ...TAGS, title: "$& $' $1 $`" });
    expect(html).toContain('<title>$&amp; $&#39; $1 $`</title>');
  });

  it('is case-insensitive and ignores managed-looking tags outside of head', () => {
    const shell =
      '<HTML><HEAD><TITLE>old</TITLE><META PROPERTY=og:title CONTENT=old></HEAD>' +
      '<body><title>svg title</title></body></HTML>';
    const html = renderShell(prepareShell(shell), TAGS);
    expect(html).not.toContain('old');
    expect(html).toContain('<title>svg title</title>');
  });

  it('builds a head when the shell has none', () => {
    expect(renderShell(prepareShell('<body>hi</body>'), TAGS)).toMatch(
      /^<head>\n<title>[\s\S]*<\/head>\n<body>hi<\/body>$/,
    );
    expect(renderShell(prepareShell('hi'), TAGS)).toMatch(/^<head>[\s\S]*<\/head>\nhi$/);
  });

  it('has a usable fallback shell', () => {
    const html = renderShell(prepareShell(FALLBACK_SHELL), TAGS);
    expect(count(html, '<title>')).toBe(1);
    expect(html).toContain('<meta charset="utf-8">');
  });
});
