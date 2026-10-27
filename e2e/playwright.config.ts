import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const evidence = resolve(__dirname, '..', 'evidence');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(evidence, 'artifacts/playwright-report'), open: 'never' }],
  ],
  outputDir: resolve(evidence, 'artifacts/playwright-output'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
