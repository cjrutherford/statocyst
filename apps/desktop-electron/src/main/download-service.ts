import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildAudioStreamUrl, type ClientIdentity } from '@statocyst/jellyfin-client';
import type {
  DownloadProgress,
  DownloadStats,
  DownloadSummary,
  DownloadView,
  PodcastDownloadVariant,
  Result,
} from '@statocyst/contracts';
import { fail, ok } from '@statocyst/contracts';
import type { StatocystDatabase, StoredDownload, StoredTrack } from '@statocyst/persistence';
import type { Logger } from './logger';

export interface RemoteDownloadSource {
  url: string;
  headers?: Record<string, string>;
}

export interface DownloadServiceOptions {
  database: StatocystDatabase;
  downloadsDirectory: string;
  logger: Logger;
  identity: ClientIdentity;
  resolveRemoteTrack: (sourceId: string) => Promise<{ serverUrl: string; token: string } | null>;
  /** Direct enclosure URLs for non-Jellyfin sources (podcasts). */
  resolveDirectMedia?: (track: StoredTrack) => Promise<RemoteDownloadSource | null>;
  /** User-provided ffmpeg binary for podcast compression; defaults to PATH. */
  ffmpegPath?: string;
}

function extensionFromType(value: string | null): string | null {
  const type = (value ?? '').toLowerCase();
  if (type.includes('mpeg')) return 'mp3';
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return 'm4a';
  if (type.includes('ogg') || type.includes('opus')) return 'ogg';
  if (type.includes('webm')) return 'webm';
  if (type.includes('wav')) return 'wav';
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(value ?? '');
  return match ? match[1]!.toLowerCase() : null;
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
    variant: PodcastDownloadVariant = 'original',
  ): Promise<Result<DownloadSummary>> {
    const track = await this.database.getTrack(trackId).catch(() => null);
    if (!track) return fail('TRACK_NOT_FOUND', 'The track does not exist');

    const episode =
      track.sourceKind === 'podcast'
        ? await this.database.getPodcastEpisodeByMediaItemId(trackId).catch(() => null)
        : null;
    const selection = this.selectPodcastSource(track, episode, variant);
    if (!selection) {
      return fail('UNSUPPORTED_MEDIA', 'This compression preset is not available for the episode');
    }

    const container = selection.container ?? track.format ?? track.ext ?? null;
    const ext = selection.extension ?? (track.ext || container || 'bin').toLowerCase();
    await mkdir(this.options.downloadsDirectory, { recursive: true });
    const finalPath = join(this.options.downloadsDirectory, `${trackId}.${ext}`);
    const tmpPath = `${finalPath}.part.${ext}`;
    const sourcePath = `${finalPath}.source.${(track.ext || 'bin').toLowerCase()}`;

    try {
      const remote = selection.transcode ? null : await this.resolveRemote(track, selection.url);
      if (selection.transcode) {
        await this.fetchToFile(trackId, selection.url, sourcePath, onProgress);
        onProgress?.({ trackId, receivedBytes: 0, totalBytes: null, done: false, error: null });
        await this.transcode(sourcePath, tmpPath, variant);
        await rm(sourcePath, { force: true }).catch(() => undefined);
        const digest = await this.hashFile(tmpPath);
        await this.finishDownload(trackId, finalPath, tmpPath, digest, selection.container);
      } else if (remote) {
        let response: Response;
        try {
          response = await fetch(remote.url, {
            headers: remote.headers,
            redirect: 'manual',
          });
        } catch {
          return fail('MEDIA_UNAVAILABLE', 'The source did not respond');
        }
        if (!response.ok || !response.body) {
          if (response.status === 401 || response.status === 403) {
            return fail('UNAUTHORIZED', 'The stored session was rejected');
          }
          return fail('MEDIA_UNAVAILABLE', `The source returned HTTP ${response.status}`);
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
      this.options.logger.info('download.completed', {
        trackId,
        bytes: summary.sizeBytes,
        variant,
      });
      return ok(summary);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      await rm(sourcePath, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn('download.failed', { trackId, error: message, variant });
      onProgress?.({ trackId, receivedBytes: 0, totalBytes: null, done: true, error: message });
      return fail('INTERNAL_ERROR', message);
    }
  }

  private selectPodcastSource(
    track: StoredTrack,
    episode: Awaited<ReturnType<StatocystDatabase['getPodcastEpisodeByMediaItemId']>>,
    variant: PodcastDownloadVariant,
  ): {
    url: string;
    extension: string | null;
    container: string | null;
    transcode: boolean;
  } | null {
    if (variant === 'original') {
      return { url: track.path, extension: track.ext || null, container: track.format ?? null, transcode: false };
    }
    if (track.sourceKind !== 'podcast') {
      return { url: track.path, extension: track.ext || null, container: track.format ?? null, transcode: false };
    }
    if (variant === 'audio-only') {
      const audio = episode?.alternates.find((alternate) => alternate.form === 'audio');
      if (audio) {
        return {
          url: audio.url,
          extension: extensionFromType(audio.type ?? audio.url),
          container: audio.type,
          transcode: false,
        };
      }
      if (track.mediaForm === 'audio') {
        return { url: track.path, extension: track.ext || null, container: track.format ?? null, transcode: false };
      }
      return { url: track.path, extension: 'm4a', container: 'audio/mp4', transcode: true };
    }
    if (track.mediaForm !== 'video') return null;
    return {
      url: track.path,
      extension: 'mp4',
      container: 'video/mp4',
      transcode: true,
    };
  }

  private async fetchToFile(
    trackId: string,
    url: string,
    target: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    const remote = await this.resolveRemote({ path: url, sourceKind: 'podcast' } as StoredTrack, url);
    if (!remote) throw new Error('The source URL is not allowed');
    let response: Response;
    try {
      response = await fetch(remote.url, { headers: remote.headers, redirect: 'manual' });
    } catch {
      throw new Error('The source did not respond');
    }
    if (!response.ok || !response.body) {
      throw new Error(`The source returned HTTP ${response.status}`);
    }
    const totalBytes = response.headers.get('content-length');
    const total = totalBytes ? Number(totalBytes) : null;
    const transform = new HashTransform((received) =>
      onProgress?.({ trackId, receivedBytes: received, totalBytes: total, done: false, error: null }),
    );
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      transform,
      createWriteStream(target),
    );
  }

  private async transcode(
    source: string,
    target: string,
    variant: PodcastDownloadVariant,
  ): Promise<void> {
    const binary = this.options.ffmpegPath ?? process.env['STATOCYST_FFMPEG'] ?? 'ffmpeg';
    const args =
      variant === 'audio-only'
        ? ['-y', '-i', source, '-vn', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', target]
        : [
            '-y',
            '-i',
            source,
            '-vf',
            `scale=-2:min(ih\\,${variant === 'video-480p' ? 480 : 720})`,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-b:a',
            '96k',
            '-movflags',
            '+faststart',
            target,
          ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-2000);
      });
      child.on('error', () => {
        reject(
          new Error(
            'ffmpeg is required for compressed downloads. Install ffmpeg or set STATOCYST_FFMPEG.',
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        // Do not put ffmpeg stderr in the user/log message: it can contain the
        // signed source URL. The exit code is enough for diagnostics.
        this.options.logger.warn('download.transcode.failed', {
          trackId: 'redacted',
          code,
          stderrLength: stderr.length,
        });
        reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });
  }

  private async resolveRemote(
    track: StoredTrack,
    url: string,
  ): Promise<RemoteDownloadSource | null> {
    const direct = this.options.resolveDirectMedia
      ? await this.options.resolveDirectMedia(track).catch(() => null)
      : null;
    if (direct && direct.url === url) return direct;
    if (/^https?:\/\//i.test(url)) return { url };
    if (track.sourceKind !== 'jellyfin') return null;
    const remote = await this.options.resolveRemoteTrack(track.sourceId);
    if (!remote) return null;
    return {
      url: buildAudioStreamUrl({
        baseUrl: remote.serverUrl,
        itemId: track.path,
        mode: 'direct',
      }),
      headers: { Authorization: remoteAuthorization(this.options.identity, remote.token) },
    };
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
    const track = await this.database.getTrack(record.trackId).catch(() => null);
    return {
      trackId: record.trackId,
      localPath: record.localPath,
      sizeBytes,
      sha256: record.sha256,
      container: record.container,
      verified,
      createdAt: record.createdAt,
      mediaForm: track?.mediaForm,
      variant: 'original',
    };
  }
}
