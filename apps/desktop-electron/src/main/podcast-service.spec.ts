import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StatocystDatabase } from '@statocyst/persistence';
import { Logger } from './logger';
import { FeedFetcher, PodcastFetchError } from './podcast-fetcher';
import { PodcastIndexClient } from './podcast-index-client';
import { PodcastService } from './podcast-service';
import type { TokenCodec } from './credential-store';

const rssTemplate = readFileSync(
  new URL('../../../../libs/podcast-core/fixtures/rss-basic.xml', import.meta.url),
  'utf8',
);
const atomFeed = readFileSync(
  new URL('../../../../libs/podcast-core/fixtures/atom-basic.xml', import.meta.url),
  'utf8',
);

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FakeCodec implements TokenCodec {
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async encrypt(plaintext: string): Promise<string> {
    return `enc:${plaintext}`;
  }
  async decrypt(ciphertext: string): Promise<string> {
    return ciphertext.replace(/^enc:/, '');
  }
}

interface FixtureServer {
  url: (path: string) => string;
  feedRequests: number;
  indexAuth: string[];
  imageRequests: number;
  appleRequests: number;
  fyydRequests: number;
  topRequests: number;
  lookupRequests: number;
  feedVersion: number;
}

async function startFixtureServer(): Promise<FixtureServer> {
  let feedVersion = 1;
  let feedRequests = 0;
  let imageRequests = 0;
  let appleRequests = 0;
  let fyydRequests = 0;
  let topRequests = 0;
  let lookupRequests = 0;
  const indexAuth: string[] = [];
  let base = '';
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', base);
    void handle(url, request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
  base = `http://127.0.0.1:${address.port}`;
  servers.push(server);

  async function handle(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (url.pathname === '/site') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
      );
      return;
    }
    if (url.pathname === '/feed.xml') {
      feedRequests += 1;
      if (request.headers['if-none-match'] === `"v${feedVersion}"`) {
        response.writeHead(304, { ETag: `"v${feedVersion}"` });
        response.end();
        return;
      }
      const extra =
        feedVersion > 1
          ? `<item><title>Episode Three</title><guid>ep-3</guid>` +
            `<pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate>` +
            `<enclosure url="${base}/media/3.mp3" type="audio/mpeg" /></item>`
          : '';
      const xml = rssTemplate
        .replace('https://example.com/deep-water.jpg', `${base}/image.jpg`)
        .replace('https://example.com/ep1.jpg', `${base}/image.jpg`)
        .replace('</channel>', `${extra}</channel>`);
      response.writeHead(200, {
        'Content-Type': 'application/rss+xml',
        ETag: `"v${feedVersion}"`,
      });
      response.end(xml);
      return;
    }
    if (url.pathname === '/no-art.xml') {
      response.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      response.end(rssTemplate.replace(/<itunes:image[^>]*\/>/, ''));
      return;
    }
    if (url.pathname === '/atom.xml') {
      response.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      response.end(atomFeed);
      return;
    }
    if (url.pathname === '/redirect') {
      response.writeHead(302, { Location: '/feed.xml' });
      response.end();
      return;
    }
    if (url.pathname === '/image.jpg') {
      imageRequests += 1;
      response.writeHead(200, { 'Content-Type': 'image/jpeg' });
      response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    if (url.pathname === '/large') {
      response.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      response.end(`<rss>${'x'.repeat(100_000)}</rss>`);
      return;
    }
    if (url.pathname === '/not-a-feed') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><body>No feed here</body></html>');
      return;
    }
    if (url.pathname === '/apple/search') {
      appleRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        resultCount: 1,
        results: [{
          wrapperType: 'track', kind: 'podcast', collectionId: 42, trackId: 42,
          artistName: 'Index Author', collectionName: 'Index Deep',
          feedUrl: `${base}/feed.xml`, artworkUrl100: `${base}/image.jpg`,
          trackCount: 3, collectionExplicitness: 'notExplicit', primaryGenreName: 'Science',
        }],
      }));
      return;
    }
    if (url.pathname === '/apple/top.json') {
      topRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        feed: {
          results: [
            { id: '42', name: 'Index Deep', artistName: 'Index Author', artworkUrl100: `${base}/image.jpg`, genres: [{ genreId: '1533', name: 'Science' }] },
            { id: '43', name: 'Fyyd Only', artistName: 'Fyyd Author', artworkUrl100: `${base}/image.jpg`, genres: [{ genreId: '1533', name: 'Science' }, { genreId: '1489', name: 'News' }] },
            { id: '44', name: 'Unresolved Show', artistName: 'Ghost', genres: [{ genreId: '1533', name: 'Science' }] },
          ],
        },
      }));
      return;
    }
    if (url.pathname === '/apple/lookup') {
      lookupRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        resultCount: 2,
        results: [
          { wrapperType: 'track', kind: 'podcast', collectionId: 42, trackId: 42, artistName: 'Index Author', collectionName: 'Index Deep', feedUrl: `${base}/feed.xml`, artworkUrl600: `${base}/image.jpg`, trackCount: 3, collectionExplicitness: 'notExplicit', primaryGenreName: 'Science' },
          { wrapperType: 'track', kind: 'podcast', collectionId: 43, trackId: 43, artistName: 'Fyyd Author', collectionName: 'Fyyd Only', feedUrl: `${base}/atom.xml`, artworkUrl600: `${base}/image.jpg`, trackCount: 2, collectionExplicitness: 'notExplicit', primaryGenreName: 'News' },
        ],
      }));
      return;
    }
    if (url.pathname === '/fyyd/search') {
      fyydRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        status: 1, msg: 'ok',
        data: [
          { id: 7, title: 'Fyyd Only', xmlURL: `${base}/atom.xml`, author: 'Fyyd Author', description: 'Fyyd result', imgURL: `${base}/image.jpg`, episodeCount: 2 },
          { id: 8, title: 'Index Deep', xmlURL: `${base}/feed.xml`, author: 'Index Author', description: 'Enriched by Fyyd', imgURL: `${base}/image.jpg` },
        ],
      }));
      return;
    }
    if (url.pathname === '/podcastindex/search/byterm') {
      indexAuth.push(String(request.headers['authorization'] ?? ''));
      if (request.headers['x-auth-key'] !== 'key-1') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'false', description: 'bad key' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'true',
          feeds: [
            {
              id: 42,
              title: 'Index Deep',
              url: `${base}/feed.xml`,
              author: 'Index Author',
              description: 'From the directory',
              artwork: `${base}/image.jpg`,
              episodeCount: 3,
              explicit: false,
              categories: { 1: 'Science', 2: 'Nature' },
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  }

  return {
    url: (path) => `${base}${path}`,
    get feedRequests() {
      return feedRequests;
    },
    set feedVersion(value: number) {
      feedVersion = value;
    },
    get imageRequests() {
      return imageRequests;
    },
    get appleRequests() {
      return appleRequests;
    },
    get fyydRequests() {
      return fyydRequests;
    },
    get topRequests() {
      return topRequests;
    },
    get lookupRequests() {
      return lookupRequests;
    },
    indexAuth,
  } as FixtureServer & { feedVersion: number };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'statocyst-podcast-service-'));
  directories.push(directory);
  const db = await StatocystDatabase.open({ path: join(directory, 'statocyst.db') });
  const logger = new Logger(join(directory, 'statocyst.log'));
  await logger.init();
  const server = (await startFixtureServer()) as FixtureServer & { feedVersion: number };
  const fetcher = new FeedFetcher({
    allowLocalNetwork: () => true,
    userAgent: 'Statocyst-Test/1.0',
    timeoutMs: 5_000,
  });
  const service = new PodcastService({
    database: db,
    fetcher,
    logger,
    artworkDirectory: join(directory, 'artwork'),
    codec: new FakeCodec(),
    directory: new PodcastIndexClient({
      userAgent: 'Statocyst-Test/1.0',
      baseUrl: server.url('/podcastindex'),
    }),
    appleSearchBaseUrl: server.url('/apple/search'),
    fyydSearchBaseUrl: server.url('/fyyd/search'),
    appleTopUrl: server.url('/apple/top.json'),
    appleLookupBaseUrl: server.url('/apple/lookup'),
    allowLocalNetwork: () => true,
    refreshOnLaunch: () => false,
    userAgent: 'Statocyst-Test/1.0',
    now: () => new Date('2026-11-08T12:00:00.000Z'),
  });
  return { directory, db, logger, server, service };
}

