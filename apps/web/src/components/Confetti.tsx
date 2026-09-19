// SPDX-License-Identifier: AGPL-3.0-or-later
// Confetti of plain squares, once. Positions are a fixed table: no randomness, no layout work.

const PIECES: ReadonlyArray<readonly [x: number, y: number, r: number]> = [
  [-150, -120, -200],
  [-110, -170, 160],
  [-70, -200, -120],
  [-30, -150, 240],
  [20, -210, -260],
  [60, -160, 140],
  [105, -190, -180],
  [150, -130, 220],
  [-165, -40, 120],
  [165, -50, -140],
  [-130, 30, -220],
  [135, 40, 200],
  [-90, -90, 300],
  [90, -100, -300],
];

export function Confetti() {
  return (
    <div class="confetti" aria-hidden="true">
      {PIECES.map(([x, y, r]) => (
        <i key={`${x}.${y}`} style={`--x:${x}px;--y:${y}px;--r:${r}deg`} />
      ))}
    </div>
  );
}
