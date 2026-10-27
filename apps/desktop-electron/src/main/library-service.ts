import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImportRejection, ImportSummary, LibraryStats, Track } from '@statocyst/contracts';
import type { StatocystDatabase, StoredTrack } from '@statocyst/persistence';
import { pathIsInside, scanPaths, type ScanResult } from '@statocyst/media-library';
import type { Logger } from './logger';

export interface LibraryServiceOptions {
  database: StatocystDatabase;
  artworkDirectory: string;
  logger: Logger;
  onChanged?: (reason: string) => void;
}

async function commonRoot(paths: readonly string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const resolved: string[] = [];
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    resolved.push(info?.isDirectory() ? resolve(path) : dirname(resolve(path)));
  }
  if (resolved.length === 1) return resolved[0];
  const [first, ...rest] = resolved;
  let candidate = first;
  for (const path of rest) {
    while (!pathIsInside(candidate, path) && candidate !== dirname(candidate)) {
      candidate = dirname(candidate);
    }
    if (!pathIsInside(candidate, path)) return null;
  }
  return candidate;
}

function labelForRoot(root: string | null, fallback: string): string {
  if (!root) return fallback;
  const name = basename(root).trim();
  return name.length > 0 ? name : fallback;
}

export class LibraryService {
  constructor(private readonly options: LibraryServiceOptions) {}

  private get database(): StatocystDatabase {
    return this.options.database;
  }

  async importPaths(
    inputPaths: readonly string[],
    kind: 'local' | 'demo' = 'local',
  ): Promise<ImportSummary> {
    const rejected: ImportRejection[] = [];
    const validPaths: string[] = [];
    if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
      return this.emptySummary(true, []);
    }
    for (const path of inputPaths.slice(0, 10_000)) {
      if (typeof path !== 'string' || !isAbsolute(path)) {
        rejected.push({
          path: String(path),
          code: 'INVALID_ARGUMENT',
          message: 'Only absolute filesystem paths can be imported',
        });
        continue;
      }
      validPaths.push(resolve(path));
    }
    if (validPaths.length === 0) {
      return this.emptySummary(false, rejected);
    }

    let scan: ScanResult;
    try {
      scan = await scanPaths(validPaths, { platform: process.platform });
    } catch (error) {
      this.options.logger.error('library.scan.failed', { error });
      return this.emptySummary(false, [
        ...rejected,
        { path: validPaths[0], code: 'IMPORT_FAILED', message: 'The import scan failed' },
      ]);
    }

    rejected.push(...scan.rejected.map((item) => ({ ...item })));
    const root = kind === 'demo' ? validPaths[0] : await commonRoot(validPaths);
    const source = await this.database.upsertSource({
      kind,
      label: kind === 'demo' ? 'Statocyst Demos' : labelForRoot(root, 'Local Files'),
      rootPath: root,
    });

    await mkdir(this.options.artworkDirectory, { recursive: true });
    const imported: Track[] = [];
    let duplicates = 0;
    let missing = 0;

    for (const scanned of scan.tracks) {
      try {
        const existing = await this.database.findTrackByPathKey(scanned.pathKey);
        const id = existing?.id ?? randomUUID();
        let artworkPath: string | null = existing?.artworkPath ?? null;

        if (scanned.artwork) {
          const nextArtwork = join(this.options.artworkDirectory, `${id}.${scanned.artwork.extension}`);
          await writeFile(nextArtwork, scanned.artwork.data);
          if (artworkPath && artworkPath !== nextArtwork) {
            await unlink(artworkPath).catch(() => undefined);
          }
          artworkPath = nextArtwork;
        } else if (artworkPath) {
          await unlink(artworkPath).catch(() => undefined);
          artworkPath = null;
        }

        const result = await this.database.upsertTrack({
          id,
          sourceId: source.id,
          path: scanned.path,
          pathKey: scanned.pathKey,
          fileName: scanned.fileName,
          ext: scanned.ext,
          sizeBytes: scanned.sizeBytes,
          mtimeMs: scanned.mtimeMs,
          title: scanned.title,
          artist: scanned.artist,
          album: scanned.album,
          albumArtist: scanned.albumArtist,
          trackNo: scanned.trackNo,
          discNo: scanned.discNo,
          year: scanned.year,
          genre: scanned.genre,
          durationMs: scanned.durationMs,
          bitrate: scanned.bitrate,
          sampleRate: scanned.sampleRate,
          channels: scanned.channels,
          codec: scanned.codec,
          format: scanned.format,
          artworkPath,
        });
        if (result.duplicate) duplicates += 1;
        if (result.track.missing) missing += 1;
        imported.push(result.track);
      } catch (error) {
        this.options.logger.error('library.track.import.failed', { path: scanned.path, error });
        rejected.push({
          path: scanned.path,
          code: 'IMPORT_FAILED',
          message: 'The track could not be written to the catalog',
        });
      }
    }

    this.options.logger.info('library.import.completed', {
      kind,
      sourceId: source.id,
      imported: imported.length,
      duplicates,
      rejected: rejected.length,
    });
    this.options.onChanged?.('import');

    return {
      sourceId: source.id,
      sourceLabel: source.label,
      imported: imported.length,
      duplicates,
      missing,
      rejected,
      tracks: imported,
      cancelled: false,
    };
  }

  async listTracks(): Promise<StoredTrack[]> {
    return this.database.listTracks();
  }

  async getTrack(id: string): Promise<StoredTrack | null> {
    try {
      return await this.database.getTrack(id);
    } catch {
      return null;
    }
  }

  async stats(): Promise<LibraryStats> {
    return this.database.stats();
  }

  async removeTrack(trackId: string): Promise<boolean> {
    const track = await this.getTrack(trackId);
    if (!track) return false;
    if (track.artworkPath) {
      await unlink(track.artworkPath).catch(() => undefined);
    }
    const removed = await this.database.removeTrack(trackId);
    if (removed) {
      this.options.logger.info('library.track.removed', { trackId });
      this.options.onChanged?.('remove');
    }
    return removed;
  }

  /**
   * Marks files that disappeared from disk. Tracks are retained so a later
   * import can restore them without losing queue identity or play history.
   */
  async refreshMissing(): Promise<number> {
    const tracks = await this.database.listTracks();
    let changed = 0;
    for (const track of tracks) {
      try {
        await access(track.path);
        if (track.missing) {
          await this.database.markMissing(track.id, false);
          changed += 1;
        }
      } catch {
        if (!track.missing) {
          await this.database.markMissing(track.id, true);
          changed += 1;
        }
      }
    }
    if (changed > 0) {
      this.options.logger.info('library.missing.refreshed', { changed });
      this.options.onChanged?.('missing');
    }
    return changed;
  }

  private emptySummary(cancelled: boolean, rejected: ImportRejection[]): ImportSummary {
    return {
      sourceId: null,
      sourceLabel: null,
      imported: 0,
      duplicates: 0,
      missing: 0,
      rejected,
      tracks: [],
      cancelled,
    };
  }
}
