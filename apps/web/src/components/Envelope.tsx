// SPDX-License-Identifier: AGPL-3.0-or-later
// The envelope, drawn the way the logo is: printed paper, split down the middle into dark green
// geometric fields, black and leaf-green half-circles, an ivory V where the flap meets the pocket,
// leaves that grow out of it, and a circular postal seal in ochre. Shading is dither, texture is
// grain, no gradients. One inline SVG; the states are CSS classes (styles/claim.css).

import { useEffect, useRef } from 'preact/hooks';
import { useTilt } from './useTilt';

export type EnvelopeState = 'sealed' | 'opening' | 'open' | 'empty' | 'ghost';

const FLAP = '30,98 210,98 120,162';
const POCKET = 'M30 98 L120 162 L210 98 V202 Q210 208 204 208 H36 Q30 208 30 202 Z';
const V = 'M30 98 L120 162 L210 98';
// The crest on the seal: four leaves around the centre, like a clover. On opening they fly apart,
// each along its own direction.
const CREST: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];
const SEAL = { cx: 120, cy: 162 };

/** A leaf from near the seal's centre outwards along (dx, dy): pointed tip, round belly. */
function crestLeaf(dx: number, dy: number): string {
  const { cx, cy } = SEAL;
  const at = (along: number, across: number) =>
    `${cx + dx * along - dy * across},${cy + dy * along + dx * across}`;
  return `M${at(1.4, 0)} Q${at(4.6, 4.2)} ${at(9, 0)} Q${at(4.6, -4.2)} ${at(1.4, 0)} Z`;
}

/** Short, felt rather than heard: the seal breaks, and the hand knows. */
function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // no haptics here; nothing to do
  }
}

/**
 * Decorative: the text next to it says everything a screen reader needs.
 * `interactive` (default on) lets it lean toward the pointer or the phone's tilt, and lets the seal
 * give under a held press; a showcase can switch it off. Layers sit at different depths (class
 * env__px--*), so the lean reads as paper stacked in space.
 */
