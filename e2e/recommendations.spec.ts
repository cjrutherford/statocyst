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
      STATOCYST_LOG_CONSOLE: '1',
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

async function waitForState(page: Page, state: string, timeout = 20_000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          (
            window as unknown as {
              statocyst: { playback: { getSnapshot(): Promise<{ state: string }> } };
            }
          ).statocyst.playback.getSnapshot(),
        ).then((snapshot) => snapshot.state),
      { timeout },
    )
    .toBe(state);
}

function block(page: Page, heading: string) {
  return page.locator('.list-block').filter({
    has: page.getByRole('heading', { name: heading, exact: true }),
  });
}

test('recently played feeds playlists and the local recommendation mix', async () => {
  test.setTimeout(180_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-recommendations-'));

  let app: ElectronApplication | null = null;
  let page: Page | null = null;

  try {
    ({ app, page } = await launch(dataDir));

    await page.getByRole('button', { name: /load demo/i }).first().click();
    await expect.poll(() => page!.locator('tr.track-row').count(), { timeout: 30_000 }).toBe(4);

    // History is opt-in, so turn it on before playing anything.
    await page.locator('.nav__item').filter({ hasText: 'Settings' }).click();
    const historyToggle = page.getByRole('checkbox', {
      name: /Save local listening history/,
    });
    await historyToggle.check();
    await expect(historyToggle).toBeChecked();

    await page.locator('.nav__item').filter({ hasText: 'Library' }).click();
    await page.locator('tr.track-row').first().locator('.icon-btn--play').click();
    await waitForState(page, 'playing');

    await page.locator('.nav__item').filter({ hasText: 'Playlists' }).click();
    await expect(page.getByRole('heading', { name: 'Playlists', exact: true })).toBeVisible();

    const recently = block(page, 'Recently played');
    await expect
      .poll(() => recently.locator('.mini-list li').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
    const forYou = block(page, 'For you');
    await expect(forYou.locator('.mini-list li').first()).toBeVisible();
    await expect(forYou.locator('.reason-chip').first()).not.toBeEmpty();

    // Pick the played song as a seed and explain the resulting mix.
    await recently.getByRole('checkbox').first().check();
    await expect(recently.getByText('1 selected')).toBeVisible();
    await recently.getByRole('button', { name: /Mix from selected/ }).click();
    await expect(forYou.getByText('Seeded by 1 selected track.')).toBeVisible();

    // Electron's headless window does not surface JS prompts to Playwright reliably;
    // stub the name so this still exercises the real create/save path.
    await page.evaluate(() => {
      window.prompt = () => 'E2E local mix';
    });
    await forYou.getByRole('button', { name: /Save as playlist/ }).click();
    await expect(page.getByText('E2E local mix').first()).toBeVisible();

    // The history is in the local catalog, so a fresh launch shows it again.
    await app.close();
    app = null;
    page = null;
    ({ app, page } = await launch(dataDir));
    await page.locator('.nav__item').filter({ hasText: 'Playlists' }).click();
    await expect
      .poll(() => block(page!, 'Recently played').locator('.mini-list li').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1);
  } finally {
    await app?.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});
