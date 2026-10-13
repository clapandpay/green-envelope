// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// The release number is green-envelope/package.json's version; a release tag must match it
// (.github/workflows/green-envelope.yml). The commit comes from GIT_COMMIT where the build has no .git (the Docker
// image), otherwise from git itself, marked -dirty when the tree has uncommitted changes.
const root = fileURLToPath(new URL('../..', import.meta.url)); // green-envelope/
const { version } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  version: string;
};

// From green-envelope/, not apps/web: a change in packages/ makes the build dirty too.
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function commit(): string {
  const fromEnv = process.env.GIT_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    const dirty = git('status', '--porcelain', '--', '.') !== '';
    return git('rev-parse', '--short=7', 'HEAD') + (dirty ? '-dirty' : '');
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [preact()],
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(version),
    'import.meta.env.APP_COMMIT': JSON.stringify(commit()),
  },
  build: {
    target: 'es2022', // bigint and top-level language features; every passkey-capable browser has them
    manifest: true, // scripts/size-budget.mjs reads it
    modulePreload: { polyfill: false },
  },
});
