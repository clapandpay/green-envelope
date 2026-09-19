import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Real elliptic-curve work and a one-megabyte atom: fine on an idle machine, over the
    // default five seconds on a busy laptop or a shared CI runner. Slow must not mean red.
    testTimeout: 30_000,
  },
});
