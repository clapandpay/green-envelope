import { defineConfig } from 'vitest/config';

// Talks to the real testnet11 and waits for blocks. Run on purpose: `pnpm e2e:testnet`.
export default defineConfig({
  test: {
    include: ['apps/web/src/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
  },
});
