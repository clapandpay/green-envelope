// SPDX-License-Identifier: AGPL-3.0-or-later
// Fails when the JavaScript the claim route (/g/...) needs exceeds the budget, gzipped.
// "Needs" = the entry chunk and everything it imports statically. The create and wallet
// screens are dynamic imports and are reported separately. Run after `vite build`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 100_000;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const manifestPath = join(dist, '.vite', 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('size-budget: no build found. Run `pnpm --filter web build` first.');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const gzipped = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

/** A chunk and its static imports, transitively. */
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const next of manifest[key]?.imports ?? []) closure(next, seen);
  return seen;
}

function measure(keys) {
  const js = [...keys].map((key) => manifest[key].file).filter((file) => file.endsWith('.js'));
  const css = [...new Set([...keys].flatMap((key) => manifest[key].css ?? []))];
  return {
    js: js.map((file) => [file, gzipped(file)]),
    css: css.map((file) => [file, gzipped(file)]),
  };
}

const total = (rows) => rows.reduce((sum, [, bytes]) => sum + bytes, 0);

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) {
  console.error('size-budget: the manifest has no entry.');
  process.exit(2);
}

const claimKeys = closure(entryKey);
const claim = measure(claimKeys);
console.log('Claim route /g/:id (first load), gzipped');
for (const [file, bytes] of [...claim.js, ...claim.css])
  console.log(`  ${kB(bytes).padStart(10)}  ${file}`);
console.log(`  ${kB(total(claim.js)).padStart(10)}  JavaScript total (budget ${kB(BUDGET_BYTES)})`);
console.log(`  ${kB(total(claim.css)).padStart(10)}  CSS total`);

for (const key of manifest[entryKey].dynamicImports ?? []) {
  const extra = new Set([...closure(key)].filter((k) => !claimKeys.has(k)));
  const route = measure(extra);
  console.log(`\nOn demand: ${manifest[key].name ?? key}, gzipped`);
  for (const [file, bytes] of [...route.js, ...route.css])
    console.log(`  ${kB(bytes).padStart(10)}  ${file}`);
}

const html = gzipped('index.html');
console.log(`\nindex.html ${kB(html)} gzipped`);

if (total(claim.js) > BUDGET_BYTES) {
  console.error(
    `\nsize-budget: FAILED. The claim route needs ${kB(total(claim.js))} of JavaScript.`,
  );
  process.exit(1);
}
console.log('\nsize-budget: ok');
