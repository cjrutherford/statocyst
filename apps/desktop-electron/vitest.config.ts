import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@statocyst/contracts': resolve(import.meta.dirname, '../../libs/contracts/src/index.ts'),
      '@statocyst/playback-core': resolve(import.meta.dirname, '../../libs/playback-core/src/index.ts'),
      '@statocyst/persistence': resolve(import.meta.dirname, '../../libs/persistence/src/index.ts'),
      '@statocyst/media-library': resolve(import.meta.dirname, '../../libs/media-library/src/index.ts'),
      '@statocyst/jellyfin-client': resolve(import.meta.dirname, '../../libs/jellyfin-client/src/index.ts'),
    },
  },
  test: {
    name: 'desktop-electron',
    root: import.meta.dirname,
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
