import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@statocyst/contracts': resolve(import.meta.dirname, '../contracts/src/index.ts'),
      '@statocyst/playback-core': resolve(import.meta.dirname, '../playback-core/src/index.ts'),
    },
  },
  test: {
    name: 'recommendation',
    root: import.meta.dirname,
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
