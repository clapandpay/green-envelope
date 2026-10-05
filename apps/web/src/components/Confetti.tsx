// SPDX-License-Identifier: AGPL-3.0-or-later
// Paper cuttings, once: shards of ochre, leaf, forest, ink and ivory, cut as leaves, slivers and
// triangles, that burst out of the opened seal and then flutter down, turning over to show their
// other face. Positions come from a golden-angle fan, so there is no randomness and no layout
// work; the outer element travels, the inner one tumbles (see styles/claim.css).

const COUNT = 30;
const GOLDEN = 2.399963;

interface Shard {
  x: number;
  y: number;
  /** tumble speed and phase */
  d: number;
  w: number;
  shape: number;
  tone: number;
  s: number;
}

const SHARDS: readonly Shard[] = Array.from({ length: COUNT }, (_, i) => {
  const a = i * GOLDEN;
  const reach = 70 + ((i * 53) % 120);
  return {
    x: Math.round(Math.cos(a) * reach * 1.25),
    // a fan that favours up: the burst is a flower, then gravity takes it
    y: Math.round(-Math.abs(Math.sin(a)) * reach - 40),
    d: 1700 + ((i * 131) % 900),
    w: 380 + ((i * 97) % 520),
    shape: i % 5,
    tone: (i * 3) % 5,
    s: 10 + ((i * 7) % 9),
  };
});

export function Confetti() {
  return (
    <div class="confetti" aria-hidden="true">
      {SHARDS.map((p) => (
        <i
          key={`${p.x}.${p.y}`}
          class={`confetti__p confetti__p--${p.shape} confetti__t--${p.tone}`}
          style={`--x:${p.x}px;--y:${p.y}px;--d:${p.d}ms;--w:${p.w}ms;--s:${p.s}px`}
        >
          <b />
        </i>
      ))}
    </div>
  );
}
