// SPDX-License-Identifier: AGPL-3.0-or-later
// A compact QR encoder for short texts (an address): byte mode, error correction level L,
// versions 1 to 9 (up to 230 bytes). Follows ISO/IEC 18004; checked module for module against
// a reference encoder in qr.test.ts. Lives in the wallet chunk, not on the claim route.

/** ECC codewords per block and number of blocks at level L, by version (index 0 unused). */
const ECC_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30];
const BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2];
const MAX_VERSION = 9;
const FORMAT_BITS_L = 1;

export interface QrCode {
  size: number;
  version: number;
  mask: number;
  /** True for a dark module. `x` and `y` run from 0 to size - 1. */
  dark(x: number, y: number): boolean;
}

export class QrError extends Error {
  readonly code = 'too_long';
}

/** All codewords (data + ecc) a version holds: the modules left after the function patterns. */
function totalCodewords(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    modules -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

function dataCodewords(version: number): number {
  return totalCodewords(version) - (ECC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 1);
}

// ---- Reed-Solomon over GF(256), polynomial 0x11d ----

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---- data: mode, length, bytes, terminator, padding, ecc, interleaving ----

function codewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCodewords(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // 8-bit count for versions 1 to 9
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    data.push(byte);
  }

  // At level L every block of versions 1 to 9 has the same length.
  const blockCount = BLOCKS[version] ?? 1;
  const blockLength = capacity / blockCount;
  const divisor = rsDivisor(ECC_PER_BLOCK[version] ?? 0);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  for (let b = 0; b < blockCount; b++) {
    const block = data.slice(b * blockLength, (b + 1) * blockLength);
    blocks.push(block);
    eccs.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  for (const group of [blocks, eccs]) {
    const length = group[0]?.length ?? 0;
    for (let i = 0; i < length; i++) for (const block of group) out.push(block[i] ?? 0);
  }
  return out;
}

// ---- the grid ----

class Grid {
  readonly modules: Uint8Array;
  readonly reserved: Uint8Array;
  constructor(readonly size: number) {
    this.modules = new Uint8Array(size * size);
    this.reserved = new Uint8Array(size * size);
  }
  get(x: number, y: number): number {
    return this.modules[y * this.size + x] ?? 0;
  }
  isReserved(x: number, y: number): boolean {
    return this.reserved[y * this.size + x] === 1;
  }
  set(x: number, y: number, dark: boolean | number): void {
    this.modules[y * this.size + x] = dark ? 1 : 0;
  }
  /** Sets a function module: one that carries no data and is never masked. */
  fix(x: number, y: number, dark: boolean | number): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.set(x, y, dark);
    this.reserved[y * this.size + x] = 1;
  }
}

function alignmentCentres(version: number, size: number): number[] {
  if (version === 1) return [];
  const last = size - 7;
  return version < 7 ? [6, last] : [6, (6 + last) / 2, last];
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const { size } = grid;
  for (let i = 0; i < size; i++) {
    grid.fix(6, i, i % 2 === 0);
    grid.fix(i, 6, i % 2 === 0);
  }
  // finders with their light separators
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        grid.fix(cx + dx, cy + dy, ring !== 2 && ring !== 4);
      }
    }
  }
  const centres = alignmentCentres(version, size);
  const end = centres.length - 1;
  centres.forEach((cx, i) => {
    centres.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === end) || (i === end && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          grid.fix(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  drawFormat(grid, 0); // reserves the format area; the real bits come with the mask
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.fix(a, b, (bits >>> i) & 1);
      grid.fix(b, a, (bits >>> i) & 1);
    }
  }
}

function drawFormat(grid: Grid, mask: number): void {
  const { size } = grid;
  const data = (FORMAT_BITS_L << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i: number) => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i++) grid.fix(8, i, bit(i));
  grid.fix(8, 7, bit(6));
  grid.fix(8, 8, bit(7));
  grid.fix(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.fix(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.fix(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.fix(8, size - 15 + i, bit(i));
  grid.fix(8, size - 8, true);
}

function placeData(grid: Grid, data: readonly number[]): void {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (grid.isReserved(x, y) || i >= data.length * 8) continue;
        grid.set(x, y, ((data[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1);
        i += 1;
      }
    }
  }
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** XORs a mask over the data modules. Applying it twice undoes it. */
function applyMask(grid: Grid, mask: number): void {
  const test = MASKS[mask];
  if (!test) throw new RangeError('mask must be 0 to 7');
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.isReserved(x, y) && test(x, y)) grid.set(x, y, grid.get(x, y) ^ 1);
    }
  }
}

/** The standard's four penalty rules; the mask with the lowest score reads best. */
function penalty(grid: Grid): number {
  const { size } = grid;
  let score = 0;
  let dark = 0;
  const FINDER_A = 0b10111010000;
  const FINDER_B = 0b00001011101;
  for (let a = 0; a < size; a++) {
    for (const horizontal of [true, false]) {
      let run = 0;
      let previous = -1;
      let window = 0;
      for (let b = 0; b < size; b++) {
        const value = horizontal ? grid.get(b, a) : grid.get(a, b);
        if (value === previous) run += 1;
        else {
          previous = value;
          run = 1;
        }
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
        window = ((window << 1) | value) & 0x7ff;
        if (b >= 10 && (window === FINDER_A || window === FINDER_B)) score += 40;
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = grid.get(x, y);
      dark += value;
      if (
        x + 1 < size &&
        y + 1 < size &&
        value === grid.get(x + 1, y) &&
        value === grid.get(x, y + 1) &&
        value === grid.get(x + 1, y + 1)
      ) {
        score += 3;
      }
    }
  }
  const percent = (dark * 100) / (size * size);
  return score + Math.floor(Math.abs(percent - 50) / 5) * 10;
}

/** Encodes `text` (as UTF-8). `mask` fixes the mask pattern; by default the best one is chosen. */
export function encodeQr(text: string, options: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && bytes.length + 2 > dataCodewords(version)) version += 1;
  if (version > MAX_VERSION) throw new QrError('text is too long for this QR encoder');

  const grid = new Grid(version * 4 + 17);
  drawFunctionPatterns(grid, version);
  placeData(grid, codewords(bytes, version));

  let mask = options.mask ?? 0;
  if (options.mask === undefined) {
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(grid, candidate);
      drawFormat(grid, candidate);
      const score = penalty(grid);
      if (score < best) {
        best = score;
        mask = candidate;
      }
      applyMask(grid, candidate);
    }
  }
  applyMask(grid, mask);
  drawFormat(grid, mask);
  return { size: grid.size, version, mask, dark: (x, y) => grid.get(x, y) === 1 };
}

/** One SVG path for all dark modules, with `margin` modules of quiet zone around. */
export function qrPath(code: QrCode, margin = 4): { d: string; viewBox: string } {
  let d = '';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.dark(x, y)) continue;
      let width = 1;
      while (x + width < code.size && code.dark(x + width, y)) width += 1;
      d += `M${x + margin} ${y + margin}h${width}v1h-${width}z`;
      x += width - 1;
    }
  }
  const box = code.size + margin * 2;
  return { d, viewBox: `0 0 ${box} ${box}` };
}
