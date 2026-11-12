#!/usr/bin/env node
/**
 * Capture the current Electron build for the landing page.
 *
 * Writes raw PNGs to site/captures/; the site screenshot pass converts them to
 * WebP. This is deliberately separate from the Pages build so CI does not need
 * Electron: run it after a UI change and commit the refreshed captures.
 *
 * Prerequisites:
 *   node_modules/.bin/nx build desktop
 *   node tools/build-electron.mjs
 */
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const captures = resolve(root, 'site/captures');
const browserEntry = resolve(root, 'dist/apps/desktop/browser/index.html');
const electronEntry = resolve(root, 'dist/apps/desktop-electron/main.js');

async function clean(page) {
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('.toast, .import-panel').forEach((item) => item.remove()));
  await page.waitForTimeout(250);
}

async function shot(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await clean(page);
  await page.screenshot({ path: join(captures, name) });
  console.log(`capture ${name} ${width}x${height}`);
}

async function setTheme(page, theme) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: theme }).click();
  await page.waitForTimeout(450);
}

async function nav(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(300);
}

async function openNowPlaying(page) {
  await page.locator('.player__track').click();
  await page.waitForTimeout(450);
}

async function main() {
  for (const file of [browserEntry, electronEntry]) {
    if (!(await stat(file).catch(() => null))) {
      throw new Error(`missing ${file}; run: ./node_modules/.bin/nx build desktop && node tools/build-electron.mjs`);
    }
  }
  await mkdir(captures, { recursive: true });
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-site-'));
  let app;
  try {
    app = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--headless=new'],
      cwd: root,
      env: {
        ...process.env,
        STATOCYST_DATA_DIR: dataDir,
        STATOCYST_LOG_CONSOLE: '0',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
    });
    const page = await app.firstWindow();
    await page.waitForSelector('sc-root .app', { timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('.boot'), undefined, { timeout: 30_000 });
    const info = await page.evaluate(() => window.statocyst.app.info());
    console.log(`capturing Statocyst ${info.version} (${info.platform})`);

    await page.getByRole('button', { name: /load demo/i }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('tr.track-row').length === 4, undefined, {
      timeout: 30_000,
    });
    await clean(page);

    await setTheme(page, 'Dark');
    await nav(page, 'Library');
    await shot(page, 'desktop-library-dark.png', 1320, 880);

    await page.locator('tr.track-row').first().locator('.icon-btn--play').click();
    await page.waitForTimeout(350);
    await openNowPlaying(page);

    await setTheme(page, 'Light');
    await openNowPlaying(page);
    await shot(page, 'desktop-now-playing-light.png', 1320, 880);

    await nav(page, 'Library');
    await shot(page, 'desktop-library-light.png', 1320, 880);

    await nav(page, 'Queue');
    await shot(page, 'desktop-queue-light.png', 1320, 880);

    await setTheme(page, 'Dark');
    await nav(page, 'Library');
    await shot(page, 'phone-library-dark.png', 390, 844);
    await page.locator('tr.track-row').first().locator('.icon-btn--play').click();
    await page.waitForTimeout(350);
    await openNowPlaying(page);
    await shot(page, 'phone-now-playing-dark.png', 390, 844);

    await setTheme(page, 'Light');
    await nav(page, 'Library');
    await shot(page, 'tablet-library.png', 1024, 768);
  } finally {
    if (app) await app.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`capture-site-screenshots failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
