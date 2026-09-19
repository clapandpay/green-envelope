// SPDX-License-Identifier: AGPL-3.0-or-later

// Control characters (C0, DEL, C1) and the line and paragraph separators become a space.
const CONTROL = /[\p{Cc}\u2028\u2029]/gu;
// Bidi marks, embeddings, overrides and isolates, plus the BOM: they can reorder the text that
// follows them in a chat preview, so they are dropped.
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;
const WHITESPACE_RUN = /\s+/gu;
// A cut can land inside an emoji sequence; a dangling joiner or variation selector is dropped.
const DANGLING_JOINER = /[\u200D\uFE0E\uFE0F]+$/u;
// Work on the raw input is bounded to this many UTF-16 units per allowed character.
const RAW_UNITS_PER_CHAR = 8;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes `& < > " '` so the text is safe in HTML text and in quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

// The first `units` UTF-16 units, never ending in half a surrogate pair.
function boundedPrefix(raw: string, units: number): string {
  if (raw.length <= units) return raw;
  const end = isHighSurrogate(raw.charCodeAt(units - 1)) ? units - 1 : units;
  return raw.slice(0, end);
}

/** Sender-chosen text made safe to show: no control or bidi characters, single spaces, at most `maxChars` code points. */
export function sanitizeText(raw: string | null, maxChars: number): string {
  if (raw === null) return '';
  const cleaned = boundedPrefix(raw, maxChars * RAW_UNITS_PER_CHAR)
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(BIDI, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
  const chars = Array.from(cleaned);
  if (chars.length <= maxChars) return cleaned;
  return chars.slice(0, maxChars).join('').replace(DANGLING_JOINER, '').trimEnd();
}
