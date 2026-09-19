// SPDX-License-Identifier: AGPL-3.0-or-later
// The envelope. One inline SVG; the states are CSS classes (see styles/claim.css).

export type EnvelopeState = 'sealed' | 'opening' | 'open' | 'empty' | 'ghost';

const FLAP = '20,80 220,80 120,152';
// Sixteen small discs around the seal: the frilled edge that pressed wax leaves.
const SCALLOP =
  'M144.30 150.00a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M142.82 157.46a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M138.59 163.79a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M132.26 168.02a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M124.80 169.50a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M117.34 168.02a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M111.01 163.79a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M106.78 157.46a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M105.30 150.00a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M106.78 142.54a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M111.01 136.21a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M117.34 131.98a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M124.80 130.50a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M132.26 131.98a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M138.59 136.21a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z M142.82 142.54a4.8 4.8 0 1 0 -9.6 0a4.8 4.8 0 1 0 9.6 0Z';

/**
 * Decorative: the text next to it says everything a screen reader needs.
 * Drawn like old stationery: a striped liner, an engraved hairline, a stamp with a postmark and
 * a brass wax seal that keeps its smile.
 */
export function Envelope(props: { state: EnvelopeState }) {
  return (
    <svg
      class={`env env--${props.state}`}
      viewBox="0 0 240 210"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="env-liner"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect class="env__liner-ground" width="7" height="7" />
          <rect class="env__liner-stripe" width="2.2" height="7" />
        </pattern>
      </defs>
      <g class="env__all">
        <rect class="env__shadow" x="25" y="85" width="200" height="110" rx="7" />
        <rect class="env__inside env__outline" x="20" y="80" width="200" height="110" rx="7" />
        <polygon class="env__flap-open env__outline" points={FLAP} />
        <g class="env__slip-group">
          <rect class="env__slip env__outline" x="46" y="90" width="148" height="92" rx="3" />
          <rect class="env__slip-rule" x="52" y="96" width="136" height="80" rx="1.5" />
          <path class="env__slip-green" d="M120 104 l9 11 -9 11 -9 -11 Z" />
          <path class="env__slip-ink" d="M84 136 H156 M98 144 H142" />
        </g>
        <path
          class="env__pocket env__outline"
          d="M20 80 L120 152 L220 80 V183 Q220 190 213 190 H27 Q20 190 20 183 Z"
        />
        <path class="env__engrave" d="M27 99 V180 Q27 183 30 183 H210 Q213 183 213 180 V99" />
        <path class="env__fold" d="M24 187 L94 135 M216 187 L146 135" />
        <g class="env__post">
          <path
            class="env__postmark"
            d="M124 164 q5 -4 10 0 t10 0 t10 0 t10 0 M124 170 q5 -4 10 0 t10 0 t10 0 t10 0 M124 176 q5 -4 10 0 t10 0 t10 0 t10 0"
          />
          <rect class="env__stamp" x="180" y="149" width="24" height="28" />
          <rect class="env__stamp-perf" x="180" y="149" width="24" height="28" />
          <rect class="env__stamp-field" x="184" y="153" width="16" height="20" />
          <path
            class="env__stamp-leaf"
            d="M192 169 V160 M192 165 q-5 -1 -5 -6 q5 0 5 6 M192 163 q4 -1 4 -5 q-4 0 -4 5"
          />
          <circle class="env__postmark" cx="176" cy="162" r="11" />
          <circle class="env__postmark" cx="176" cy="162" r="8" />
        </g>
        <g class="env__flap">
          <polygon class="env__outline" points={FLAP} />
          <path class="env__engrave" d="M38 87 L120 146 L202 87" />
        </g>
        <g class="env__seal">
          <path class="env__seal-frill" d={SCALLOP} />
          <circle class="env__seal-disc" cx="120" cy="150" r="19.5" />
          <circle class="env__seal-ring" cx="120" cy="150" r="15.5" />
          <circle class="env__seal-eye" cx="113.5" cy="146" r="2.1" />
          <circle class="env__seal-eye" cx="126.5" cy="146" r="2.1" />
          <path class="env__seal-face" d="M111.5 153 Q120 162 128.5 153" />
        </g>
      </g>
    </svg>
  );
}

/** The small mark in the top bar and in lists. */
export function EnvelopeMark() {
  return (
    <svg viewBox="0 0 28 22" aria-hidden="true" focusable="false">
      <rect
        x="1.5"
        y="1.5"
        width="25"
        height="19"
        rx="3"
        fill="var(--green)"
        stroke="var(--ink)"
        stroke-width="2.5"
      />
      <path
        d="M2 3 L14 12 L26 3"
        fill="none"
        stroke="var(--ink)"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}
