// SPDX-License-Identifier: AGPL-3.0-or-later
// The envelope. One inline SVG; the states are CSS classes (see styles/claim.css).

export type EnvelopeState = 'sealed' | 'opening' | 'open' | 'empty' | 'ghost';

const FLAP = '20,80 220,80 120,152';

/** Decorative: the text next to it says everything a screen reader needs. */
export function Envelope(props: { state: EnvelopeState }) {
  return (
    <svg
      class={`env env--${props.state}`}
      viewBox="0 0 240 210"
      aria-hidden="true"
      focusable="false"
    >
      <g class="env__all">
        <rect class="env__shadow" x="27" y="87" width="200" height="110" rx="10" />
        <rect class="env__inside env__outline" x="20" y="80" width="200" height="110" rx="10" />
        <polygon class="env__flap-open env__outline" points={FLAP} />
        <g class="env__slip-group">
          <rect class="env__slip env__outline" x="46" y="90" width="148" height="92" rx="6" />
          <rect class="env__slip-green" x="60" y="104" width="22" height="22" />
          <rect class="env__slip-ink" x="94" y="106" width="84" height="6" rx="3" />
          <rect class="env__slip-ink" x="94" y="119" width="56" height="6" rx="3" />
        </g>
        <path
          class="env__pocket env__outline"
          d="M20 86 L120 152 L220 86 V180 Q220 190 210 190 H30 Q20 190 20 180 Z"
        />
        <path class="env__fold" d="M26 186 L92 136 M214 186 L148 136" />
        <polygon class="env__flap env__outline" points={FLAP} />
        <g class="env__seal">
          <circle class="env__seal-disc env__outline" cx="120" cy="150" r="21" />
          <circle class="env__seal-eye" cx="112.5" cy="145" r="2.6" />
          <circle class="env__seal-eye" cx="127.5" cy="145" r="2.6" />
          <path class="env__seal-face" d="M110 153 Q120 164 130 153" />
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
