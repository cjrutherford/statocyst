import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';

export const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3',
  'flac',
  'ogg',
  'opus',
  'wav',
  'm4a',
  'aac',
  'webm',
] as const;

export type SupportedAudioExtension = (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];

export const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;

const ARTWORK_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type RejectionCode =
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'UNREADABLE'
  | 'PARSE_FAILED'
  | 'TOO_LARGE'
  | 'SYMLINK'
  | 'LIMIT_REACHED'
  | 'ABORTED';

export interface ScanRejection {
  path: string;
  code: RejectionCode;
  message: string;
}

export interface ScannedArtwork {
  mimeType: string;
  extension: string;
  data: Uint8Array;
}

export interface ScannedTrack {
  path: string;
  pathKey: string;
  fileName: string;
  ext: SupportedAudioExtension;
  sizeBytes: number;
  mtimeMs: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  durationMs: number;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  format: string | null;
  artwork: ScannedArtwork | null;
}

export interface ScanResult {
  tracks: ScannedTrack[];
  rejected: ScanRejection[];
  duplicates: number;
  skippedUnsupported: number;
  scannedFiles: number;
}

export interface ScanProgress {
  scanned: number;
  imported: number;
  path: string;
  total: number | null;
}

export interface ScanOptions {
  maxFiles?: number;
  maxDepth?: number;
  includeHidden?: boolean;
  followSymlinks?: boolean;
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  parser?: (path: string) => Promise<IAudioMetadata>;
  /** Upper bound on simultaneous metadata parses. Default 1 (serial). */
  maxConcurrency?: number;
  onProgress?: (progress: ScanProgress) => void;
}

export function extensionOf(filePath: string): string {
  return extname(filePath).replace(/^\./, '').toLowerCase();
}

export function isSupportedAudioPath(filePath: string): boolean {
  return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));
}

