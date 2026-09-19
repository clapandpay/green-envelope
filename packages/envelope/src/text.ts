// SPDX-License-Identifier: AGPL-3.0-or-later

// Control characters, plus the bidi overrides (U+202A..202E) and isolates (U+2066..2069) that
// let a name spoof a chat preview. Written as escapes: never put the raw characters in source.
const UNSAFE = /[\p{Cc}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;
const LONE_SURROGATE = /\p{Cs}/gu;
const REPLACEMENT = String.fromCodePoint(0xfffd);
// Whitespace or a zero-width joiner (U+200D) left dangling by the cut.
const TRAILING_JUNK = /[\s\u{200D}]+$/u;

/**
 * Makes sender-chosen text safe to show on one line: whitespace runs become one space, control
 * and bidi-override characters go, NFC, then trim and cut to `maxChars` code points.
 * Idempotent. Applied on both encode and decode, because a link is attacker-controlled input.
 */
export function sanitizeText(text: string, maxChars: number): string {
  const clean = text
    .replace(LONE_SURROGATE, REPLACEMENT)
    .replace(/\s+/gu, ' ') // before UNSAFE: tabs and newlines are control characters too
    .replace(UNSAFE, '')
    .replace(/ {2,}/g, ' ') // removing a control character can leave two spaces side by side
    .normalize('NFC') // last, so that what a removed character separated still composes
    .trim();
  // Cut by code point so an emoji is never split into half a surrogate pair.
  const cut = Array.from(clean).slice(0, maxChars).join('');
  return cut.replace(TRAILING_JUNK, '');
}
