// SPDX-License-Identifier: AGPL-3.0-or-later
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    target: 'es2022', // bigint and top-level language features; every passkey-capable browser has them
    manifest: true, // scripts/size-budget.mjs reads it
    modulePreload: { polyfill: false },
  },
});