export function computePathKey(filePath: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalize(resolve(filePath));
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function fallbackTitle(fileName: string): string {
  const withoutExtension = basename(fileName, extname(fileName));
  const spaced = withoutExtension
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!spaced) return 'Untitled';
  return spaced.replace(/(^|[\s(])(\p{L})/gu, (_match, prefix: string, letter: string) => {
    return `${prefix}${letter.toUpperCase()}`;
  });
}

export function artworkExtension(mimeType: string): string | null {
  return ARTWORK_MIME[mimeType.toLowerCase()] ?? null;
}

function clean(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finite(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toArtwork(metadata: IAudioMetadata): ScannedArtwork | null {
  const picture = metadata.common.picture?.[0];
  if (!picture || picture.data.length === 0) return null;
  const mimeType = picture.format.toLowerCase();
  const extension = artworkExtension(mimeType);
  if (!extension) return null;
  if (picture.data.length > MAX_ARTWORK_BYTES) return null;
  return {
    mimeType,
    extension,
    data: new Uint8Array(picture.data),
  };
}

function toTrack(
  path: string,
  stats: { size: number; mtimeMs: number },
  metadata: IAudioMetadata,
  platform: NodeJS.Platform,
): ScannedTrack | null {
  const codec = clean(metadata.format.codec) ?? clean(metadata.format.container);
  if (!codec) return null;
  const fileName = basename(path);
  const ext = extensionOf(path) as SupportedAudioExtension;
  const title = clean(metadata.common.title) ?? fallbackTitle(fileName);
  const artist = clean(metadata.common.artist) ?? 'Unknown artist';
  const album = clean(metadata.common.album) ?? 'Unknown album';
  const albumArtist = clean(metadata.common.albumartist) ?? artist;
  const trackNo = finite(metadata.common.track.no);
  const discNo = finite(metadata.common.disk.no);
  const year = finite(metadata.common.year);
  const genre = metadata.common.genre?.map(clean).filter((value): value is string => !!value).join(', ');
  const durationSeconds = finite(metadata.format.duration) ?? 0;

  return {
    path,
    pathKey: computePathKey(path, platform),
    fileName,
    ext,
    sizeBytes: stats.size,
    mtimeMs: Math.round(stats.mtimeMs),
    title,
    artist,
    album,
    albumArtist,
    trackNo: trackNo === null ? null : Math.round(trackNo),
    discNo: discNo === null ? null : Math.round(discNo),
    year: year === null ? null : Math.round(year),
    genre: genre && genre.length > 0 ? genre : null,
    durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
    bitrate: finite(metadata.format.bitrate),
    sampleRate: finite(metadata.format.sampleRate),
    channels: finite(metadata.format.numberOfChannels),
    codec: clean(metadata.format.codec),
    format: clean(metadata.format.container) ?? clean(metadata.format.codec),
    artwork: toArtwork(metadata),
  };
}

function isSubPath(parent: string, child: string): boolean {
  const relative = child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
  return relative;
}

export async function scanPaths(
  inputPaths: readonly string[],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const platform = options.platform ?? process.platform;
  const maxFiles = options.maxFiles ?? 10_000;
  const maxDepth = options.maxDepth ?? 16;
  const includeHidden = options.includeHidden ?? false;
  const followSymlinks = options.followSymlinks ?? false;
  const parser = options.parser ?? ((path: string) => parseFile(path, { duration: true }));
  const result: ScanResult = {
    tracks: [],
    rejected: [],
    duplicates: 0,
    skippedUnsupported: 0,
    scannedFiles: 0,
  };
  const seenPathKeys = new Set<string>();
  const files: string[] = [];

  const reject = (path: string, code: RejectionCode, message: string) => {
    result.rejected.push({ path, code, message });
  };

  const aborted = () => options.signal?.aborted === true;

  const collect = async (directory: string, depth: number): Promise<void> => {
    if (aborted() || depth > maxDepth || files.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      reject(directory, 'UNREADABLE', `Cannot read directory: ${(error as Error).message}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (aborted() || files.length >= maxFiles) return;
      if (!includeHidden && entry.name.startsWith('.')) continue;
      const fullPath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (!followSymlinks) continue;
        try {
          const target = await lstat(fullPath);
          if (!target.isFile() && !target.isDirectory()) continue;
        } catch {
          continue;
        }
      }
      if (entry.isDirectory()) {
        await collect(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (!isSupportedAudioPath(fullPath)) {
          result.skippedUnsupported += 1;
          continue;
        }
        files.push(fullPath);
        if (files.length >= maxFiles) {
          reject(fullPath, 'LIMIT_REACHED', `Import stopped after ${maxFiles} files`);
          return;
        }
      }
    }
  };

  for (const input of inputPaths) {
    if (aborted()) break;
    if (typeof input !== 'string' || input.trim().length === 0) {
      reject(String(input), 'UNREADABLE', 'Empty path');
      continue;
    }
    if (!isAbsolute(input)) {
      reject(input, 'UNREADABLE', 'Only absolute paths can be imported');
      continue;
    }
    const normalized = resolve(input);
    let info;
    try {
      info = await lstat(normalized);
    } catch {
      reject(normalized, 'NOT_FOUND', 'File or directory does not exist');
      continue;
    }
    if (info.isSymbolicLink() && !followSymlinks) {
      reject(normalized, 'SYMLINK', 'Symbolic links are skipped for safety');
      continue;
    }
    if (info.isDirectory()) {
      await collect(normalized, 0);
    } else if (info.isFile()) {
      if (!isSupportedAudioPath(normalized)) {
        reject(
          normalized,
          'UNSUPPORTED',
          `Unsupported audio format .${extensionOf(normalized) || '(none)'}`,
        );
        continue;
      }
      files.push(normalized);
    } else {
      reject(normalized, 'UNREADABLE', 'Not a regular file or directory');
    }
  }

  const uniqueFiles = [...new Set(files.map((file) => computePathKey(file, platform)))].length;
  result.duplicates += files.length - uniqueFiles;

  const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 1));
  const total = files.length;
  let nextIndex = 0;
  let stopped = aborted();
  let importedCount = 0;
  const parsedTracks: Array<{ index: number; track: ScannedTrack }> = [];

  const stopOnAbort = (): void => {
    stopped = true;
  };
  options.signal?.addEventListener('abort', stopOnAbort, { once: true });

  const parseWithAbort = (file: string): Promise<IAudioMetadata> =>
    new Promise((resolveParsed, rejectParsed) => {
      const signal = options.signal;
      if (!signal) {
        void parser(file).then(resolveParsed, rejectParsed);
        return;
      }
      if (signal.aborted) {
        rejectParsed(new Error('Import aborted'));
        return;
      }
      const onAbort = (): void => rejectParsed(new Error('Import aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      void parser(file).then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolveParsed(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          rejectParsed(error);
        },
      );
    });

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      const file = files[index];
      const pathKey = computePathKey(file, platform);
      if (seenPathKeys.has(pathKey)) {
        result.duplicates += 1;
        continue;
      }
      seenPathKeys.add(pathKey);

      let fileStat;
      try {
        fileStat = await stat(file);
      } catch (error) {
        if (!stopped) {
          reject(file, 'NOT_FOUND', `Cannot stat file: ${(error as Error).message}`);
        }
        continue;
      }
      if (fileStat.size > MAX_AUDIO_BYTES) {
        reject(file, 'TOO_LARGE', `File is larger than ${MAX_AUDIO_BYTES} bytes`);
        continue;
      }

      result.scannedFiles += 1;
      options.onProgress?.({
        scanned: result.scannedFiles,
        imported: importedCount,
        path: file,
        total,
      });

      try {
        const metadata = await parseWithAbort(file);
        if (stopped) return;
        const track = toTrack(file, fileStat, metadata, platform);
        if (!track) {
          reject(file, 'PARSE_FAILED', 'No audio codec was detected');
          continue;
        }
        parsedTracks.push({ index, track });
        importedCount += 1;
      } catch (error) {
        if (stopped) return;
        reject(file, 'PARSE_FAILED', `Cannot read audio metadata: ${(error as Error).message}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, total) }, () => worker()),
  );
  options.signal?.removeEventListener('abort', stopOnAbort);

  if (aborted() && nextIndex < total) {
    reject(files[nextIndex], 'ABORTED', 'Import cancelled');
  }

  // Preserve input order regardless of parse completion order.
  result.tracks = parsedTracks.sort((a, b) => a.index - b.index).map((entry) => entry.track);

  return result;
}

export function pathIsInside(parent: string, child: string): boolean {
  return isSubPath(resolve(parent), resolve(child));
}
