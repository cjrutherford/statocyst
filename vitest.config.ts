import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'libs/contracts/vitest.config.ts',
      'libs/playback-core/vitest.config.ts',
      'libs/persistence/vitest.config.ts',
      'libs/media-library/vitest.config.ts',
    ],
  },
});
