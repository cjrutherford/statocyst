import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'contracts',
    root: import.meta.dirname,
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
