/**
 * Packaged-desktop smoke test.
 *
 * Runs the electron-builder output at release/linux-unpacked/statocyst against a
 * throwaway data directory and asserts the MVP-1 demo path: empty library, demo
 * import, embedded artwork over the art protocol, and real audio playback.
 *
 * Usage (Linux/X11 or Xwayland):
 *   XAUTHORITY=... DISPLAY=:0 node tools/smoke-packaged.mjs
 */
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const executable = join(root, 'release/linux-unpacked/statocyst');
const screenshots = join(root, 'evidence/screenshots');

function check(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function main() {
  check(existsSync(executable), `packaged executable missing: ${executable}`);
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-packaged-'));
  await mkdir(screenshots, { recursive: true });

  let app = null;
  try {
    app = await electron.launch({
      executablePath: executable,
      args: ['--no-sandbox', '--disable-gpu'],
      env: {
        ...process.env,
        STATOCYST_DATA_DIR: dataDir,
        STATOCYST_LOG_CONSOLE: '1',
      },
    });

    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('statocyst')) {
        errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`);
      }
    });

    await page.waitForSelector('sc-root .app', { timeout: 40_000 });
    check((await page.title()) === 'Statocyst', 'window title');

    const packaged = await page.evaluate(() => window.statocyst.app.info());
    check(packaged.packaged === true, 'app reports packaged runtime');
    console.log(`packaged app v${packaged.version} (Electron ${packaged.electron})`);

    await page.getByRole('button', { name: /load demo/i }).first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('tr.track-row').length === 4,
      undefined,
      { timeout: 30_000 },
    );

    const artwork = await page.evaluate(async () => {
      const tracks = await window.statocyst.library.listTracks();
      const withArt = tracks.find((track) => track.artworkUrl);
      if (!withArt) return null;
      const image = new Image();
      image.src = withArt.artworkUrl;
      await image.decode();
      return { title: withArt.title, width: image.naturalWidth };
    });
    check(artwork && artwork.width > 0, 'embedded artwork decodes');
    console.log(`artwork: ${artwork.title} ${artwork.width}x${artwork.width}`);

    await page.locator('tr.track-row').first().locator('.icon-btn--play').click();
    await page.waitForFunction(
      () => window.statocyst.playback.getSnapshot().then((snapshot) => snapshot.state === 'playing'),
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1_400);
    const snapshot = await page.evaluate(() => window.statocyst.playback.getSnapshot());
    check(snapshot.positionMs > 600, `playback advanced (${snapshot.positionMs}ms)`);
    check(snapshot.durationMs > 5_000, 'track duration is real');
    console.log(
      `playback: ${snapshot.track?.title} ${Math.round(snapshot.positionMs)}ms / ${Math.round(snapshot.durationMs)}ms`,
    );

    await page.waitForTimeout(500);
    await page.screenshot({ path: join(screenshots, '08-packaged.png') });

    const appPath = await app.evaluate(({ app: host }) => host.getAppPath());
    check(appPath.includes('app.asar'), `running from packaged asar (${appPath})`);
    const db = await stat(join(dataDir, 'statocyst.db')).catch(() => null);
    check(db && db.size > 0, 'libSQL database created on disk');
    check(errors.length === 0, `renderer errors: ${errors.join('; ')}`);

    console.log(`database: ${join(dataDir, 'statocyst.db')} (${db.size} bytes)`);
    console.log('PACKAGED SMOKE PASS');
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (!process.env['STATOCYST_KEEP_SMOKE_DATA']) {
      await rm(dataDir, { recursive: true, force: true });
    } else {
      console.log(`smoke data kept at ${dataDir}`);
    }
  }
}

main().catch((error) => {
  console.error('PACKAGED SMOKE FAIL');
  console.error(error);
  process.exit(1);
});
