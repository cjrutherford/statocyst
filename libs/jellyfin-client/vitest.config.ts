import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'jellyfin-client',
    root: import.meta.dirname,
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30_000,
  },
});
