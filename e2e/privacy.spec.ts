import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  await page.waitForFunction(() => !document.querySelector('.boot'), undefined, { timeout: 30_000 });
  return { app, page };
}

test('support bundle export contains no secrets and records the privacy policy', async () => {
  test.setTimeout(120_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'statocyst-privacy-'));
  const bundlePath = join(dataDir, 'support-bundle.json');
  let app: ElectronApplication | null = null;

  try {
    const launched = await launch(dataDir);
    app = launched.app;
    const page = launched.page;

    // Trigger a real failure whose message carries URL credentials. The logger
    // must redact them on disk, not only in the export.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Server URL').fill('https://alice:s3cret@127.0.0.1:1');
    await page.getByRole('button', { name: /Connect/ }).click();
    await expect(page.getByText(/Could not|failed|unreachable|Invalid|Jellyfin/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(800);

    // Replace the native save dialog with a deterministic path for this run.
    await app.evaluate(async ({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
    }, bundlePath);

    await page.getByRole('button', { name: /Export support bundle/ }).click();
    await expect(page.getByText(/Support bundle exported/)).toBeVisible({ timeout: 15_000 });

    const raw = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(raw) as {
      schema: number;
      privacy: { externalReporting: boolean; listeningHistory: boolean };
      health: Array<{ id: string; status: string }>;
      recentLogs: string[];
      settings: Record<string, unknown>;
    };

    expect(bundle.schema).toBe(1);
    expect(bundle.privacy.externalReporting).toBe(false);
    expect(bundle.privacy.listeningHistory).toBe(false);
    expect(bundle.health.length).toBeGreaterThan(0);
    expect(bundle.recentLogs.length).toBeGreaterThan(0);
    expect(Object.keys(bundle.settings)).toContain('listeningHistory');

    expect(raw).not.toContain('s3cret');
    expect(raw).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/);
    expect(raw).not.toMatch(/api_key=(?!\[redacted\])[^&"\s]{4,}/i);
    expect(raw).not.toMatch(/Token="(?!\[redacted\])[^"]+"/);

    // The on-disk JSONL log is sanitized at write time as well.
    const info = await page.evaluate(() =>
      (window as unknown as { statocyst: { app: { info(): Promise<{ logPath: string }> } } }).statocyst.app.info(),
    );
    const logText = await readFile(info.logPath, 'utf8');
    expect(logText).not.toContain('s3cret');
    expect(logText).toContain('[redacted]');
  } finally {
    await app?.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
