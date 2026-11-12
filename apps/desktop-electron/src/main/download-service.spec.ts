import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import type { ClientIdentity } from '@statocyst/jellyfin-client';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DownloadService } from './download-service';

const execFileAsync = promisify(execFile);

const identity: ClientIdentity = {
  client: 'Statocyst',
  device: 'Test',
  deviceId: 'device-1',
  version: '0.1.0',
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'statocyst-download-'));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeService() {
  const dir = await tempDir();
  const sourcePath = join(dir, 'source.mp3');
  await writeFile(sourcePath, Buffer.from('fake-mp3-bytes-for-download'));
  const db = await StatocystDatabase.open({ path: join(dir, 'statocyst.db') });
  const source = await db.upsertSource({ kind: 'local', label: 'Local', rootPath: dir });
  await db.upsertTrack({
    sourceId: source.id,
    path: sourcePath,
    pathKey: sourcePath,
    fileName: 'source.mp3',
    ext: 'mp3',
    sizeBytes: 24,
    mtimeMs: 1,
    title: 'Source',
    artist: 'Artist',
    album: 'Album',
    durationMs: 1000,
  });
  const track = await db.findTrackByPathKey(sourcePath);
  const service = new DownloadService({
    database: db,
    downloadsDirectory: join(dir, 'downloads'),
    logger,
    identity,
    resolveRemoteTrack: async () => null,
  });
  return { service, db, track };
}

describe('DownloadService podcast enclosures', () => {
  it('downloads a direct enclosure URL into a verified pin', async () => {
    const payload = Buffer.from('podcast-enclosure-bytes');
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(payload.byteLength),
      });
      response.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const url = `http://127.0.0.1:${address.port}/episode.mp3`;
    const dir = await tempDir();
    const db = await StatocystDatabase.open({ path: join(dir, 'statocyst.db') });
    const feed = await db.upsertPodcastFeed({
      feedUrl: 'https://feeds.example.com/show.xml',
      title: 'Show',
      feedType: 'rss',
    });
    const [saved] = await db.savePodcastEpisodes(feed.id, [
      {
        feedId: feed.id,
        guid: 'episode-1',
        title: 'Episode',
        enclosureUrl: url,
        enclosureType: 'audio/mpeg',
        enclosureLengthBytes: payload.byteLength,
      },
    ]);
    const service = new DownloadService({
      database: db,
      downloadsDirectory: join(dir, 'downloads'),
      logger,
      identity,
      resolveRemoteTrack: async () => null,
      resolveDirectMedia: async (track) =>
        track.sourceKind === 'podcast' ? { url: track.path } : null,
    });
    try {
      const result = await service.download(saved.mediaItemId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.verified).toBe(true);
      const record = await db.getDownload(saved.mediaItemId);
      expect(record?.verified).toBe(true);
      expect(await readFile(record!.localPath)).toEqual(payload);
      expect((await service.getVerifiedDownload(saved.mediaItemId))?.localPath).toBe(
        record!.localPath,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    }
  });
});

describe('DownloadService podcast compression', () => {
  it('extracts audio from a video enclosure when ffmpeg is available', async () => {
    const ffmpeg = await execFileAsync('ffmpeg', ['-version']).then(() => true).catch(() => false);
    if (!ffmpeg) return;
    const dir = await tempDir();
    const sourcePath = join(dir, 'episode.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=15',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      sourcePath,
    ]);
    const payload = await readFile(sourcePath);
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(payload.byteLength),
      });
      response.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const url = `http://127.0.0.1:${address.port}/episode.mp4`;
    const db = await StatocystDatabase.open({ path: join(dir, 'statocyst.db') });
    const feed = await db.upsertPodcastFeed({
      feedUrl: 'https://feeds.example.com/video.xml',
      title: 'Video Show',
      feedType: 'rss',
    });
    const [saved, savedTwo] = await db.savePodcastEpisodes(feed.id, [
      {
        feedId: feed.id,
        guid: 'video-1',
        title: 'Video episode',
        enclosureUrl: url,
        enclosureType: 'video/mp4',
        mediaForm: 'video',
        durationMs: 1000,
      },
      {
        feedId: feed.id,
        guid: 'video-2',
        title: 'Video episode 2',
        enclosureUrl: url,
        enclosureType: 'video/mp4',
        mediaForm: 'video',
        durationMs: 1000,
      },
    ]);
    const service = new DownloadService({
      database: db,
      downloadsDirectory: join(dir, 'downloads'),
      logger,
      identity,
      resolveRemoteTrack: async () => null,
      resolveDirectMedia: async (track) =>
        track.sourceKind === 'podcast' ? { url: track.path } : null,
    });
    try {
      const result = await service.download(saved.mediaItemId, undefined, 'audio-only');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.verified).toBe(true);
      const record = await db.getDownload(saved.mediaItemId);
      expect(record?.container).toBe('audio/mp4');
      expect(record?.localPath.endsWith('.m4a')).toBe(true);
      expect((await readFile(record!.localPath)).byteLength).toBeGreaterThan(0);

      const compressed = await service.download(savedTwo.mediaItemId, undefined, 'video-480p');
      expect(compressed.ok).toBe(true);
      if (!compressed.ok) return;
      const videoRecord = await db.getDownload(savedTwo.mediaItemId);
      expect(videoRecord?.container).toBe('video/mp4');
      expect(videoRecord?.localPath.endsWith('.mp4')).toBe(true);
      expect((await readFile(videoRecord!.localPath)).byteLength).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    }
  });
});

describe('DownloadService', () => {
  it('downloads a local track and records a verified manifest', async () => {
    const { service, db, track } = await makeService();
    const result = await service.download(track!.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(true);
    expect(result.value.sizeBytes).toBeGreaterThan(0);
    expect(result.value.sha256).toMatch(/^[0-9a-f]{64}$/);

    const record = await db.getDownload(track!.id);
    expect(record).not.toBeNull();
    expect(record!.verified).toBe(true);
    expect(record!.sha256).toBe(result.value.sha256);
  });

  it('returns the download as verified only while the file exists and matches size', async () => {
    const { service, db, track } = await makeService();
    await service.download(track!.id);

    const verified = await service.getVerifiedDownload(track!.id);
    expect(verified).not.toBeNull();

    // Delete the file on disk: the download must no longer be reported usable.
    const record = await db.getDownload(track!.id);
    await rm(record!.localPath, { force: true });
    expect(await service.getVerifiedDownload(track!.id)).toBeNull();
  });

  it('removes the file and record on remove()', async () => {
    const { service, db, track } = await makeService();
    await service.download(track!.id);
    const result = await service.remove(track!.id);
    expect(result.ok).toBe(true);
    expect(await db.getDownload(track!.id)).toBeNull();
  });
});
