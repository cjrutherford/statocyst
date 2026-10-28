import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import type { ClientIdentity } from '@statocyst/jellyfin-client';
import { CacheManager } from './cache-manager';

const identity: ClientIdentity = {
  client: 'Statocyst',
  device: 'Test',
  deviceId: 'device-1',
  version: '0.1.0',
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'statocyst-cache-'));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeManager(budget: number) {
  const dir = await tempDir();
  const db = await StatocystDatabase.open({ path: join(dir, 'statocyst.db') });
  const source = await db.upsertSource({ kind: 'local', label: 'Local', rootPath: dir });
  const trackIds: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const path = join(dir, `t${i}.mp3`);
    await writeFile(path, `track-${i}`);
    await db.upsertTrack({
      sourceId: source.id,
      path,
      pathKey: path,
      fileName: `t${i}.mp3`,
      ext: 'mp3',
      sizeBytes: 10,
      mtimeMs: 1,
      title: `T${i}`,
      artist: 'A',
      album: 'B',
      durationMs: 1000,
    });
    trackIds.push((await db.findTrackByPathKey(path))!.id);
  }
  const cacheDir = join(dir, 'cache');
  const manager = new CacheManager({
    database: db,
    cacheDirectory: cacheDir,
    logger,
    identity,
    getBudgetBytes: () => budget,
    resolveRemoteTrack: async () => null,
  });
  return { manager, db, cacheDir, trackIds };
}

async function writeCacheFile(dir: string, name: string, bytes: number): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, Buffer.alloc(bytes, 1));
  return path;
}

describe('CacheManager', () => {
  it('evicts least-recently-used entries when the budget is exceeded', async () => {
    const { manager, cacheDir, trackIds } = await makeManager(30);
    // 10 + 10 + 10 + 10 = 40 bytes of cache, budget 30 → evict the two oldest.
    for (let i = 0; i < 4; i += 1) {
      const path = await writeCacheFile(cacheDir, `c${i}.bin`, 10);
      await manager.record(trackIds[i], path, 10);
    }
    const total = await manager.totalBytes();
    expect(total).toBeLessThanOrEqual(30);
    expect(total).toBe(30);
    // The oldest entry is the one evicted.
    expect(await manager.getCached(trackIds[0])).toBeNull();
    expect(await manager.getCached(trackIds[3])).not.toBeNull();
  });

  it('reconcile removes orphan files not tracked in the manifest', async () => {
    const { manager, cacheDir } = await makeManager(100);
    await writeCacheFile(cacheDir, 'orphan.bin', 5);
    const result = await manager.reconcile();
    expect(result.removedOrphans).toBe(1);
  });

  it('reconcile removes entries whose file disappeared', async () => {
    const { manager, cacheDir, trackIds } = await makeManager(100);
    const path = await writeCacheFile(cacheDir, 'real.bin', 5);
    await manager.record(trackIds[0], path, 5);
    await rm(path, { force: true });
    const result = await manager.reconcile();
    expect(result.removedEntries).toBe(1);
    expect(await manager.totalBytes()).toBe(0);
  });

  it('handleStoragePressure halves the effective budget', async () => {
    const { manager } = await makeManager(200 * 1024 * 1024);
    expect(manager.budgetBytes()).toBe(200 * 1024 * 1024);
    const reduced = manager.handleStoragePressure();
    expect(reduced).toBe(100 * 1024 * 1024);
    expect(manager.budgetBytes()).toBe(100 * 1024 * 1024);
  });

  it('clear empties the cache manifest and files', async () => {
    const { manager, cacheDir, trackIds } = await makeManager(100);
    const path = await writeCacheFile(cacheDir, 'c.bin', 5);
    await manager.record(trackIds[0], path, 5);
    await manager.clear();
    expect(await manager.totalBytes()).toBe(0);
  });
});
