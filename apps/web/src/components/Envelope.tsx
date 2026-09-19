// SPDX-License-Identifier: AGPL-3.0-or-later
// The envelope, as cut paper: flat layers, no outlines, shading by dither (the Amiga way) and a
// sun of raster bars behind it. One inline SVG; the states are CSS classes (styles/claim.css).

export type EnvelopeState = 'sealed' | 'opening' | 'open' | 'empty' | 'ghost';

const FLAP = '30,98 210,98 120,162';
const POCKET = 'M30 98 L120 162 L210 98 V204 Q210 208 206 208 H34 Q30 208 30 204 Z';
// The crest on the seal: four diamonds that form one (the old "split diamond" family mark).
// On opening they fly apart, each along its own direction.
const CREST: ReadonlyArray<readonly [cx: number, cy: number, dx: number, dy: number]> = [
  [120, 156.2, 0, -1],
  [114.2, 162, -1, 0],
  [125.8, 162, 1, 0],
  [120, 167.8, 0, 1],
];

function diamond(cx: number, cy: number): string {
  const r = 4.6;
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

/** Decorative: the text next to it says everything a screen reader needs. */
export function Envelope(props: { state: EnvelopeState }) {
  return (
    <svg
      class={`env env--${props.state}`}
      viewBox="0 0 240 240"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* one-unit checker: the only "gradient" here */}
        <pattern id="env-dither" width="2.4" height="2.4" patternUnits="userSpaceOnUse">
          <rect class="env__dither-ink" width="1.2" height="1.2" />
          <rect class="env__dither-ink" x="1.2" y="1.2" width="1.2" height="1.2" />
        </pattern>
        {/* seigaiha, the wave pattern of wrapping paper: later scales cover earlier ones */}
        <pattern id="env-waves" width="20" height="10" patternUnits="userSpaceOnUse">
          {[
            [0, 0],
            [20, 0],
            [10, 5],
            [0, 10],
            [20, 10],
          ].map(([cx, cy]) => (
            <g key={`${cx}.${cy}`}>
              <circle class="env__wave-ground" cx={cx} cy={cy} r="10" />
              <circle class="env__wave-line" cx={cx} cy={cy} r="9.4" />
              <circle class="env__wave-line" cx={cx} cy={cy} r="6.4" />
              <circle class="env__wave-line" cx={cx} cy={cy} r="3.4" />
            </g>
          ))}
        </pattern>
        <clipPath id="env-sun-clip">
          <circle cx="120" cy="92" r="74" />
        </clipPath>
      </defs>

      <g class="env__sun" clip-path="url(#env-sun-clip)">
        <rect x="40" y="18.0" width="160" height="34.0" />
        <rect x="40" y="55.0" width="160" height="9.0" />
        <rect x="40" y="66.8" width="160" height="7.4" />
        <rect x="40" y="77.8" width="160" height="6.1" />
        <rect x="40" y="88.1" width="160" height="5.0" />
        <rect x="40" y="97.9" width="160" height="4.1" />
        <rect x="40" y="107.2" width="160" height="3.3" />
        <rect x="40" y="116.2" width="160" height="2.7" />
        <rect x="40" y="124.9" width="160" height="2.2" />
        <rect x="40" y="133.3" width="160" height="1.8" />
        <rect x="40" y="141.5" width="160" height="1.5" />
        <rect x="40" y="149.6" width="160" height="1.2" />
      </g>

      <g class="env__all">
        <path class="env__cast" d={POCKET} transform="translate(6 7)" />
        <rect class="env__inside" x="30" y="98" width="180" height="110" rx="4" />
        <polygon class="env__flap-open" points={FLAP} />
        <g class="env__slip-group">
          <rect class="env__slip-cast" x="53" y="109" width="140" height="92" />
          <rect class="env__slip" x="50" y="106" width="140" height="92" />
          <rect class="env__slip-rule" x="56" y="112" width="128" height="80" />
          <circle class="env__slip-sun" cx="120" cy="134" r="9" />
          <path class="env__slip-ink" d="M92 156 H148 M104 164 H136" />
        </g>
        <path class="env__pocket" d={POCKET} />
        <polygon class="env__facet-light" points="30,208 120,150 210,208" />
        <polygon class="env__facet-shade" points="210,98 210,208 120,150 120,162" />
        <path class="env__fold" d="M30 208 L120 150 L210 208" />
        <polygon class="env__flap-cast" points={FLAP} transform="translate(0 5)" />
        <g class="env__flap">
          <polygon points={FLAP} />
          <polygon class="env__flap-shade" points="120,98 210,98 120,162" />
        </g>
        <g class="env__seal">
          <circle class="env__seal-cast" cx="122.5" cy="165" r="17" />
          <circle class="env__seal-disc" cx="120" cy="162" r="17" />
          <circle class="env__seal-ring" cx="120" cy="162" r="13.2" />
          {CREST.map(([cx, cy, dx, dy]) => (
            <polygon
              key={`${cx}.${cy}`}
              class="env__crest"
              points={diamond(cx, cy)}
              style={`--dx:${dx};--dy:${dy}`}
            />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** The small mark in the top bar and in lists. */
export function EnvelopeMark() {
  return (
    <svg viewBox="0 0 28 22" aria-hidden="true" focusable="false">
      <rect width="28" height="22" rx="2" fill="var(--green)" />
      <path d="M0 0 L14 11 L28 0 Z" fill="var(--green-deep)" />
      <circle cx="14" cy="11" r="3.4" fill="var(--sun)" />
    </svg>
  );
}
