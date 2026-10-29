import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildAudioStreamUrl, type ClientIdentity } from '@statocyst/jellyfin-client';
import type { CacheStats } from '@statocyst/contracts';
import type { StatocystDatabase } from '@statocyst/persistence';
import type { Logger } from './logger';

export interface CacheManagerOptions {
  database: StatocystDatabase;
  cacheDirectory: string;
  logger: Logger;
  identity: ClientIdentity;
  getBudgetBytes: () => number;
  resolveRemoteTrack: (sourceId: string) => Promise<{ serverUrl: string; token: string } | null>;
}

function remoteAuthorization(identity: ClientIdentity, token: string): string {
  return (
    `MediaBrowser Client="${identity.client}", Device="${identity.device}", ` +
    `DeviceId="${identity.deviceId}", Version="${identity.version}", Token="${token}"`
  );
}

/**
 * Rolling evictable cache (ADR-004). Protects a byte budget, evicts least-
 * recently-used entries, reconciles stale/orphan files, and reacts to storage
 * pressure. Protected downloads live in a separate directory and are never
 * touched by this class.
 */
export class CacheManager {
  private pressureBudgetBytes: number | null = null;

  constructor(private readonly options: CacheManagerOptions) {}

  private get database(): StatocystDatabase {
    return this.options.database;
  }

  /** Effective budget, reduced under storage pressure until the app restarts. */
  budgetBytes(): number {
    return Math.min(this.pressureBudgetBytes ?? Infinity, this.options.getBudgetBytes());
  }

  async totalBytes(): Promise<number> {
    const entries = await this.database.listCacheEntries();
    return entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  }

  async stats(): Promise<CacheStats> {
    const entries = await this.database.listCacheEntries();
    return {
      bytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      budgetBytes: this.budgetBytes(),
      entries: entries.length,
      pressure: this.pressureBudgetBytes !== null,
    };
  }

  /** Records a cache file and enforces the budget (LRU eviction). */
  async record(trackId: string, localPath: string, sizeBytes: number): Promise<void> {
    await this.database.saveCacheEntry({ trackId, localPath, sizeBytes });
    await this.evictToFit();
  }

  async touch(trackId: string): Promise<void> {
    await this.database.touchCacheEntry(trackId);
  }

  /** Evicts least-recently-used entries until total size fits the budget. */
  async evictToFit(): Promise<number> {
    const budget = this.budgetBytes();
    const entries = await this.database.listCacheEntries(); // ASC by last_access_at
    let total = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    let evicted = 0;
    for (const entry of entries) {
      if (total <= budget) break;
      await rm(entry.localPath, { force: true }).catch(() => undefined);
      await this.database.removeCacheEntry(entry.trackId);
      total -= entry.sizeBytes;
      evicted += 1;
    }
    if (evicted > 0) this.options.logger.info('cache.evicted', { evicted, budget });
    return evicted;
  }

  /**
   * Reconciles the manifest against disk: drops entries whose file is gone and
   * deletes orphan files not tracked by any entry. Returns counts.
   */
  async reconcile(): Promise<{ removedEntries: number; removedOrphans: number }> {
    await mkdir(this.options.cacheDirectory, { recursive: true });
    const entries = await this.database.listCacheEntries();
    const trackedPaths = new Set(entries.map((entry) => entry.localPath));

    let removedEntries = 0;
    for (const entry of entries) {
      try {
        const info = await stat(entry.localPath);
        if (!info.isFile()) {
          await this.database.removeCacheEntry(entry.trackId);
          removedEntries += 1;
        }
      } catch {
        await this.database.removeCacheEntry(entry.trackId);
        removedEntries += 1;
      }
    }

    let removedOrphans = 0;
    const files = await readdir(this.options.cacheDirectory).catch(() => [] as string[]);
    for (const file of files) {
      const full = join(this.options.cacheDirectory, file);
      if (trackedPaths.has(full)) continue;
      await rm(full, { force: true }).catch(() => undefined);
      removedOrphans += 1;
    }

    if (removedEntries || removedOrphans) {
      this.options.logger.info('cache.reconciled', { removedEntries, removedOrphans });
    }
    return { removedEntries, removedOrphans };
  }

  async clear(): Promise<number> {
    const entries = await this.database.listCacheEntries();
    for (const entry of entries) {
      await rm(entry.localPath, { force: true }).catch(() => undefined);
      await this.database.removeCacheEntry(entry.trackId);
    }
    this.options.logger.info('cache.cleared', { removed: entries.length });
    return entries.length;
  }

  /** Halves the effective budget in response to an out-of-space signal. */
  handleStoragePressure(): number {
    const current = this.budgetBytes();
    this.pressureBudgetBytes = Math.max(64 * 1024 * 1024, Math.floor(current / 2));
    this.options.logger.warn('cache.storage-pressure', { newBudget: this.pressureBudgetBytes });
    return this.pressureBudgetBytes;
  }

  /**
   * Prefetches a remote Jellyfin track into the cache (bounded lookahead),
   * respecting the budget. Returns the cached path or null.
   */
  async prefetch(trackId: string): Promise<string | null> {
    const track = await this.database.getTrack(trackId).catch(() => null);
    if (!track || track.sourceKind !== 'jellyfin') return null;
    const remote = await this.options.resolveRemoteTrack(track.sourceId);
    if (!remote) return null;

    await mkdir(this.options.cacheDirectory, { recursive: true });
    const ext = (track.ext || track.format || 'bin').toLowerCase();
    const finalPath = join(this.options.cacheDirectory, `${trackId}.${ext}`);
    const tmpPath = `${finalPath}.part`;

    try {
      const url = buildAudioStreamUrl({
        baseUrl: remote.serverUrl,
        itemId: track.path,
        mode: 'direct',
      });
      const response = await fetch(url, {
        headers: { Authorization: remoteAuthorization(this.options.identity, remote.token) },
        redirect: 'manual',
      });
      if (!response.ok || !response.body) return null;
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(tmpPath),
      );
      const info = await stat(tmpPath);
      await rename(tmpPath, finalPath);
      await this.record(trackId, finalPath, info.size);
      return finalPath;
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      this.options.logger.warn('cache.prefetch.failed', { trackId, error: String(error) });
      return null;
    }
  }

  /** Returns a cached path when it still exists on disk at the recorded size. */
  async getCached(trackId: string): Promise<string | null> {
    const entries = await this.database.listCacheEntries();
    const entry = entries.find((candidate) => candidate.trackId === trackId);
    if (!entry) return null;
    try {
      const info = await stat(entry.localPath);
      if (!info.isFile() || info.size !== entry.sizeBytes) return null;
      await this.database.touchCacheEntry(trackId);
      return entry.localPath;
    } catch {
      return null;
    }
  }
}