export function Envelope(props: { state: EnvelopeState; interactive?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const interactive = props.interactive !== false && props.state !== 'ghost';
  useTilt(ref, interactive);

  const previous = useRef(props.state);
  useEffect(() => {
    const before = previous.current;
    previous.current = props.state;
    if (before === props.state) return;
    if (props.state === 'opening') buzz(10);
    if (props.state === 'open' && before !== 'empty') buzz([16, 46, 30]);
  }, [props.state]);

  // press and hold: the seal gives under the thumb before it cracks (a class, no re-render)
  const press = (on: boolean) => () => ref.current?.classList.toggle('env--press', on);

  return (
    <svg
      ref={ref}
      class={`env env--${props.state}`}
      onPointerDown={interactive ? press(true) : undefined}
      onPointerUp={interactive ? press(false) : undefined}
      onPointerCancel={interactive ? press(false) : undefined}
      onPointerLeave={interactive ? press(false) : undefined}
      viewBox="0 0 240 240"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* one-unit checker: the only "gradient" here, for cast shadows */}
        <pattern id="env-dither" width="2.4" height="2.4" patternUnits="userSpaceOnUse">
          <rect class="env__dither-ink" width="1.2" height="1.2" />
          <rect class="env__dither-ink" x="1.2" y="1.2" width="1.2" height="1.2" />
        </pattern>
        {/* halftone: the black-and-white print of a photograph, on the letter and the flap */}
        <pattern id="env-halftone" width="3" height="3" patternUnits="userSpaceOnUse">
          <circle class="env__halftone-dot" cx="1.5" cy="1.5" r="0.75" />
        </pattern>
        <pattern id="env-halftone-dense" width="3" height="3" patternUnits="userSpaceOnUse">
          <circle class="env__halftone-dot" cx="1.5" cy="1.5" r="1.25" />
        </pattern>
        {/* printed grain: speckles in the paper's colour on the dark fields, ink on the light */}
        <filter id="env-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0.96  0 0 0 0 0.94  0 0 0 0 0.9  0 0 0 2.2 -1.25" />
        </filter>
        <filter id="env-grain-ink" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" />
          <feColorMatrix values="0 0 0 0 0.09  0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 2.4 -1.45" />
        </filter>
        <clipPath id="env-sun-clip">
          <circle cx="120" cy="96" r="64" />
        </clipPath>
        <clipPath id="env-pocket-clip">
          <path d={POCKET} />
        </clipPath>
        <clipPath id="env-flap-clip">
          <polygon points={FLAP} />
        </clipPath>
        <clipPath id="env-left-clip">
          <rect x="30" y="90" width="90" height="120" />
        </clipPath>
        <clipPath id="env-right-clip">
          <rect x="120" y="90" width="90" height="120" />
        </clipPath>
        <clipPath id="env-photo-clip">
          <rect x="58" y="116" width="62" height="40" />
        </clipPath>
      </defs>

      {/* Behind the envelope: the logo's circle, split into two greens, and an ochre postmark. */}
      <g class="env__px env__px--sun">
        <g class="env__sun">
          <g clip-path="url(#env-sun-clip)">
            <rect class="env__sun-left" x="56" y="32" width="64" height="128" />
            <rect class="env__sun-right" x="120" y="32" width="64" height="128" />
            <rect
              class="env__grain"
              x="56"
              y="32"
              width="128"
              height="128"
              filter="url(#env-grain)"
            />
          </g>
          <g class="env__postmark">
            <circle cx="190" cy="52" r="17" />
            <circle cx="190" cy="52" r="13" stroke-dasharray="1.6 2.2" />
            <path d="M152 44 q5 -4 10 0 t10 0 t10 0 M148 52 q5 -4 10 0 t10 0 t10 0 M152 60 q5 -4 10 0 t10 0 t10 0" />
          </g>
        </g>
      </g>

      <g class="env__all">
        <g class="env__px env__px--cast">
          <path class="env__cast" d={POCKET} transform="translate(6 7)" />
        </g>
        <rect class="env__inside" x="30" y="98" width="180" height="110" rx="6" />
        {/* the flap once it is open: its inside, printed in halftone */}
        <g class="env__flap-open">
          <polygon class="env__flap-open-paper" points={FLAP} />
          <polygon class="env__flap-open-print" points={FLAP} />
        </g>

        <g class="env__px env__px--slip">
          <g class="env__slip-group">
            {/* two leaves grow out of the letter, the way they grow out of the logo; they unfold
              from the letter's edge with a spring once it is out of the pocket */}
            <g class="env__px env__px--leaves">
              <g class="env__unfold">
                <path
                  class="env__leaf env__leaf--ivory"
                  d="M118 112 C 96 108, 84 88, 92 70 C 110 74, 122 92, 118 112 Z"
                />
                <path
                  class="env__leaf env__leaf--green"
                  d="M122 112 C 124 88, 138 70, 160 66 C 164 88, 146 108, 122 112 Z"
                />
                <path
                  class="env__leaf-vein"
                  d="M118 110 C 110 96, 102 84, 94 72 M123 110 C 132 94, 144 80, 158 68"
                />
              </g>
            </g>
            <rect class="env__slip-cast" x="53" y="109" width="140" height="92" />
            <rect class="env__slip" x="50" y="106" width="140" height="92" />
            <rect
              class="env__slip-grain"
              x="50"
              y="106"
              width="140"
              height="92"
              filter="url(#env-grain-ink)"
            />
            <rect class="env__slip-rule" x="56" y="112" width="128" height="80" />
            {/* a small documentary photograph: horizon, hill, low sun, printed in halftone */}
            <g clip-path="url(#env-photo-clip)">
              <rect class="env__photo-sky" x="58" y="116" width="62" height="40" />
              <circle class="env__photo-sun" cx="100" cy="134" r="7" />
              <path class="env__photo-land" d="M58 146 Q 76 132 94 142 T 120 138 V156 H58 Z" />
            </g>
            <rect class="env__photo-frame" x="58" y="116" width="62" height="40" />
            {/* the stamp: perforated edge, a leaf, and the postmark ring over its corner */}
            <rect class="env__stamp-perf" x="140" y="116" width="36" height="42" />
            <rect class="env__stamp" x="143" y="119" width="30" height="36" />
            <path
              class="env__stamp-leaf"
              d="M158 150 C 150 142, 150 130, 158 124 C 166 130, 166 142, 158 150 Z"
            />
            <circle class="env__slip-sun" cx="142" cy="156" r="11" />
            <path class="env__slip-ink" d="M58 168 H176 M58 176 H150 M58 184 H122" />
          </g>
        </g>

        <path class="env__pocket" d={POCKET} />
        {/* the geometric fields, clipped to the pocket: forest and black on the left, black and
            leaf-green arcs on the right, meeting at the centre line */}
        <g clip-path="url(#env-pocket-clip)">
          <g clip-path="url(#env-left-clip)">
            <circle class="env__field env__field--ink" cx="92" cy="226" r="58" />
          </g>
          <g clip-path="url(#env-right-clip)">
            <rect class="env__field env__field--ink" x="120" y="90" width="90" height="120" />
            <circle class="env__field env__field--leaf" cx="214" cy="222" r="66" />
            <circle class="env__field env__field--verdigris" cx="150" cy="222" r="40" />
          </g>
          <rect
            class="env__grain"
            x="30"
            y="98"
            width="180"
            height="110"
            filter="url(#env-grain)"
          />
        </g>
        <path class="env__edge" d={POCKET} />
        <path class="env__v" d={V} />

        <polygon class="env__flap-cast" points={FLAP} transform="translate(0 5)" />
        <g class="env__flap">
          <polygon class="env__flap-face env__flap-face--left" points="30,98 120,98 120,162" />
          <polygon class="env__flap-face env__flap-face--right" points="120,98 210,98 120,162" />
          <g clip-path="url(#env-flap-clip)">
            <circle class="env__field env__field--forest" cx="120" cy="98" r="30" />
            <rect
              class="env__grain"
              x="30"
              y="98"
              width="180"
              height="64"
              filter="url(#env-grain)"
            />
          </g>
          <path class="env__v" d={V} />
        </g>

        <g class="env__px env__px--seal">
          <g class="env__seal">
            <circle class="env__seal-cast" cx="122.5" cy="165" r="17" />
            <circle class="env__seal-disc" cx={SEAL.cx} cy={SEAL.cy} r="17" />
            {/* a postal stamp's perforated outer edge and a fine inner line */}
            <circle class="env__seal-rim" cx={SEAL.cx} cy={SEAL.cy} r="15.2" />
            <circle class="env__seal-ring" cx={SEAL.cx} cy={SEAL.cy} r="12.6" />
            {CREST.map(([dx, dy]) => (
              <path
                key={`${dx}.${dy}`}
                class="env__crest"
                d={crestLeaf(dx, dy)}
                style={`--dx:${dx};--dy:${dy}`}
              />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}

/** The small mark in lists: the logo's envelope, split field and ivory V. */
export function EnvelopeMark() {
  return (
    <svg viewBox="0 0 28 22" aria-hidden="true" focusable="false">
      <rect width="28" height="22" rx="3" fill="var(--forest)" />
      <path d="M14 0 H25 Q28 0 28 3 V19 Q28 22 25 22 H14 Z" fill="var(--near-black)" />
      <path d="M28 22 A 12 12 0 0 1 16 10 V22 Z" fill="var(--leaf)" transform="translate(0 0)" />
      <path d="M1 2 L14 12 L27 2" fill="none" stroke="var(--ivory)" stroke-width="2.6" />
    </svg>
  );
}