describe('desktop podcast ingestion', () => {
  it('discovers a feed from a page, persists it and caches artwork', async () => {
    const { db, server, service } = await setup();
    const result = await service.addFeed(server.url('/site'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.title).toBe('Deep Water Radio');
    expect(result.value.feedUrl).toBe(server.url('/site'));
    expect(result.value.artworkUrl).toMatch(/^statocyst-art:\/\/feed\//);

    const feeds = await service.listFeeds();
    expect(feeds).toHaveLength(1);
    expect(feeds[0].unplayedCount).toBe(2);
    expect(feeds[0].newEpisodeCount).toBe(2);
    const episodes = await service.listEpisodes(feeds[0].id);
    expect(episodes.map((episode) => episode.title)).toEqual([
      'Episode Two',
      'Episode One',
    ]);
    expect(episodes[0].mediaKind).toBe('podcast');
    expect(episodes[0].artworkUrl).toMatch(/^statocyst-art:\/\/track\//);

    const artworkPath = server.imageRequests > 0;
    expect(artworkPath).toBe(true);
    const feed = await db.getPodcastFeed(feeds[0].id);
    expect(feed?.artworkPath).toBeTruthy();
    expect((await stat(feed!.artworkPath!)).isFile()).toBe(true);
    await db.close();
  });

  it('uses conditional GET, then discovers new episodes on the next refresh', async () => {
    const { db, server, service } = await setup();
    const added = await service.addFeed(server.url('/feed.xml'));
    if (!added.ok) throw new Error(added.error.message);
    const firstCount = server.feedRequests;
    const unchanged = await service.refresh(added.value.id);
    expect(unchanged.errors, JSON.stringify(unchanged)).toEqual([]);
    expect(unchanged.refreshed).toBe(1);
    expect(unchanged.newEpisodes).toBe(0);
    expect(server.feedRequests).toBe(firstCount + 1);

    server.feedVersion = 2;
    const updated = await service.refresh(added.value.id);
    expect(updated.refreshed).toBe(1);
    expect(updated.newEpisodes).toBe(1);
    expect((await service.listEpisodes(added.value.id)).length).toBe(3);
    const feed = await db.getPodcastFeed(added.value.id);
    expect(feed?.failureCount).toBe(0);
    expect(feed?.fetchError).toBeNull();
    await db.close();
  });

  it('updates per-feed settings and played state', async () => {
    const { db, service, server } = await setup();
    const added = await service.addFeed(server.url('/feed.xml'));
    if (!added.ok) throw new Error(added.error.message);
    const updated = await service.updateFeed(added.value.id, {
      refreshIntervalMinutes: 30,
      defaultSpeed: 1.25,
      skipIntroSeconds: 15,
      skipOutroSeconds: 30,
      autoQueue: false,
      episodeSort: 'oldest',
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.refreshIntervalMinutes).toBe(30);
      expect(updated.value.defaultSpeed).toBe(1.25);
      expect(updated.value.episodeSort).toBe('oldest');
    }
    const invalid = await service.updateFeed(added.value.id, { defaultSpeed: 4 });
    expect(invalid.ok).toBe(false);

    const [episode] = await service.listEpisodes(added.value.id);
    const played = await service.setPlayed(episode.episodeId, true);
    expect(played.ok).toBe(true);
    const stored = await service.getEpisode(episode.episodeId);
    expect(stored?.played).toBe(true);
    expect(stored?.completed).toBe(true);
    await db.close();
  });

  it('imports and exports OPML without fetching twice', async () => {
    const { db, service, server } = await setup();
    const opml = `<opml version="2.0"><head><title>Subscriptions</title></head><body>
      <outline text="Deep" type="rss" xmlUrl="${server.url('/feed.xml')}" />
      <outline text="Atom" type="rss" xmlUrl="${server.url('/atom.xml')}" />
    </body></opml>`;
    const imported = await service.importOpmlText(opml, { refresh: false });
    expect(imported.added).toBe(2);
    expect(imported.feeds).toHaveLength(2);
    const exported = await service.exportOpmlText();
    expect(exported).toContain('/feed.xml');
    expect(exported).toContain('/atom.xml');
    expect(exported).toContain('<opml');
    await db.close();
  });

  it('searches Apple and Fyyd, dedupes feeds and caches results', async () => {
    const { db, service, server } = await setup();
    const first = await service.searchDirectory('deep');
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value).toHaveLength(2);
      expect(first.value.map((entry) => entry.title)).toEqual(['Index Deep', 'Fyyd Only']);
      expect(first.value[0].source).toBe('apple');
      expect(first.value[0].descriptionText).toBe('Enriched by Fyyd');
      expect(first.value[1].source).toBe('fyyd');
    }
    const appleRequests = server.appleRequests;
    const fyydRequests = server.fyydRequests;
    const second = await service.searchDirectory('deep');
    expect(second.ok).toBe(true);
    expect(server.appleRequests).toBe(appleRequests);
    expect(server.fyydRequests).toBe(fyydRequests);
    expect((await service.directoryStatus()).providers).toEqual(['apple', 'fyyd']);
    await db.close();
  });

  it('builds a top-chart discovery landing and caches it', async () => {
    const { db, service, server } = await setup();
    const first = await service.discoverDirectory();
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.top).toHaveLength(2);
      expect(first.value.top[0].title).toBe('Index Deep');
      expect(first.value.top[0].source).toBe('apple');
      expect(first.value.categories[0]).toMatchObject({ name: 'Science', count: 3 });
      expect(first.value.shelves.map((shelf) => shelf.category.name)).toContain('Science');
      expect(first.value.shelves[0].shows.length).toBeGreaterThanOrEqual(2);
    }
    expect(server.lookupRequests).toBe(1);
    const topRequests = server.topRequests;
    await service.discoverDirectory();
    expect(server.topRequests).toBe(topRequests);
    await db.close();
  });

  it('uses directory artwork when the feed carries no image', async () => {
    const { db, server, service } = await setup();
    const result = await service.addFeed(server.url('/no-art.xml'), {
      artworkUrl: server.url('/image.jpg'),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artworkUrl).toMatch(/^statocyst-art:\/\/feed\//);
    }
    await db.close();
  });

  it('caches directory artwork for renderer-safe display', async () => {
    const { db, service, server } = await setup();
    const result = await service.cacheDirectoryArtwork(server.url('/image.jpg'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toMatch(/^statocyst-art:\/\/image\/podcast-[a-f0-9]{32}\.jpg$/);
    }
    await db.close();
  });

  it('removes a feed and its episodes', async () => {
    const { db, service, server } = await setup();
    const added = await service.addFeed(server.url('/feed.xml'));
    if (!added.ok) throw new Error(added.error.message);
    const removed = await service.removeFeed(added.value.id, { deleteDownloads: true });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.removed).toBe(true);
    expect(await service.listFeeds()).toHaveLength(0);
    expect(await db.podcastEpisodeCount()).toBe(0);
    await db.close();
  });
});

describe('feed fetcher policy', () => {
  it('blocks private addresses unless local networking is enabled', async () => {
    const server = await startFixtureServer();
    const blocked = new FeedFetcher({
      allowLocalNetwork: () => false,
      userAgent: 'Statocyst-Test/1.0',
    });
    await expect(blocked.fetchText(server.url('/feed.xml'))).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    const allowed = new FeedFetcher({
      allowLocalNetwork: () => true,
      userAgent: 'Statocyst-Test/1.0',
    });
    const fetched = await allowed.fetchText(server.url('/feed.xml'));
    expect(fetched.status).toBe(200);
    expect(fetched.body).toContain('Deep Water Radio');
  });

  it('follows redirects, enforces the body cap and rejects HTML without discovery', async () => {
    const server = await startFixtureServer();
    const fetcher = new FeedFetcher({
      allowLocalNetwork: () => true,
      userAgent: 'Statocyst-Test/1.0',
    });
    const redirected = await fetcher.fetchText(server.url('/redirect'));
    expect(redirected.finalUrl).toBe(server.url('/feed.xml'));
    await expect(
      fetcher.fetchText(server.url('/large'), { maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(PodcastFetchError);
    await expect(
      fetcher.fetchText(server.url('/not-a-feed')),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
  });
});
