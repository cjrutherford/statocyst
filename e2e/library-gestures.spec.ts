import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');

async function touch(page: Page, box: { x: number; y: number; width: number; height: number }, dx: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document, 'library content must fit the narrow viewport').toBeLessThanOrEqual(width.viewport);
}

test('browse swipes work from track and album bodies without activating them', async () => {
  test.setTimeout(90_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-gestures-'));
  let app: ElectronApplication | null = null;

  try {
    app = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--headless=new'],
      cwd: root,
      env: { ...process.env, STATOCYST_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForSelector('sc-root .app', { timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('.boot'), undefined, { timeout: 30_000 });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole('button', { name: /load demo/i }).first().click();
    await expect(page.locator('tr.track-row')).toHaveCount(4);
    await page.setViewportSize({ width: 320, height: 850 });
    const narrowWidths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      view: document.querySelector('.view')?.scrollWidth ?? 0,
    }));
    expect(narrowWidths.document).toBeLessThanOrEqual(narrowWidths.viewport);
    expect(narrowWidths.view).toBeLessThanOrEqual(narrowWidths.viewport);
    await expectNoPageOverflow(page);

    await page.setViewportSize({ width: 1320, height: 850 });
    const row = page.locator('tr.track-row').first().locator('.track-cell__text');
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(await page.locator('.track-row').first().evaluate((element) => getComputedStyle(element).touchAction)).toBe('pan-y');
    const playbackBefore = await page.evaluate(() =>
      (window as unknown as { statocyst: { playback: { getSnapshot(): Promise<{ state: string; currentEntryId: string | null }> } } }).statocyst.playback.getSnapshot(),
    );
    await touch(page, rowBox!, -100);
    await expect(page.getByRole('tab', { name: /Albums/ })).toHaveAttribute('aria-selected', 'true');
    await expectNoPageOverflow(page);
    const playbackAfter = await page.evaluate(() =>
      (window as unknown as { statocyst: { playback: { getSnapshot(): Promise<{ state: string; currentEntryId: string | null }> } } }).statocyst.playback.getSnapshot(),
    );
    expect(playbackAfter, 'swiping a track body must not change playback').toEqual(playbackBefore);

    const card = page.locator('.album-card').first();
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    await touch(page, cardBox!, -100);
    await expect(page.getByRole('tab', { name: /Artists/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.detail')).toHaveCount(0);
    await expectNoPageOverflow(page);
  } finally {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
