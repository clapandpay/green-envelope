// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { escapeHtml, sanitizeText } from './text';

const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const ZWJ = String.fromCodePoint(0x200d);
const FAMILY = ['👨', '👩', '👧'].join(ZWJ);

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`"><script>alert('x')</script>&`)).toBe(
      '&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;',
    );
  });

  it('leaves everything else alone', () => {
    expect(escapeHtml('Grüße 🟢 مرحبا')).toBe('Grüße 🟢 مرحبا');
  });
});

describe('sanitizeText', () => {
  it('treats a missing parameter as empty', () => {
    expect(sanitizeText(null, 40)).toBe('');
  });

  it('turns control characters into single spaces and trims', () => {
    expect(sanitizeText('\u0000 Anna\r\n\tB.\u007f\u0085 ', 40)).toBe('Anna B.');
  });

  it('drops bidi overrides, isolates and marks', () => {
    expect(sanitizeText(`${RLO}Anna${LRI}gpj.exe${PDI}`, 40)).toBe('Annagpj.exe');
  });

  it('keeps emoji sequences and right-to-left letters', () => {
    expect(sanitizeText(`${FAMILY} مرحبا`, 40)).toBe(`${FAMILY} مرحبا`);
  });

  it('cuts by code points, never through a surrogate pair', () => {
    expect(sanitizeText('🟢'.repeat(50), 40)).toBe('🟢'.repeat(40));
  });

  it('does not leave a dangling joiner after a cut', () => {
    expect(sanitizeText(`ab${FAMILY}`, 4)).toBe('ab👨');
  });

  it('bounds the work on very long input', () => {
    const result = sanitizeText(`${'x'.repeat(5_000_000)}<script>`, 120);
    expect(result).toBe('x'.repeat(120));
  });

  it('does not split a pair at the raw bound', () => {
    const result = sanitizeText(`${'\u0001'.repeat(15)}${'🟢'.repeat(10)}`, 2);
    expect(result).toBe('');
  });
});
