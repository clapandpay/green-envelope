// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

// Run on purpose: `pnpm e2e:testnet` talks to the real testnet11 and waits for blocks;
// `pnpm e2e:handoff` drives the Klimper handoff in headless Chrome.
export default defineConfig({
  test: {
    include: ['apps/web/src/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
  },
});
