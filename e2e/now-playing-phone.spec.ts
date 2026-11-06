import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
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
  await page.waitForFunction(() => !document.querySelector('.boot'), undefined, {
    timeout: 30_000,
  });
  return { app, page };
}

interface Rect {
  left: number;
  right: number;
  center: number;
  top: number;
  bottom: number;
  width: number;
}

test('phone Now Playing fills the width, centres play and exposes track actions', async () => {
  test.setTimeout(120_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-mobile-'));
  let app: ElectronApplication | null = null;

  try {
    const launched = await launch(dataDir);
    app = launched.app;
    const page = launched.page;

    // Use the bundled demo library so the test needs no server or fixtures.
    await page.getByRole('button', { name: /load demo/i }).first().click();
    await expect.poll(() => page.locator('tr.track-row').count(), { timeout: 30_000 }).toBe(4);
    await page.locator('tr.track-row').first().locator('.icon-btn--play').click();
    await page.locator('.player__track').click();

    // Phone viewport, matching the Pixel-class layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.controls')).toBeVisible();
    await page.waitForTimeout(300);

    const layout = await page.evaluate(() => {
      const rect = (selector: string): Rect | null => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          center: box.left + box.width / 2,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
        };
      };
      const controls = rect('.controls');
      const play = rect('.play');
      const volume = rect('.volume-slot');
      return { viewport: innerWidth, controls, play, volume };
    });

    expect(layout.controls).not.toBeNull();
    expect(layout.play).not.toBeNull();
    expect(layout.volume).not.toBeNull();

    const { controls, play, volume, viewport } = layout;
    expect(controls!.width).toBeGreaterThanOrEqual(viewport - 40);
    // The play button is centred in the transport row. (Electron reserves a
    // classic scrollbar, so the row width can be slightly narrower than the
    // viewport; phones use overlay scrollbars and match the viewport exactly.)
    expect(Math.abs(play!.center - controls!.center)).toBeLessThanOrEqual(2);
    expect(Math.abs(play!.center - viewport / 2)).toBeLessThanOrEqual(8);
    // Volume is the rightmost cell of the same transport row, not a second row.
    expect(volume!.center).toBeGreaterThan(play!.right);
    expect(volume!.top).toBeLessThan(play!.bottom);
    expect(volume!.bottom).toBeGreaterThan(play!.top);

    const favorite = page.locator('.control-favorite');
    expect(await favorite.getAttribute('aria-pressed')).toBe('false');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');

    // Demo audio is local, so the honest state is "On this device", not a
    // redundant download action.
    await expect(page.locator('.on-device')).toBeVisible();
    await expect(page.locator('.dl-pill')).toHaveCount(0);
  } finally {
    if (app) await app.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});
