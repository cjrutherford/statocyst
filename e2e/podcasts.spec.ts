import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const audio = readFileSync(join(root, 'resources/demo/01-sonar-bloom.mp3'));

let app: ElectronApplication;
let page: Page;
let dataDir: string;
let server: Server;
let baseUrl: string;
let serverClosed = false;

function feedXml(): string {
  const item = (index: number, title: string, date: string) =>
    `<item><title>${title}</title><guid>ep-${index}</guid><pubDate>${date}</pubDate>` +
    `<description><![CDATA[<p>Episode ${index} show notes. <a href="${baseUrl}/notes/${index}">Notes</a></p>]]></description>` +
    `<enclosure url="${baseUrl}/audio.mp3" type="audio/mpeg" length="${audio.byteLength}" />` +
    `<itunes:duration>00:03:00</itunes:duration><itunes:episode>${index}</itunes:episode>` +
    `<itunes:season>1</itunes:season></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">` +
    `<channel><title>E2E Deep Water</title><link>${baseUrl}/site</link>` +
    `<description>An end-to-end podcast.</description><language>en-us</language>` +
    `<itunes:author>E2E Studio</itunes:author><itunes:image href="${baseUrl}/art.jpg" />` +
    `<itunes:explicit>no</itunes:explicit>` +
    item(1, 'First E2E Episode', 'Wed, 01 Oct 2026 08:00:00 GMT') +
    item(2, 'Second E2E Episode', 'Thu, 02 Oct 2026 08:00:00 GMT') +
    `</channel></rss>`;
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', baseUrl);
    if (url.pathname === '/feed.xml') {
      response.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      response.end(feedXml());
      return;
    }
    if (url.pathname === '/apple/top.json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        feed: {
          results: [
            {
              id: '4242', name: 'E2E Deep Water', artistName: 'E2E Studio',
              artworkUrl100: `${baseUrl}/art.jpg`, genres: [{ genreId: '1533', name: 'Science' }],
            },
            {
              id: '4243', name: 'E2E Nightly', artistName: 'E2E Newsroom',
              artworkUrl100: `${baseUrl}/art.jpg`, genres: [{ genreId: '1489', name: 'News' }],
            },
          ],
        },
      }));
      return;
    }
    if (url.pathname === '/apple/lookup') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        resultCount: 2,
        results: [
          {
            wrapperType: 'track', kind: 'podcast', collectionId: 4242, trackId: 4242,
            artistName: 'E2E Studio', collectionName: 'E2E Deep Water',
            feedUrl: `${baseUrl}/feed.xml`, artworkUrl600: `${baseUrl}/art.jpg`,
            trackCount: 2, collectionExplicitness: 'notExplicit', primaryGenreName: 'Science',
          },
          {
            wrapperType: 'track', kind: 'podcast', collectionId: 4243, trackId: 4243,
            artistName: 'E2E Newsroom', collectionName: 'E2E Nightly',
            feedUrl: `${baseUrl}/nightly.xml`, artworkUrl600: `${baseUrl}/art.jpg`,
            trackCount: 1, collectionExplicitness: 'notExplicit', primaryGenreName: 'News',
          },
        ],
      }));
      return;
    }
    if (url.pathname === '/nightly.xml') {
      response.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      response.end(feedXml().replaceAll('E2E Deep Water', 'E2E Nightly'));
      return;
    }
    if (url.pathname === '/apple/search') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        resultCount: 1,
        results: [{
          wrapperType: 'track', kind: 'podcast', collectionId: 4242, trackId: 4242,
          artistName: 'E2E Studio', collectionName: 'E2E Deep Water',
          feedUrl: `${baseUrl}/feed.xml`, artworkUrl100: `${baseUrl}/art.jpg`,
          trackCount: 2, collectionExplicitness: 'notExplicit', primaryGenreName: 'Science',
        }],
      }));
      return;
    }
    if (url.pathname === '/fyyd/search') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 1, msg: 'ok', data: [] }));
      return;
    }
    if (url.pathname === '/site') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>');
      return;
    }
    if (url.pathname === '/audio.mp3') {
      response.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Accept-Ranges': 'bytes',
      });
      response.end(audio);
      return;
    }
    if (url.pathname === '/art.jpg' || url.pathname.startsWith('/notes/')) {
      if (url.pathname === '/art.jpg') {
        // A valid 1×1 PNG; the fixture's extension is incidental. Using real
        // image bytes lets the E2E assert that artwork actually renders.
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('notes');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;

  dataDir = await mkdtemp(join(tmpdir(), 'statocyst-e2e-podcast-'));
  app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--headless=new'],
    cwd: root,
    env: {
      ...process.env,
      STATOCYST_DATA_DIR: dataDir,
      STATOCYST_LOG_CONSOLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      STATOCYST_APPLE_SEARCH_URL: `${baseUrl}/apple/search`,
      STATOCYST_FYYD_SEARCH_URL: `${baseUrl}/fyyd/search`,
      STATOCYST_APPLE_TOP_URL: `${baseUrl}/apple/top.json`,
      STATOCYST_APPLE_LOOKUP_URL: `${baseUrl}/apple/lookup`,
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector('sc-root .app', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.boot'), undefined, { timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (!serverClosed) {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
  }
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test('subscribes, plays, marks played and keeps the podcast bar across views', async () => {
  await page.evaluate(async () => {
    const api = (window as unknown as { statocyst: { settings: { update: (patch: unknown) => Promise<unknown> } } }).statocyst;
    await api.settings.update({ podcastAllowLocalNetwork: true });
  });

  await page.locator('.nav__item').filter({ hasText: 'Podcasts' }).click();
  await expect(page.getByRole('heading', { name: 'Podcasts' })).toBeVisible();
  await page.getByRole('button', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Top podcasts' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { name: 'Browse by category' })).toBeVisible();
  await expect(page.locator('.top-card .art__image').first()).toHaveAttribute(
    'src',
    /^statocyst-art:\/\/image\//,
    { timeout: 20_000 },
  );
  await expect(page.getByRole('tab', { name: /Subscribed/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Downloaded/ })).toBeVisible();
  await page.screenshot({
    path: join(root, 'evidence/screenshots/s045-podcast-discovery.png'),
    fullPage: true,
  });
  await page.locator('#podcast-search').fill('deep');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.locator('.result-grid').getByRole('button', { name: 'Subscribe' }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.result-grid .art__image').first()).toHaveAttribute(
    'src',
    /^statocyst-art:\/\/image\//,
    { timeout: 20_000 },
  );
  await page.locator('.result-grid').getByRole('button', { name: 'Subscribe' }).first().click();

  await expect(page.getByRole('heading', { name: 'E2E Deep Water' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.episode')).toHaveCount(2);
  await expect(page.getByText('First E2E Episode')).toBeVisible();

  const artwork = await page.evaluate(async () => {
    const api = (window as unknown as {
      statocyst: {
        podcast: {
          listFeeds: () => Promise<Array<{ id: string; artworkUrl: string | null }>>;
          listEpisodes: (feedId: string) => Promise<Array<{ artworkUrl: string | null }>>;
        };
      };
    }).statocyst;
    const feeds = await api.podcast.listFeeds();
    const episodes = await api.podcast.listEpisodes(feeds[0]!.id);
    return { feed: feeds[0]!.artworkUrl, episode: episodes[0]?.artworkUrl ?? null };
  });
  expect(artwork.feed).toBeTruthy();
  expect(artwork.episode).toBeTruthy();

  await page.locator('.episode__play').first().click();
  await expect.poll(
    async () =>
      page.evaluate(async () => {
        const api = (window as unknown as {
          statocyst: { playback: { getSnapshot: (context: string) => Promise<{ state: string; positionMs: number; track: { title: string } | null; active: boolean }> } };
        }).statocyst;
        return api.playback.getSnapshot('podcast');
      }),
    { timeout: 20_000 },
  ).toMatchObject({ active: true, track: { title: 'First E2E Episode' } });

  await page.waitForTimeout(1500);
  const snapshot = await page.evaluate(async () => {
    const api = (window as unknown as {
      statocyst: { playback: { getSnapshot: (context: string) => Promise<{ positionMs: number; state: string; track: { artworkUrl: string | null } | null }> } };
    }).statocyst;
    return api.playback.getSnapshot('podcast');
  });
  expect(snapshot.positionMs).toBeGreaterThan(0);
  expect(snapshot.track?.artworkUrl).toBeTruthy();
  await expect(page.locator('.player__track .art__image')).toBeVisible();

  await page.locator('.episode').first().getByRole('button', { name: 'Mark played' }).click();
  await expect(page.locator('.episode').first().getByRole('button', { name: 'Mark unplayed' })).toBeVisible();

  await page.locator('.episode').first().getByRole('button', { name: 'Download episode' }).click();
  await expect(
    page.locator('.episode').first().getByRole('button', { name: 'Remove download' }),
    { timeout: 20_000 },
  ).toBeVisible();

  const entryId = await page.evaluate(async () => {
    const api = (window as unknown as {
      statocyst: { playback: { getSnapshot: (context: string) => Promise<{ currentEntryId: string | null }> } };
    }).statocyst;
    return (await api.playback.getSnapshot('podcast')).currentEntryId;
  });
  expect(entryId).toBeTruthy();
  await page.evaluate(async (entry) => {
    const api = (window as unknown as {
      statocyst: { playback: { command: (command: unknown, context: string) => Promise<unknown> } };
    }).statocyst;
    await api.playback.command({ type: 'pause' }, 'podcast');
    await api.playback.command({ type: 'playEntry', entryId: entry }, 'podcast');
  }, entryId);

  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  serverClosed = true;
  await page.waitForTimeout(1500);
  const offline = await page.evaluate(async () => {
    const api = (window as unknown as {
      statocyst: { playback: { getSnapshot: (context: string) => Promise<{ positionMs: number; state: string }> } };
    }).statocyst;
    return api.playback.getSnapshot('podcast');
  });
  expect(offline.positionMs).toBeGreaterThan(0);

  await page.locator('.nav__item').filter({ hasText: 'Library' }).click();
  await expect(page.locator('.player__podcast-tag')).toBeVisible();
  await expect(page.locator('.player__title')).toContainText('First E2E Episode');
  await page.locator('.nav__item').filter({ hasText: 'Podcasts' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Deep Water' })).toBeVisible();
  await expect(page.locator('.player__podcast-tag')).toBeVisible();

  await page.getByRole('button', { name: 'Show settings' }).click();
  await page.getByLabel('Default speed').selectOption('1.5');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const api = (window as unknown as {
          statocyst: { podcast: { listFeeds: () => Promise<Array<{ defaultSpeed: number }>> } };
        }).statocyst;
        return (await api.podcast.listFeeds())[0]?.defaultSpeed;
      }),
    )
    .toBe(1.5);

  await page.screenshot({ path: join(root, 'evidence/screenshots/s045-podcasts.png'), fullPage: false });

  await page.waitForTimeout(800);
  await page.locator('.nav__item').filter({ hasText: 'Podcasts' }).click();
  await page.locator('.back').click();
  await page.getByRole('tab', { name: /Downloaded/ }).click();
  await expect(
    page.locator('.episode').filter({ hasText: 'Second E2E Episode' }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /Subscribed/ }).click();
  await expect(page.locator('.feed-card__title').first()).toContainText('E2E Deep Water');
  await page.locator('.feed-card__main').first().click();
  const unsubscribe = page.locator('.show__actions button.danger');
  await expect(unsubscribe).toBeVisible();
  await unsubscribe.click();
  await expect(unsubscribe).toContainText('Confirm unsubscribe');
  await unsubscribe.click();
  await expect(page.getByText('No subscriptions yet')).toBeVisible({ timeout: 15_000 });
});
