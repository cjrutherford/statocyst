import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const artifacts = resolve(root, 'evidence/screenshots');

interface Snapshot {
  state: string;
  currentEntryId: string | null;
  positionMs: number;
  durationMs: number;
  track: { id: string; title: string; artworkUrl: string | null } | null;
}

interface TrackRow {
  id: string;
  title: string;
  artworkUrl: string | null;
}

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--headless=new'],
    cwd: root,
    env: {
      ...process.env,
      STATOCYST_DATA_DIR: dataDir,
      STATOCYST_LOG_CONSOLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => {
    console.error('[renderer pageerror]', error);
  });
  await page.waitForSelector('sc-root .app', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.boot'), undefined, {
    timeout: 30_000,
  });
  return { app, page };
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() =>
    (window as unknown as { statocyst: { playback: { getSnapshot(): Promise<Snapshot> } } }).statocyst.playback.getSnapshot(),
  );
}

async function tracks(page: Page): Promise<TrackRow[]> {
  return page.evaluate(() =>
    (window as unknown as { statocyst: { library: { listTracks(): Promise<TrackRow[]> } } }).statocyst.library.listTracks(),
  );
}

async function queueLength(page: Page): Promise<number> {
  return page.evaluate(async () =>
    (
      await (
        window as unknown as {
          statocyst: {
            playback: { getQueue(): Promise<{ entries: unknown[] }> };
          };
        }
      ).statocyst.playback.getQueue()
    ).entries.length,
  );
}

async function shot(page: Page, name: string): Promise<void> {
  // Let view/toast animations settle so evidence screenshots are not caught mid-fade.
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(artifacts, name) });
}

async function waitForState(page: Page, state: string, timeout = 20_000): Promise<void> {
  await expect
    .poll(async () => (await snapshot(page)).state, { timeout })
    .toBe(state);
}

