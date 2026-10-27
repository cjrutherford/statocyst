import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'media-library',
    root: import.meta.dirname,
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30_000,
  },
});
