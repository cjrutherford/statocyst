import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@statocyst/contracts': resolve(import.meta.dirname, '../contracts/src/index.ts'),
    },
  },
  test: {
    name: 'persistence',
    root: import.meta.dirname,
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
  },
});