test('local import, real playback, queue edits and restart recovery', async () => {
  test.setTimeout(180_000);
  await mkdir(artifacts, { recursive: true });
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-e2e-'));

  let app: ElectronApplication | null = null;
  let page: Page | null = null;

  try {
    ({ app, page } = await launch(dataDir));

    // --- Empty state ------------------------------------------------------
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your library is silent' })).toBeVisible();
    await shot(page, '01-library-empty.png');

    // --- Demo import ------------------------------------------------------
    await page.getByRole('button', { name: /load demo/i }).first().click();
    await expect.poll(() => page!.locator('tr.track-row').count(), { timeout: 30_000 }).toBe(4);
    await expect(page.getByRole('tab', { name: /Tracks/ })).toContainText('4');
    await expect.poll(() => queueLength(page!), { timeout: 15_000 }).toBe(4);
    await shot(page, '02-library-tracks.png');

    // Artwork protocol responds with a decodable image.
    const imported = await tracks(page);
    expect(imported).toHaveLength(4);
    const withArt = imported.find((track) => track.artworkUrl);
    expect(withArt, 'demo audio should expose embedded artwork').toBeTruthy();
    const artRendered = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        return { loaded: false };
      }
      return { loaded: true, width: image.naturalWidth, height: image.naturalHeight };
    }, withArt!.artworkUrl!);
    expect(artRendered.loaded).toBe(true);
    expect(artRendered.width).toBeGreaterThan(0);

    // --- Byte-range media protocol (main-process request) -----------------
    // The library sorts by artist, so pick the MP3 explicitly for the MIME check.
    const mp3 = imported.find((track) => track.title === 'Sonar Bloom');
    expect(mp3, 'demo MP3 should be imported').toBeTruthy();
    const mediaUrl = `statocyst-media://track/${mp3!.id}`;
    const ranged = await app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url, { headers: { Range: 'bytes=0-99' } });
      const body = await response.arrayBuffer();
      return {
        status: response.status,
        length: body.byteLength,
        contentRange: response.headers.get('content-range'),
        acceptRanges: response.headers.get('accept-ranges'),
        type: response.headers.get('content-type'),
      };
    }, mediaUrl);
    expect(ranged.status).toBe(206);
    expect(ranged.length).toBe(100);
    expect(ranged.contentRange).toMatch(/^bytes 0-99\/\d+$/);
    expect(ranged.acceptRanges).toBe('bytes');
    expect(ranged.type).toBe('audio/mpeg');

    // --- Real playback ----------------------------------------------------
    await page.locator('tr.track-row').first().locator('.icon-btn--play').click();
    await waitForState(page, 'playing');
    await expect
      .poll(async () => (await snapshot(page)).positionMs, { timeout: 20_000 })
      .toBeGreaterThan(600);
    const playing = await snapshot(page);
    expect(playing.durationMs).toBeGreaterThan(5_000);
    expect(playing.track).not.toBeNull();

    await shot(page, '03-library-playing.png');

    // --- Pause / seek -----------------------------------------------------
    await page.locator('sc-player-bar').getByRole('button', { name: 'Pause' }).click();
    await waitForState(page, 'paused');
    const paused = await snapshot(page);

    const seekBar = page.locator('sc-player-bar input[aria-label="Seek position"]');
    await seekBar.evaluate((element: HTMLInputElement) => {
      element.value = '3000';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect
      .poll(async () => (await snapshot(page)).positionMs, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2_900);

    // --- Next / previous --------------------------------------------------
    const beforeSkip = (await snapshot(page)).currentEntryId;
    await page.locator('sc-player-bar').getByRole('button', { name: 'Next track' }).click();
    await expect
      .poll(async () => (await snapshot(page)).currentEntryId, { timeout: 15_000 })
      .not.toBe(beforeSkip);
    await waitForState(page, 'playing');

    // --- Now playing ------------------------------------------------------
    await page.locator('sc-player-bar').getByRole('button', { name: /Open now playing/i }).click();
    await expect(page.getByRole('heading', { name: 'The deep channel' })).toBeVisible();
    await shot(page, '04-now-playing.png');

    // --- Queue editing ----------------------------------------------------
    await page.locator('.nav__item').filter({ hasText: 'Queue' }).click();
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
    await expect(page.locator('.queue__item')).toHaveCount(4);

    const firstTitle = await page.locator('.queue__item').nth(0).locator('.queue__title').innerText();
    const secondTitle = await page.locator('.queue__item').nth(1).locator('.queue__title').innerText();
    await page.locator('.queue__item').first().getByTitle('Move down').click();
    await expect
      .poll(async () => page!.locator('.queue__item').nth(0).locator('.queue__title').innerText())
      .toBe(secondTitle);
    await expect
      .poll(async () => page!.locator('.queue__item').nth(1).locator('.queue__title').innerText())
      .toBe(firstTitle);

    await page.locator('.queue__item').last().getByTitle('Remove from queue').click();
    await expect(page.locator('.queue__item')).toHaveCount(3);
    await shot(page, '05-queue.png');

    // Persist a paused, seeked state for the restart assertion.
    await page.locator('sc-player-bar').getByRole('button', { name: 'Pause' }).click();
    await waitForState(page, 'paused');
    await seekBar.evaluate((element: HTMLInputElement) => {
      element.value = '4000';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect
      .poll(async () => (await snapshot(page)).positionMs, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3_900);
    const beforeRestart = await snapshot(page);

    // --- Settings ---------------------------------------------------------
    await page.locator('.nav__item').filter({ hasText: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Database healthy')).toBeVisible({ timeout: 15_000 });
    await shot(page, '06-settings.png');

    await app.close();
    app = null;
    page = null;

    // --- Restart recovery -------------------------------------------------
    ({ app, page } = await launch(dataDir));
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();

    const restoredTracks = await tracks(page);
    expect(restoredTracks).toHaveLength(4);
    await expect.poll(() => queueLength(page!), { timeout: 20_000 }).toBe(3);

    const restored = await snapshot(page);
    expect(restored.currentEntryId).toBe(beforeRestart.currentEntryId);
    expect(restored.track?.id).toBe(beforeRestart.track?.id);
    expect(restored.positionMs).toBeGreaterThanOrEqual(3_900);
    expect(['paused', 'idle']).toContain(restored.state);
    await shot(page, '07-restored.png');

    // Resuming the restored session still produces real audio.
    await page.locator('sc-player-bar').getByRole('button', { name: 'Play', exact: true }).click();
    await waitForState(page, 'playing');
    await expect
      .poll(async () => (await snapshot(page)).positionMs, { timeout: 20_000 })
      .toBeGreaterThan(4_000);
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (!process.env['STATOCYST_KEEP_E2E_DATA']) {
      await rm(dataDir, { recursive: true, force: true });
    } else {
      console.log(`E2E data kept at ${dataDir}`);
    }
  }
});
