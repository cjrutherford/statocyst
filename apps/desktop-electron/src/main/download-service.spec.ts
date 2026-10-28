import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import type { ClientIdentity } from '@statocyst/jellyfin-client';
import { DownloadService } from './download-service';

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
