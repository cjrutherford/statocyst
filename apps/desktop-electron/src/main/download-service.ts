import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildAudioStreamUrl, type ClientIdentity } from '@statocyst/jellyfin-client';
import type { DownloadProgress, DownloadStats, DownloadSummary, DownloadView, Result } from '@statocyst/contracts';
import { fail, ok } from '@statocyst/contracts';
import type { StatocystDatabase, StoredDownload } from '@statocyst/persistence';
import type { Logger } from './logger';

export interface DownloadServiceOptions {
  database: StatocystDatabase;
  downloadsDirectory: string;
  logger: Logger;
  identity: ClientIdentity;
  resolveRemoteTrack: (sourceId: string) => Promise<{ serverUrl: string; token: string } | null>;
}

function remoteAuthorization(identity: ClientIdentity, token: string): string {
  return (
    `MediaBrowser Client="${identity.client}", Device="${identity.device}", ` +
    `DeviceId="${identity.deviceId}", Version="${identity.version}", Token="${token}"`
  );
}

/** A Transform that hashes and counts bytes as they stream through. */
class HashTransform extends Transform {
  receivedBytes = 0;
  private readonly hash = createHash('sha256');
  constructor(private readonly onChunk?: (received: number) => void) {
    super();
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.receivedBytes += chunk.length;
    this.hash.update(chunk);
    this.onChunk?.(this.receivedBytes);
    callback(null, chunk);
  }
  digest(): string {
    return this.hash.digest('hex');
  }
}

export class DownloadService {
  constructor(private readonly options: DownloadServiceOptions) {}

  private get database(): StatocystDatabase {
    return this.options.database;
  }

  async download(
    trackId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<Result<DownloadSummary>> {
    const track = await this.database.getTrack(trackId).catch(() => null);
    if (!track) return fail('TRACK_NOT_FOUND', 'The track does not exist');

    const container = track.format ?? track.ext ?? null;
    const ext = (track.ext || container || 'bin').toLowerCase();
    await mkdir(this.options.downloadsDirectory, { recursive: true });
    const finalPath = join(this.options.downloadsDirectory, `${trackId}.${ext}`);
    const tmpPath = `${finalPath}.part`;

    try {
      if (track.sourceKind === 'jellyfin') {
        const remote = await this.options.resolveRemoteTrack(track.sourceId);
        if (!remote) return fail('UNAUTHORIZED', 'The server is not signed in');
        const url = buildAudioStreamUrl({
          baseUrl: remote.serverUrl,
          itemId: track.path,
          mode: 'direct',
        });
        let response: Response;
        try {
          response = await fetch(url, {
            headers: { Authorization: remoteAuthorization(this.options.identity, remote.token) },
            redirect: 'manual',
          });
        } catch {
          return fail('MEDIA_UNAVAILABLE', 'The server did not respond');
        }
        if (!response.ok || !response.body) {
          if (response.status === 401 || response.status === 403) {
            return fail('UNAUTHORIZED', 'The stored session was rejected');
          }
          return fail('MEDIA_UNAVAILABLE', `The server returned HTTP ${response.status}`);
        }
        const totalBytes = response.headers.get('content-length');
        const total = totalBytes ? Number(totalBytes) : null;
        const transform = new HashTransform((received) =>
          onProgress?.({ trackId, receivedBytes: received, totalBytes: total, done: false, error: null }),
        );
        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
          transform,
          createWriteStream(tmpPath),
        );
        await this.finishDownload(trackId, finalPath, tmpPath, transform.digest(), container);
      } else {
        // Local/demo tracks are copied verbatim.
        await copyFile(track.path, tmpPath);
        const digest = await this.hashFile(tmpPath);
        await this.finishDownload(trackId, finalPath, tmpPath, digest, container);
      }

      const summary = await this.summary(trackId, finalPath, container);
      onProgress?.({ trackId, receivedBytes: summary.sizeBytes, totalBytes: summary.sizeBytes, done: true, error: null });
      this.options.logger.info('download.completed', { trackId, bytes: summary.sizeBytes });
      return ok(summary);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn('download.failed', { trackId, error: message });
      onProgress?.({ trackId, receivedBytes: 0, totalBytes: null, done: true, error: message });
      return fail('INTERNAL_ERROR', message);
    }
  }

  async remove(trackId: string): Promise<Result<{ removed: boolean }>> {
    const record = await this.database.getDownload(trackId);
    if (!record) return ok({ removed: false });
    await rm(record.localPath, { force: true }).catch(() => undefined);
    const removed = await this.database.removeDownload(trackId);
    this.options.logger.info('download.removed', { trackId });
    return ok({ removed });
  }

  async list(): Promise<DownloadView[]> {
    const records = await this.database.listDownloads();
    return Promise.all(records.map((record) => this.toView(record)));
  }

  async stats(): Promise<DownloadStats> {
    const records = await this.database.listDownloads();
    let totalBytes = 0;
    for (const record of records) {
      const view = await this.toView(record);
      if (view.verified) totalBytes += view.sizeBytes;
    }
    return { count: records.length, totalBytes };
  }

  /**
   * Returns the download record only when its file still exists on disk with
   * the recorded size, so playback never treats a missing/corrupt download as
   * available offline.
   */
  async getVerifiedDownload(trackId: string): Promise<StoredDownload | null> {
    const record = await this.database.getDownload(trackId);
    if (!record || !record.verified) return null;
    try {
      const info = await stat(record.localPath);
      if (!info.isFile() || info.size !== record.sizeBytes) return null;
      return record;
    } catch {
      return null;
    }
  }

  private async finishDownload(
    trackId: string,
    finalPath: string,
    tmpPath: string,
    digest: string,
    container: string | null,
  ): Promise<void> {
    const info = await stat(tmpPath);
    await rename(tmpPath, finalPath);
    await this.database.saveDownload({
      trackId,
      localPath: finalPath,
      sizeBytes: info.size,
      sha256: digest,
      container,
      verified: true,
    });
  }

  private async summary(trackId: string, localPath: string, container: string | null): Promise<DownloadSummary> {
    const record = await this.database.getDownload(trackId);
    if (!record) throw new Error('Download record missing after write');
    return {
      trackId,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      verified: record.verified,
    };
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  private async toView(record: StoredDownload): Promise<DownloadView> {
    let sizeBytes = record.sizeBytes;
    let verified = record.verified;
    try {
      const info = await stat(record.localPath);
      if (!info.isFile()) {
        verified = false;
      } else {
        sizeBytes = info.size;
        verified = record.verified && info.size === record.sizeBytes;
      }
    } catch {
      verified = false;
    }
    return {
      trackId: record.trackId,
      localPath: record.localPath,
      sizeBytes,
      sha256: record.sha256,
      container: record.container,
      verified,
      createdAt: record.createdAt,
    };
  }
}
