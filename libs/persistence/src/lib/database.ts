import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm, stat as fileStat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient, type Client, type InStatement, type Row } from '@libsql/client';
import type {
  MediaForm,
  MediaKind,
  PlaybackContext,
  PodcastEnclosure,
  PodcastFeedPatch,
  RepeatMode,
  Track,
} from '@statocyst/contracts';
import { MIGRATIONS, type Migration } from './migrations';

export interface StoredMediaSource {
  id: string;
  kind: 'local' | 'demo' | 'jellyfin' | 'podcast';
  label: string;
  rootPath: string | null;
  createdAt: string;
}

export interface StoredTrack extends Track {
  path: string;
  pathKey: string;
  fileName: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  albumArtist: string;
  discNo: number | null;
  genre: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  artworkPath: string | null;
  addedAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  playCount: number;
  sourceKind: 'local' | 'demo' | 'jellyfin' | 'podcast';
  jellyfinImageTag: string | null;
  mediaKind: MediaKind;
  mediaForm: MediaForm;
}

export interface TrackUpsert {
  id?: string;
  sourceId: string;
  path: string;
  pathKey: string;
  fileName: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  trackNo?: number | null;
  discNo?: number | null;
  year?: number | null;
  genre?: string | null;
  durationMs: number;
  bitrate?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  codec?: string | null;
  format?: string | null;
  artworkPath?: string | null;
  /** Remote primary-image tag for Jellyfin items; null for local/demo sources. */
  jellyfinImageTag?: string | null;
  /** Music by default; podcast episodes set this explicitly. */
  mediaKind?: MediaKind;
  /** Primary presentation; audio by default. */
  mediaForm?: MediaForm;
}

export interface TrackUpsertResult {
  track: StoredTrack;
  duplicate: boolean;
}

export interface StoredQueueEntry {
  entryId: string;
  trackId: string;
}

export interface StoredDownload {
  trackId: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
  container: string | null;
  verified: boolean;
  createdAt: string;
}

export interface StoredCacheEntry {
  trackId: string;
  localPath: string;
  sizeBytes: number;
  lastAccessAt: string;
}

export interface StoredPlaybackState {
  currentEntryId: string | null;
  positionMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  activeContext: PlaybackContext;
}

export interface StoredJellyfinServer {
  id: string;
  url: string;
  name: string;
  jellyfinId: string;
  version: string | null;
  createdAt: string;
  lastConnectedAt: string | null;
}

export interface StoredJellyfinAccount {
  serverId: string;
  userId: string;
  userName: string;
  tokenCiphertext: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPodcastFeed {
  id: string;
  feedUrl: string;
  resolvedUrl: string | null;
  siteUrl: string | null;
  title: string;
  author: string | null;
  descriptionText: string | null;
  imageUrl: string | null;
  artworkPath: string | null;
  language: string | null;
  explicit: boolean;
  categories: string[];
  feedType: 'rss' | 'atom';
  podcastIndexId: number | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  nextFetchAt: string | null;
  fetchError: string | null;
  failureCount: number;
  refreshIntervalMinutes: number;
  defaultSpeed: number;
  skipIntroSeconds: number;
  skipOutroSeconds: number;
  autoQueue: boolean;
  episodeSort: 'newest' | 'oldest';
  defaultMediaForm: MediaForm;
  subscribed: boolean;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unplayedCount: number;
  newEpisodeCount: number;
}

export interface PodcastFeedUpsert {
  id?: string;
  feedUrl: string;
  resolvedUrl?: string | null;
  siteUrl?: string | null;
  title: string;
  author?: string | null;
  descriptionText?: string | null;
  imageUrl?: string | null;
  artworkPath?: string | null;
  language?: string | null;
  explicit?: boolean;
  categories?: string[];
  feedType: 'rss' | 'atom';
  podcastIndexId?: number | null;
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt?: string | null;
  lastSuccessAt?: string | null;
  nextFetchAt?: string | null;
  fetchError?: string | null;
  failureCount?: number;
  refreshIntervalMinutes?: number;
  defaultSpeed?: number;
  skipIntroSeconds?: number;
  skipOutroSeconds?: number;
  autoQueue?: boolean;
  episodeSort?: 'newest' | 'oldest';
  defaultMediaForm?: MediaForm;
  subscribed?: boolean;
}

export interface StoredPodcastEpisode extends StoredTrack {
  episodeId: string;
  feedId: string;
  feedTitle: string;
  guid: string;
  descriptionText: string | null;
  links: Array<{ title: string | null; url: string }>;
  link: string | null;
  publishedAt: string | null;
  seasonNo: number | null;
  episodeNo: number | null;
  episodeType: string | null;
  imageUrl: string | null;
  explicit: boolean;
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureLengthBytes: number | null;
  mediaForm: MediaForm;
  alternates: PodcastEnclosure[];
  posterUrl: string | null;
  videoWidth: number | null;
  videoHeight: number | null;
  chaptersUrl: string | null;
  transcriptUrl: string | null;
  transcriptType: string | null;
  playbackSpeed: number | null;
  resumePositionMs: number;
  played: boolean;
  completed: boolean;
  lastPlayedAt: string | null;
  firstSeenAt: string;
}

export interface PodcastEpisodeSaveResult {
  episodeId: string;
  mediaItemId: string;
  duplicate: boolean;
}

export interface PodcastEpisodeUpsert {
  id?: string;
  feedId: string;
  guid: string;
  /** Stable media_item.path_key. The parser supplies this in production. */
  pathKey?: string;
  title: string;
  descriptionText?: string | null;
  links?: Array<{ title: string | null; url: string }>;
  link?: string | null;
  enclosureUrl: string;
  enclosureType?: string | null;
  enclosureLengthBytes?: number | null;
  mediaForm?: MediaForm;
  alternates?: PodcastEnclosure[];
  posterUrl?: string | null;
  videoWidth?: number | null;
  videoHeight?: number | null;
  durationMs?: number;
  publishedAt?: string | null;
  seasonNo?: number | null;
  episodeNo?: number | null;
  episodeType?: string | null;
  imageUrl?: string | null;
  artworkPath?: string | null;
  explicit?: boolean;
  chaptersUrl?: string | null;
  transcriptUrl?: string | null;
  transcriptType?: string | null;
  firstSeenAt?: string;
}

export interface StoredPodcastQueueEntry {
  entryId: string;
  episodeId: string;
}

export interface StoredPodcastPlaybackState {
  currentEntryId: string | null;
  positionMs: number;
  speed: number;
}

export interface PodcastFetchState {
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt?: string | null;
  lastSuccessAt?: string | null;
  nextFetchAt?: string | null;
  fetchError?: string | null;
  failureCount?: number;
}

export interface StoredPodcastDirectoryCache {
  payloadJson: string;
  fetchedAt: string;
  expiresAt: string;
}

export interface LibraryStatsRecord {
  tracks: number;
  albums: number;
  artists: number;
  durationMs: number;
  missing: number;
}

export interface OpenDatabaseOptions {
  path: string;
  migrations?: readonly Migration[];
  idFactory?: () => string;
  /** Take a `VACUUM INTO` backup before applying pending migrations (default true). */
  backupBeforeMigrate?: boolean;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: Array<{ version: number; name: string }>;
}

export class MigrationChecksumError extends Error {
  constructor(
    readonly version: number,
    readonly migrationName: string,
  ) {
    super(
      `Migration ${version} (${migrationName}) has changed since it was applied. ` +
        'Migrations are additive and immutable; create a new migration instead.',
    );
    this.name = 'MigrationChecksumError';
  }
}

export class MigrationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationIntegrityError';
  }
}

/**
 * Raised when a migration run fails after a pre-migration backup was taken.
 * The database file has already been restored to the backup and the next
 * launch can proceed on the previous schema.
 */
export class MigrationRecoveryError extends Error {
  constructor(
    readonly originalError: unknown,
    readonly backupPath: string,
  ) {
    super(
      `Migration failed and the database was restored from ${backupPath}. ` +
        `Original error: ${originalError instanceof Error ? originalError.message : String(originalError)}`,
    );
    this.name = 'MigrationRecoveryError';
  }
}

function checksum(statements: readonly string[]): string {
  return createHash('sha256').update(statements.join('\n;\n')).digest('hex');
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error(`Expected text column ${key}`);
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number.parseInt(value, 10);
  return 0;
}

function nullableInteger(row: Row, key: string): number | null {
  const value = row[key];
  return value === null || value === undefined ? null : integer(row, key);
}

function bool(row: Row, key: string): boolean {
  return integer(row, key) === 1;
}

function toTrack(row: Row): StoredTrack {
  const id = text(row, 'id');
  const artworkPath = nullableText(row, 'artwork_path');
  const jellyfinImageTag = nullableText(row, 'jellyfin_image_tag');
  return {
    id,
    path: text(row, 'path'),
    pathKey: text(row, 'path_key'),
    fileName: text(row, 'file_name'),
    ext: text(row, 'ext'),
    sizeBytes: integer(row, 'size_bytes'),
    mtimeMs: integer(row, 'mtime_ms'),
    title: text(row, 'title'),
    artist: text(row, 'artist'),
    album: text(row, 'album'),
    albumArtist: nullableText(row, 'album_artist') ?? text(row, 'artist'),
    trackNo: nullableInteger(row, 'track_no'),
    discNo: nullableInteger(row, 'disc_no'),
    year: nullableInteger(row, 'year'),
    genre: nullableText(row, 'genre'),
    durationMs: integer(row, 'duration_ms'),
    bitrate: nullableInteger(row, 'bitrate'),
    sampleRate: nullableInteger(row, 'sample_rate'),
    channels: nullableInteger(row, 'channels'),
    codec: nullableText(row, 'codec'),
    format: nullableText(row, 'format'),
    artworkPath,
    artworkUrl: artworkPath || jellyfinImageTag ? `statocyst-art://track/${id}` : null,
    addedAt: text(row, 'added_at'),
    updatedAt: text(row, 'updated_at'),
    lastPlayedAt: nullableText(row, 'last_played_at'),
    playCount: integer(row, 'play_count'),
    missing: bool(row, 'missing'),
    sourceId: text(row, 'source_id'),
    sourceLabel: text(row, 'source_label'),
    sourceKind: text(row, 'source_kind') as StoredTrack['sourceKind'],
    jellyfinImageTag,
    mediaKind: (nullableText(row, 'media_kind') as MediaKind | null) ?? 'music',
    mediaForm: (nullableText(row, 'media_form') as MediaForm | null) ?? 'audio',
  };
}

function nullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseEnclosures(value: string | null): PodcastEnclosure[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): PodcastEnclosure[] => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Partial<PodcastEnclosure>;
      if (
        typeof candidate.url !== 'string' ||
        !/^https?:\/\//i.test(candidate.url) ||
        (candidate.form !== 'audio' && candidate.form !== 'video')
      ) {
        return [];
      }
      return [{
        url: candidate.url,
        type: typeof candidate.type === 'string' ? candidate.type : null,
        form: candidate.form,
        lengthBytes:
          typeof candidate.lengthBytes === 'number' && candidate.lengthBytes >= 0
            ? candidate.lengthBytes
            : null,
        width:
          typeof candidate.width === 'number' && candidate.width > 0 ? candidate.width : null,
        height:
          typeof candidate.height === 'number' && candidate.height > 0 ? candidate.height : null,
        bitrate:
          typeof candidate.bitrate === 'number' && candidate.bitrate > 0
            ? candidate.bitrate
            : null,
      }];
    }).slice(0, 8);
  } catch {
    return [];
  }
}

function parseLinks(value: string | null): Array<{ title: string | null; url: string }> {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const url = (entry as { url?: unknown }).url;
      const title = (entry as { title?: unknown }).title;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return [];
      return [{ title: typeof title === 'string' ? title : null, url }];
    });
  } catch {
    return [];
  }
}

/** Stable media identity for an episode. The parser may supply the same value. */
export function podcastMediaPathKey(feedUrl: string, guid: string): string {
  return `podcast:${createHash('sha256').update(`${feedUrl}\u0000${guid}`).digest('hex')}`;
}

const PODCAST_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'flac',
  'webm',
  'mp4',
]);

function extensionForEnclosure(enclosureType: string | null, url: string): string {
  const fromType: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4b': 'm4b',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/webm': 'webm',
  };
  const type = (enclosureType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (fromType[type]) return fromType[type];
  try {
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '';
    if (PODCAST_AUDIO_EXTENSIONS.has(extension)) return extension;
  } catch {
    /* fall through */
  }
  return 'bin';
}

function yearForPublishedAt(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

const PODCAST_FEED_SELECT = `
  SELECT f.*,
    (SELECT COUNT(*) FROM podcast_episode e
      WHERE e.feed_id = f.id AND e.played = 0) AS unplayed_count,
    (SELECT COUNT(*) FROM podcast_episode e
      WHERE e.feed_id = f.id AND e.played = 0
        AND (f.last_viewed_at IS NULL OR e.first_seen_at > f.last_viewed_at)) AS new_episode_count
  FROM podcast_feed f
`;

function toPodcastFeed(row: Row): StoredPodcastFeed {
  return {
    id: text(row, 'id'),
    feedUrl: text(row, 'feed_url'),
    resolvedUrl: nullableText(row, 'resolved_url'),
    siteUrl: nullableText(row, 'site_url'),
    title: text(row, 'title'),
    author: nullableText(row, 'author'),
    descriptionText: nullableText(row, 'description_text'),
    imageUrl: nullableText(row, 'image_url'),
    artworkPath: nullableText(row, 'artwork_path'),
    language: nullableText(row, 'language'),
    explicit: bool(row, 'explicit'),
    categories: parseStringArray(nullableText(row, 'categories_json')),
    feedType: text(row, 'feed_type') as 'rss' | 'atom',
    podcastIndexId: nullableInteger(row, 'podcast_index_id'),
    etag: nullableText(row, 'etag'),
    lastModified: nullableText(row, 'last_modified'),
    lastFetchedAt: nullableText(row, 'last_fetched_at'),
    lastSuccessAt: nullableText(row, 'last_success_at'),
    nextFetchAt: nullableText(row, 'next_fetch_at'),
    fetchError: nullableText(row, 'fetch_error'),
    failureCount: integer(row, 'failure_count'),
    refreshIntervalMinutes: integer(row, 'refresh_interval_minutes'),
    defaultSpeed: nullableNumber(row, 'default_speed') ?? 1,
    skipIntroSeconds: integer(row, 'skip_intro_seconds'),
    skipOutroSeconds: integer(row, 'skip_outro_seconds'),
    autoQueue: bool(row, 'auto_queue'),
    episodeSort: text(row, 'episode_sort') as 'newest' | 'oldest',
    defaultMediaForm: (nullableText(row, 'default_media_form') as MediaForm | null) ?? 'audio',
    subscribed: bool(row, 'subscribed'),
    lastViewedAt: nullableText(row, 'last_viewed_at'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    unplayedCount: integer(row, 'unplayed_count'),
    newEpisodeCount: integer(row, 'new_episode_count'),
  };
}

const PODCAST_EPISODE_SELECT = `
  SELECT
    pe.id AS episode_id,
    pe.feed_id,
    pe.guid,
    pe.description_text,
    pe.links_json,
    pe.link,
    pe.enclosure_url,
    pe.enclosure_type,
    pe.enclosure_length_bytes,
    pe.media_form,
    pe.alternates_json,
    pe.poster_url,
    pe.video_width,
    pe.video_height,
    pe.published_at,
    pe.season_no,
    pe.episode_no,
    pe.episode_type,
    pe.image_url,
    pe.explicit AS episode_explicit,
    pe.chapters_url,
    pe.transcript_url,
    pe.transcript_type,
    pe.playback_speed,
    pe.resume_position_ms,
    pe.played,
    pe.completed,
    pe.play_count AS episode_play_count,
    pe.last_played_at AS episode_last_played_at,
    pe.first_seen_at,
    m.*,
    f.title AS feed_title,
    s.label AS source_label,
    s.kind AS source_kind
  FROM podcast_episode pe
  JOIN media_item m ON m.id = pe.media_item_id
  JOIN podcast_feed f ON f.id = pe.feed_id
  JOIN media_source s ON s.id = m.source_id
`;

function toPodcastEpisode(row: Row): StoredPodcastEpisode {
  return {
    ...toTrack(row),
    episodeId: text(row, 'episode_id'),
    feedId: text(row, 'feed_id'),
    feedTitle: text(row, 'feed_title'),
    guid: text(row, 'guid'),
    descriptionText: nullableText(row, 'description_text'),
    links: parseLinks(nullableText(row, 'links_json')),
    link: nullableText(row, 'link'),
    publishedAt: nullableText(row, 'published_at'),
    seasonNo: nullableInteger(row, 'season_no'),
    episodeNo: nullableInteger(row, 'episode_no'),
    episodeType: nullableText(row, 'episode_type'),
    imageUrl: nullableText(row, 'image_url'),
    explicit: bool(row, 'episode_explicit'),
    enclosureUrl: text(row, 'enclosure_url'),
    enclosureType: nullableText(row, 'enclosure_type'),
    enclosureLengthBytes: nullableInteger(row, 'enclosure_length_bytes'),
    mediaForm: (nullableText(row, 'media_form') as MediaForm | null) ?? 'audio',
    alternates: parseEnclosures(nullableText(row, 'alternates_json')),
    posterUrl: nullableText(row, 'poster_url'),
    videoWidth: nullableInteger(row, 'video_width'),
    videoHeight: nullableInteger(row, 'video_height'),
    chaptersUrl: nullableText(row, 'chapters_url'),
    transcriptUrl: nullableText(row, 'transcript_url'),
    transcriptType: nullableText(row, 'transcript_type'),
    playbackSpeed: nullableNumber(row, 'playback_speed'),
    resumePositionMs: integer(row, 'resume_position_ms'),
    played: bool(row, 'played'),
    completed: bool(row, 'completed'),
    playCount: integer(row, 'episode_play_count'),
    lastPlayedAt: nullableText(row, 'episode_last_played_at'),
    firstSeenAt: text(row, 'first_seen_at'),
  };
}

const TRACK_SELECT = `
  SELECT m.*, s.label AS source_label, s.kind AS source_kind
  FROM media_item m
  JOIN media_source s ON s.id = m.source_id
`;

export async function runMigrations(
  client: Client,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = await client.execute('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
  const applied = new Map<number, { name: string; checksum: string }>();
  for (const row of appliedRows.rows) {
    applied.set(integer(row, 'version'), {
      name: text(row, 'name'),
      checksum: text(row, 'checksum'),
    });
  }

  const fromVersion = Math.max(0, ...applied.keys());
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of sorted) {
    const sum = checksum(migration.statements);
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== sum) {
        throw new MigrationChecksumError(migration.version, migration.name);
      }
      continue;
    }
    const previous = Math.max(0, ...applied.keys());
    if (migration.version !== previous + 1) {
      throw new MigrationIntegrityError(
        `Expected migration ${previous + 1}, received ${migration.version}`,
      );
    }

    if (migration.foreignKeysOff) {
      // Must be set outside a transaction, and restored before the next
      // migration/operation regardless of success.
      await client.execute('PRAGMA foreign_keys = OFF');
    }
    const transaction = await client.transaction('write');
    try {
      for (const statement of migration.statements) {
        await transaction.execute(statement);
      }
      await transaction.execute({
        sql: 'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        args: [migration.version, migration.name, sum, new Date().toISOString()],
      });
      await transaction.commit();
      applied.set(migration.version, { name: migration.name, checksum: sum });
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      if (migration.foreignKeysOff) {
        await client.execute('PRAGMA foreign_keys = ON');
      }
    }
  }

  return {
    fromVersion,
    toVersion: Math.max(0, ...applied.keys()),
    applied: sorted
      .filter((migration) => !appliedRows.rows.some((row) => integer(row, 'version') === migration.version))
      .map((migration) => ({ version: migration.version, name: migration.name })),
  };
}

async function backupBeforeMigrations(
  client: Client,
  path: string,
  migrations: readonly Migration[],
): Promise<string | null> {
  try {
    const info = await fileStat(path);
    if (!info.size) return null;
  } catch {
    return null; // First run: nothing to protect.
  }

  let current = 0;
  try {
    const result = await client.execute('SELECT MAX(version) AS version FROM schema_migrations');
    current = result.rows[0] ? integer(result.rows[0], 'version') : 0;
  } catch {
    current = 0;
  }
  // A file that has no applied migrations is a first run (or a crash before the
  // first migration committed); there is no user schema to protect yet.
  if (current === 0) return null;
  if (!migrations.some((migration) => migration.version > current)) return null;

  const backupPath = `${path}.backup-v${current}`;
  await rm(backupPath, { force: true });
  // VACUUM INTO uses the live connection, so uncommitted WAL pages are included.
  await client.execute(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  return backupPath;
}

async function restoreFromBackup(path: string, backupPath: string): Promise<void> {
  // Stale WAL/SHM files from the failed run must not be replayed over the copy.
  await rm(`${path}-wal`, { force: true });
  await rm(`${path}-shm`, { force: true });
  // libsql can keep the failed connection's file handles open after close().
  // Copy into a sibling file and replace the directory entry atomically, so the
  // fresh database gets a new inode instead of being written through an inode
  // that SQLite may still hold locked (observed as SQLITE_BUSY on reopen).
  const staging = `${path}.restore`;
  await copyFile(backupPath, staging);
  try {
    await rename(staging, path);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

export class StatocystDatabase {
  private constructor(
    private readonly client: Client,
    private readonly idFactory: () => string,
  ) {}

  static async open(options: OpenDatabaseOptions): Promise<StatocystDatabase> {
    await mkdir(dirname(options.path), { recursive: true });
    const migrations = options.migrations ?? MIGRATIONS;
    const client = createClient({ url: `file:${options.path}` });
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA synchronous = NORMAL');
    const database = new StatocystDatabase(client, options.idFactory ?? randomUUID);
    const backupPath =
      options.backupBeforeMigrate === false
        ? null
        : await backupBeforeMigrations(client, options.path, migrations);
    try {
      await runMigrations(client, migrations);
    } catch (error) {
      client.close();
      if (backupPath) {
        try {
          await restoreFromBackup(options.path, backupPath);
        } catch {
          // Keep the original failure visible; the backup path lets the user
          // recover the file manually.
        }
        throw new MigrationRecoveryError(error, backupPath);
      }
      throw error;
    }
    return database;
  }

  async close(): Promise<void> {
    this.client.close();
  }

  async integrityCheck(): Promise<'ok' | 'failed'> {
    const result = await this.client.execute('PRAGMA integrity_check');
    const value = result.rows[0] ? text(result.rows[0], 'integrity_check') : 'failed';
    return value === 'ok' ? 'ok' : 'failed';
  }

  async schemaVersion(): Promise<number> {
    try {
      const result = await this.client.execute('SELECT MAX(version) AS version FROM schema_migrations');
      return result.rows[0] ? integer(result.rows[0], 'version') : 0;
    } catch {
      return 0;
    }
  }

  async journalMode(): Promise<string> {
    const result = await this.client.execute('PRAGMA journal_mode');
    return text(result.rows[0], 'journal_mode');
  }

  /** Number of rows violating a foreign key (0 is healthy). */
  async foreignKeyCheck(): Promise<number> {
    const result = await this.client.execute('PRAGMA foreign_key_check');
    return result.rows.length;
  }

  async upsertSource(input: {
    kind: 'local' | 'demo' | 'jellyfin' | 'podcast';
    label: string;
    rootPath: string | null;
  }): Promise<StoredMediaSource> {
    const existing =
      input.rootPath === null
        ? null
        : (
            await this.client.execute({
              sql: 'SELECT * FROM media_source WHERE kind = ? AND root_path = ?',
              args: [input.kind, input.rootPath],
            })
          ).rows[0];
    if (existing) {
      return {
        id: text(existing, 'id'),
        kind: text(existing, 'kind') as StoredMediaSource['kind'],
        label: text(existing, 'label'),
        rootPath: nullableText(existing, 'root_path'),
        createdAt: text(existing, 'created_at'),
      };
    }
    const id = this.idFactory();
    const createdAt = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT INTO media_source (id, kind, label, root_path, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, input.kind, input.label, input.rootPath, createdAt],
    });
    return { id, kind: input.kind, label: input.label, rootPath: input.rootPath, createdAt };
  }

  /**
   * One deterministic source row for every podcast episode. `media_source` has a
   * nullable root_path, so the normal upsert-by-root path cannot deduplicate it.
   */
  async ensurePodcastSource(): Promise<StoredMediaSource> {
    const existing = await this.getSource('podcast');
    if (existing) return existing;
    const createdAt = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO media_source (id, kind, label, root_path, created_at)
            VALUES ('podcast', 'podcast', 'Podcasts', NULL, ?)`,
      args: [createdAt],
    });
    const created = await this.getSource('podcast');
    if (!created) throw new Error('Could not create the podcast media source');
    return created;
  }

  async getSource(id: string): Promise<StoredMediaSource | null> {
    const row = (
      await this.client.execute({ sql: 'SELECT * FROM media_source WHERE id = ?', args: [id] })
    ).rows[0];
    if (!row) return null;
    return {
      id: text(row, 'id'),
      kind: text(row, 'kind') as StoredMediaSource['kind'],
      label: text(row, 'label'),
      rootPath: nullableText(row, 'root_path'),
      createdAt: text(row, 'created_at'),
    };
  }

  async upsertTrack(input: TrackUpsert): Promise<TrackUpsertResult> {
    return this.upsertTrackWith(this.client, input);
  }

  private async upsertTrackWith(
    executor: Pick<Client, 'execute'>,
    input: TrackUpsert,
  ): Promise<TrackUpsertResult> {
    const existing = (
      await executor.execute({
        sql: 'SELECT id FROM media_item WHERE path_key = ?',
        args: [input.pathKey],
      })
    ).rows[0];
    const now = new Date().toISOString();
    const mediaKind = input.mediaKind ?? 'music';
    const mediaForm = input.mediaForm ?? 'audio';
    if (existing) {
      const id = text(existing, 'id');
      await executor.execute({
        sql: `UPDATE media_item SET
          source_id = ?, path = ?, file_name = ?, ext = ?, size_bytes = ?, mtime_ms = ?,
          title = ?, artist = ?, album = ?, album_artist = ?, track_no = ?, disc_no = ?,
          year = ?, genre = ?, duration_ms = ?, bitrate = ?, sample_rate = ?, channels = ?,
          codec = ?, format = ?, artwork_path = ?, jellyfin_image_tag = ?, media_kind = ?,
          media_form = ?, updated_at = ?, missing = 0
          WHERE id = ?`,
        args: [
          input.sourceId,
          input.path,
          input.fileName,
          input.ext,
          input.sizeBytes,
          input.mtimeMs,
          input.title,
          input.artist,
          input.album,
          input.albumArtist ?? null,
          input.trackNo ?? null,
          input.discNo ?? null,
          input.year ?? null,
          input.genre ?? null,
          input.durationMs,
          input.bitrate ?? null,
          input.sampleRate ?? null,
          input.channels ?? null,
          input.codec ?? null,
          input.format ?? null,
          input.artworkPath ?? null,
          input.jellyfinImageTag ?? null,
          mediaKind,
          mediaForm,
          now,
          id,
        ],
      });
      return { track: await this.getTrackWith(executor, id), duplicate: true };
    }

    const id = input.id ?? this.idFactory();
    await executor.execute({
      sql: `INSERT INTO media_item (
        id, source_id, path, path_key, file_name, ext, size_bytes, mtime_ms,
        title, artist, album, album_artist, track_no, disc_no, year, genre,
        duration_ms, bitrate, sample_rate, channels, codec, format, artwork_path,
        jellyfin_image_tag, media_kind, media_form, added_at, updated_at, missing
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        id,
        input.sourceId,
        input.path,
        input.pathKey,
        input.fileName,
        input.ext,
        input.sizeBytes,
        input.mtimeMs,
        input.title,
        input.artist,
        input.album,
        input.albumArtist ?? null,
        input.trackNo ?? null,
        input.discNo ?? null,
        input.year ?? null,
        input.genre ?? null,
        input.durationMs,
        input.bitrate ?? null,
        input.sampleRate ?? null,
        input.channels ?? null,
        input.codec ?? null,
        input.format ?? null,
        input.artworkPath ?? null,
        input.jellyfinImageTag ?? null,
        mediaKind,
        mediaForm,
        now,
        now,
      ],
    });
    return { track: await this.getTrackWith(executor, id), duplicate: false };
  }

  private async getTrackWith(
    executor: Pick<Client, 'execute'>,
    id: string,
  ): Promise<StoredTrack> {
    const row = (
      await executor.execute({
        sql: `${TRACK_SELECT} WHERE m.id = ?`,
        args: [id],
      })
    ).rows[0];
    if (!row) throw new Error(`Track ${id} does not exist`);
    return toTrack(row);
  }

  async getTrack(id: string): Promise<StoredTrack> {
    return this.getTrackWith(this.client, id);
  }

  async findTrackByPathKey(pathKey: string): Promise<StoredTrack | null> {
    const row = (
      await this.client.execute({
        sql: `${TRACK_SELECT} WHERE m.path_key = ?`,
        args: [pathKey],
      })
    ).rows[0];
    return row ? toTrack(row) : null;
  }

  async listTracks(): Promise<StoredTrack[]> {
    return this.listTracksByKind('music');
  }

  /** All media kinds. Used by playback when it needs both contexts; music views use listTracks(). */
  async listAllTracks(): Promise<StoredTrack[]> {
    const result = await this.client.execute(
      `${TRACK_SELECT} ORDER BY m.artist, m.album, m.disc_no, m.track_no, m.title`,
    );
    return result.rows.map(toTrack);
  }

  async listTracksByKind(kind: MediaKind): Promise<StoredTrack[]> {
    const result = await this.client.execute({
      sql: `${TRACK_SELECT} WHERE m.media_kind = ?
            ORDER BY m.artist, m.album, m.disc_no, m.track_no, m.title`,
      args: [kind],
    });
    return result.rows.map(toTrack);
  }

  async removeTrack(id: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'DELETE FROM media_item WHERE id = ?',
      args: [id],
    });
    return (result.rowsAffected ?? 0) > 0;
  }

  async markMissing(id: string, missing: boolean): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE media_item SET missing = ?, updated_at = ? WHERE id = ?',
      args: [missing ? 1 : 0, new Date().toISOString(), id],
    });
  }

  async markPlayed(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute({
      sql: 'UPDATE media_item SET last_played_at = ?, play_count = play_count + 1 WHERE id = ?',
      args: [now, id],
    });
  }

  async stats(): Promise<LibraryStatsRecord> {
    const row = (
      await this.client.execute(`
        SELECT
          COUNT(*) AS tracks,
          COUNT(DISTINCT album) AS albums,
          COUNT(DISTINCT artist) AS artists,
          COALESCE(SUM(duration_ms), 0) AS duration_ms,
          COALESCE(SUM(missing), 0) AS missing
        FROM media_item
        WHERE media_kind = 'music'
      `)
    ).rows[0];
    return {
      tracks: integer(row, 'tracks'),
      albums: integer(row, 'albums'),
      artists: integer(row, 'artists'),
      durationMs: integer(row, 'duration_ms'),
      missing: integer(row, 'missing'),
    };
  }

  async saveQueue(entries: readonly StoredQueueEntry[]): Promise<void> {
    const transaction = await this.client.transaction('write');
    try {
      await transaction.execute('DELETE FROM queue_entry');
      const now = new Date().toISOString();
      const statements: InStatement[] = entries.map((entry, index) => ({
        sql: 'INSERT INTO queue_entry (entry_id, media_item_id, position, added_at) VALUES (?, ?, ?, ?)',
        args: [entry.entryId, entry.trackId, index, now],
      }));
      for (const statement of statements) {
        await transaction.execute(statement);
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async loadQueue(): Promise<StoredQueueEntry[]> {
    const result = await this.client.execute(
      'SELECT entry_id, media_item_id FROM queue_entry ORDER BY position ASC',
    );
    return result.rows.map((row) => ({
      entryId: text(row, 'entry_id'),
      trackId: text(row, 'media_item_id'),
    }));
  }

  async savePlaybackState(state: StoredPlaybackState): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO playback_state (id, current_entry_id, position_ms, shuffle, repeat, active_context, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              current_entry_id = excluded.current_entry_id,
              position_ms = excluded.position_ms,
              shuffle = excluded.shuffle,
              repeat = excluded.repeat,
              active_context = excluded.active_context,
              updated_at = excluded.updated_at`,
      args: [
        state.currentEntryId,
        Math.max(0, Math.round(state.positionMs)),
        state.shuffle ? 1 : 0,
        state.repeat,
        state.activeContext,
        new Date().toISOString(),
      ],
    });
  }

  async loadPlaybackState(): Promise<StoredPlaybackState> {
    const row = (
      await this.client.execute(
        'SELECT current_entry_id, position_ms, shuffle, repeat, active_context FROM playback_state WHERE id = 1',
      )
    ).rows[0];
    if (!row) {
      return {
        currentEntryId: null,
        positionMs: 0,
        shuffle: false,
        repeat: 'off',
        activeContext: 'music',
      };
    }
    return {
      currentEntryId: nullableText(row, 'current_entry_id'),
      positionMs: Math.max(0, integer(row, 'position_ms')),
      shuffle: bool(row, 'shuffle'),
      repeat: text(row, 'repeat') as RepeatMode,
      activeContext: (nullableText(row, 'active_context') as PlaybackContext | null) ?? 'music',
    };
  }

  async getAppState(key: string): Promise<string | null> {
    const row = (
      await this.client.execute({ sql: 'SELECT value FROM app_state WHERE key = ?', args: [key] })
    ).rows[0];
    return row ? text(row, 'value') : null;
  }

  async setAppState(key: string, value: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [key, value, new Date().toISOString()],
    });
  }

  async removeAppState(key: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM app_state WHERE key = ?', args: [key] });
  }

  async countQueueEntries(): Promise<number> {
    const row = (await this.client.execute('SELECT COUNT(*) AS c FROM queue_entry')).rows[0];
    return integer(row, 'c');
  }

  async tableColumns(table: string): Promise<string[]> {
    const result = await this.client.execute(`PRAGMA table_info(${table})`);
    return result.rows.map((row) => text(row, 'name'));
  }

  async saveDownload(input: {
    trackId: string;
    localPath: string;
    sizeBytes: number;
    sha256: string;
    container: string | null;
    verified: boolean;
  }): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO download (track_id, local_path, size_bytes, sha256, container, verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(track_id) DO UPDATE SET
              local_path = excluded.local_path,
              size_bytes = excluded.size_bytes,
              sha256 = excluded.sha256,
              container = excluded.container,
              verified = excluded.verified`,
      args: [
        input.trackId,
        input.localPath,
        input.sizeBytes,
        input.sha256,
        input.container,
        input.verified ? 1 : 0,
        new Date().toISOString(),
      ],
    });
  }

  async getDownload(trackId: string): Promise<StoredDownload | null> {
    const row = (
      await this.client.execute({ sql: 'SELECT * FROM download WHERE track_id = ?', args: [trackId] })
    ).rows[0];
    return row ? this.toDownload(row) : null;
  }

  async listDownloads(): Promise<StoredDownload[]> {
    const result = await this.client.execute('SELECT * FROM download ORDER BY created_at ASC');
    return result.rows.map((row) => this.toDownload(row));
  }

  async removeDownload(trackId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'DELETE FROM download WHERE track_id = ?',
      args: [trackId],
    });
    return (result.rowsAffected ?? 0) > 0;
  }

  private toDownload(row: Row): StoredDownload {
    return {
      trackId: text(row, 'track_id'),
      localPath: text(row, 'local_path'),
      sizeBytes: integer(row, 'size_bytes'),
      sha256: text(row, 'sha256'),
      container: nullableText(row, 'container'),
      verified: bool(row, 'verified'),
      createdAt: text(row, 'created_at'),
    };
  }

  async saveCacheEntry(input: {
    trackId: string;
    localPath: string;
    sizeBytes: number;
  }): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO cache_entry (track_id, local_path, size_bytes, last_access_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(track_id) DO UPDATE SET
              local_path = excluded.local_path,
              size_bytes = excluded.size_bytes,
              last_access_at = excluded.last_access_at`,
      args: [input.trackId, input.localPath, input.sizeBytes, new Date().toISOString()],
    });
  }

  async touchCacheEntry(trackId: string): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE cache_entry SET last_access_at = ? WHERE track_id = ?',
      args: [new Date().toISOString(), trackId],
    });
  }

  async listCacheEntries(): Promise<StoredCacheEntry[]> {
    const result = await this.client.execute(
      'SELECT * FROM cache_entry ORDER BY last_access_at ASC',
    );
    return result.rows.map((row) => ({
      trackId: text(row, 'track_id'),
      localPath: text(row, 'local_path'),
      sizeBytes: integer(row, 'size_bytes'),
      lastAccessAt: text(row, 'last_access_at'),
    }));
  }

  async removeCacheEntry(trackId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'DELETE FROM cache_entry WHERE track_id = ?',
      args: [trackId],
    });
    return (result.rowsAffected ?? 0) > 0;
  }

  // ---------------------------------------------------------------- podcasts

  async listPodcastFeeds(): Promise<StoredPodcastFeed[]> {
    const result = await this.client.execute(
      `${PODCAST_FEED_SELECT} ORDER BY f.title COLLATE NOCASE ASC`,
    );
    return result.rows.map(toPodcastFeed);
  }

  async getPodcastFeed(id: string): Promise<StoredPodcastFeed | null> {
    const row = (
      await this.client.execute({
        sql: `${PODCAST_FEED_SELECT} WHERE f.id = ?`,
        args: [id],
      })
    ).rows[0];
    return row ? toPodcastFeed(row) : null;
  }

  async getPodcastFeedByUrl(feedUrl: string): Promise<StoredPodcastFeed | null> {
    const row = (
      await this.client.execute({
        sql: `${PODCAST_FEED_SELECT} WHERE f.feed_url = ?`,
        args: [feedUrl],
      })
    ).rows[0];
    return row ? toPodcastFeed(row) : null;
  }

  async upsertPodcastFeed(input: PodcastFeedUpsert): Promise<StoredPodcastFeed> {
    const existing = (
      await this.client.execute({
        sql: 'SELECT * FROM podcast_feed WHERE feed_url = ?',
        args: [input.feedUrl],
      })
    ).rows[0];
    const now = new Date().toISOString();
    const categories = JSON.stringify(input.categories ?? []);
    if (existing) {
      const id = text(existing, 'id');
      await this.client.execute({
        sql: `UPDATE podcast_feed SET
          resolved_url = ?, site_url = ?, title = ?, author = ?, description_text = ?,
          image_url = ?, artwork_path = ?, language = ?, explicit = ?, categories_json = ?,
          feed_type = ?, podcast_index_id = ?, etag = ?, last_modified = ?,
          last_fetched_at = ?, last_success_at = ?, next_fetch_at = ?, fetch_error = ?,
          failure_count = ?, refresh_interval_minutes = ?, default_speed = ?,
          skip_intro_seconds = ?, skip_outro_seconds = ?, auto_queue = ?, episode_sort = ?,
          default_media_form = ?, subscribed = ?, updated_at = ?
          WHERE id = ?`,
        args: [
          input.resolvedUrl ?? nullableText(existing, 'resolved_url'),
          input.siteUrl ?? nullableText(existing, 'site_url'),
          input.title,
          input.author ?? nullableText(existing, 'author'),
          input.descriptionText ?? nullableText(existing, 'description_text'),
          input.imageUrl ?? nullableText(existing, 'image_url'),
          input.artworkPath ?? nullableText(existing, 'artwork_path'),
          input.language ?? nullableText(existing, 'language'),
          (input.explicit ?? bool(existing, 'explicit')) ? 1 : 0,
          categories === '[]' ? nullableText(existing, 'categories_json') ?? '[]' : categories,
          input.feedType,
          input.podcastIndexId ?? nullableInteger(existing, 'podcast_index_id'),
          input.etag ?? nullableText(existing, 'etag'),
          input.lastModified ?? nullableText(existing, 'last_modified'),
          input.lastFetchedAt ?? nullableText(existing, 'last_fetched_at'),
          input.lastSuccessAt ?? nullableText(existing, 'last_success_at'),
          input.nextFetchAt ?? nullableText(existing, 'next_fetch_at'),
          input.fetchError ?? nullableText(existing, 'fetch_error'),
          input.failureCount ?? integer(existing, 'failure_count'),
          input.refreshIntervalMinutes ?? integer(existing, 'refresh_interval_minutes'),
          input.defaultSpeed ?? nullableNumber(existing, 'default_speed') ?? 1,
          input.skipIntroSeconds ?? integer(existing, 'skip_intro_seconds'),
          input.skipOutroSeconds ?? integer(existing, 'skip_outro_seconds'),
          (input.autoQueue ?? bool(existing, 'auto_queue')) ? 1 : 0,
          input.episodeSort ?? text(existing, 'episode_sort'),
          input.defaultMediaForm ?? nullableText(existing, 'default_media_form') ?? 'audio',
          (input.subscribed ?? bool(existing, 'subscribed')) ? 1 : 0,
          now,
          id,
        ],
      });
      const updated = await this.getPodcastFeed(id);
      if (!updated) throw new Error(`Podcast feed ${id} disappeared during update`);
      return updated;
    }

    const id = input.id ?? this.idFactory();
    await this.client.execute({
      sql: `INSERT INTO podcast_feed (
        id, feed_url, resolved_url, site_url, title, author, description_text,
        image_url, artwork_path, language, explicit, categories_json, feed_type,
        podcast_index_id, etag, last_modified, last_fetched_at, last_success_at,
        next_fetch_at, fetch_error, failure_count, refresh_interval_minutes,
        default_speed, skip_intro_seconds, skip_outro_seconds, auto_queue,
        episode_sort, default_media_form, subscribed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.feedUrl,
        input.resolvedUrl ?? null,
        input.siteUrl ?? null,
        input.title,
        input.author ?? null,
        input.descriptionText ?? null,
        input.imageUrl ?? null,
        input.artworkPath ?? null,
        input.language ?? null,
        input.explicit ? 1 : 0,
        categories,
        input.feedType,
        input.podcastIndexId ?? null,
        input.etag ?? null,
        input.lastModified ?? null,
        input.lastFetchedAt ?? null,
        input.lastSuccessAt ?? null,
        input.nextFetchAt ?? null,
        input.fetchError ?? null,
        input.failureCount ?? 0,
        input.refreshIntervalMinutes ?? 60,
        input.defaultSpeed ?? 1,
        input.skipIntroSeconds ?? 0,
        input.skipOutroSeconds ?? 0,
        input.autoQueue === false ? 0 : 1,
        input.episodeSort ?? 'newest',
        input.defaultMediaForm ?? 'audio',
        input.subscribed === false ? 0 : 1,
        now,
        now,
      ],
    });
    const created = await this.getPodcastFeed(id);
    if (!created) throw new Error(`Podcast feed ${id} was not created`);
    return created;
  }

  async updatePodcastFeed(
    id: string,
    patch: PodcastFeedPatch,
  ): Promise<StoredPodcastFeed> {
    const sets: string[] = [];
    const args: Array<string | number> = [];
    const add = (column: string, value: string | number): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (patch.title !== undefined) add('title', patch.title.trim() || 'Untitled podcast');
    if (patch.refreshIntervalMinutes !== undefined) {
      add('refresh_interval_minutes', Math.round(patch.refreshIntervalMinutes));
    }
    if (patch.defaultSpeed !== undefined) add('default_speed', patch.defaultSpeed);
    if (patch.skipIntroSeconds !== undefined) {
      add('skip_intro_seconds', Math.round(patch.skipIntroSeconds));
    }
    if (patch.skipOutroSeconds !== undefined) {
      add('skip_outro_seconds', Math.round(patch.skipOutroSeconds));
    }
    if (patch.defaultMediaForm !== undefined) add('default_media_form', patch.defaultMediaForm);
    if (patch.autoQueue !== undefined) add('auto_queue', patch.autoQueue ? 1 : 0);
    if (patch.episodeSort !== undefined) add('episode_sort', patch.episodeSort);
    if (patch.subscribed !== undefined) add('subscribed', patch.subscribed ? 1 : 0);
    add('updated_at', new Date().toISOString());
    args.push(id);
    await this.client.execute({
      sql: `UPDATE podcast_feed SET ${sets.join(', ')} WHERE id = ?`,
      args,
    });
    const updated = await this.getPodcastFeed(id);
    if (!updated) throw new Error(`Podcast feed ${id} does not exist`);
    return updated;
  }

  async removePodcastFeed(id: string): Promise<boolean> {
    const transaction = await this.client.transaction('write');
    try {
      const mediaIds = (
        await transaction.execute({
          sql: 'SELECT media_item_id FROM podcast_episode WHERE feed_id = ?',
          args: [id],
        })
      ).rows.map((row) => text(row, 'media_item_id'));
      for (const mediaItemId of mediaIds) {
        await transaction.execute({
          sql: 'DELETE FROM media_item WHERE id = ?',
          args: [mediaItemId],
        });
      }
      const result = await transaction.execute({
        sql: 'DELETE FROM podcast_feed WHERE id = ?',
        args: [id],
      });
      await transaction.commit();
      return (result.rowsAffected ?? 0) > 0;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async savePodcastEpisodes(
    feedId: string,
    episodes: readonly PodcastEpisodeUpsert[],
  ): Promise<PodcastEpisodeSaveResult[]> {
    const feed = await this.getPodcastFeed(feedId);
    if (!feed) throw new Error(`Podcast feed ${feedId} does not exist`);
    const source = await this.ensurePodcastSource();
    const transaction = await this.client.transaction('write');
    const results: PodcastEpisodeSaveResult[] = [];
    try {
      for (const episode of episodes) {
        const now = new Date().toISOString();
        const ext = extensionForEnclosure(episode.enclosureType ?? null, episode.enclosureUrl);
        const durationMs = Math.max(0, Math.round(episode.durationMs ?? 0));
        const media = await this.upsertTrackWith(transaction, {
          sourceId: source.id,
          path: episode.enclosureUrl,
          pathKey:
            episode.pathKey ?? podcastMediaPathKey(feed.feedUrl, episode.guid),
          fileName: `${episode.title}.${ext}`,
          ext,
          sizeBytes: Math.max(0, Math.round(episode.enclosureLengthBytes ?? 0)),
          mtimeMs: 0,
          title: episode.title,
          artist: feed.title,
          album: feed.title,
          albumArtist: feed.author ?? feed.title,
          trackNo: episode.episodeNo ?? null,
          discNo: episode.seasonNo ?? null,
          year: yearForPublishedAt(episode.publishedAt ?? null),
          genre: 'Podcast',
          durationMs,
          bitrate: null,
          sampleRate: null,
          channels: null,
          codec: episode.enclosureType ?? null,
          format: episode.enclosureType ?? null,
          artworkPath: episode.artworkPath ?? feed.artworkPath,
          jellyfinImageTag: null,
          mediaKind: 'podcast',
          mediaForm: episode.mediaForm ?? 'audio',
        });
        const episodeId = episode.id ?? this.idFactory();
        await transaction.execute({
          sql: `INSERT INTO podcast_episode (
            id, feed_id, media_item_id, guid, title, description_text, links_json, link,
            enclosure_url, enclosure_type, enclosure_length_bytes, media_form, alternates_json,
            poster_url, video_width, video_height, duration_ms, published_at,
            season_no, episode_no, episode_type, image_url, artwork_path, explicit,
            chapters_url, transcript_url, transcript_type, first_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(feed_id, guid) DO UPDATE SET
            media_item_id = excluded.media_item_id,
            title = excluded.title,
            description_text = excluded.description_text,
            links_json = excluded.links_json,
            link = excluded.link,
            enclosure_url = excluded.enclosure_url,
            enclosure_type = excluded.enclosure_type,
            enclosure_length_bytes = excluded.enclosure_length_bytes,
            media_form = excluded.media_form,
            alternates_json = excluded.alternates_json,
            poster_url = excluded.poster_url,
            video_width = excluded.video_width,
            video_height = excluded.video_height,
            duration_ms = excluded.duration_ms,
            published_at = excluded.published_at,
            season_no = excluded.season_no,
            episode_no = excluded.episode_no,
            episode_type = excluded.episode_type,
            image_url = excluded.image_url,
            artwork_path = excluded.artwork_path,
            explicit = excluded.explicit,
            chapters_url = excluded.chapters_url,
            transcript_url = excluded.transcript_url,
            transcript_type = excluded.transcript_type,
            updated_at = excluded.updated_at`,
          args: [
            episodeId,
            feedId,
            media.track.id,
            episode.guid,
            episode.title,
            episode.descriptionText ?? null,
            JSON.stringify(episode.links ?? []),
            episode.link ?? null,
            episode.enclosureUrl,
            episode.enclosureType ?? null,
            episode.enclosureLengthBytes ?? null,
            episode.mediaForm ?? 'audio',
            JSON.stringify((episode.alternates ?? []).slice(0, 8)),
            episode.posterUrl ?? null,
            episode.videoWidth ?? null,
            episode.videoHeight ?? null,
            durationMs,
            episode.publishedAt ?? null,
            episode.seasonNo ?? null,
            episode.episodeNo ?? null,
            episode.episodeType ?? null,
            episode.imageUrl ?? null,
            episode.artworkPath ?? null,
            episode.explicit ? 1 : 0,
            episode.chaptersUrl ?? null,
            episode.transcriptUrl ?? null,
            episode.transcriptType ?? null,
            episode.firstSeenAt ?? now,
            now,
            now,
          ],
        });
        const stored = (
          await transaction.execute({
            sql: 'SELECT id FROM podcast_episode WHERE feed_id = ? AND guid = ?',
            args: [feedId, episode.guid],
          })
        ).rows[0];
        if (!stored) throw new Error(`Podcast episode ${episode.guid} was not saved`);
        results.push({
          episodeId: text(stored, 'id'),
          mediaItemId: media.track.id,
          duplicate: media.duplicate,
        });
      }
      await transaction.commit();
      return results;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async listPodcastEpisodes(
    feedId: string | null,
    options: { limit?: number; offset?: number; sort?: 'newest' | 'oldest' } = {},
  ): Promise<StoredPodcastEpisode[]> {
    const order = options.sort === 'oldest' ? 'ASC' : 'DESC';
    const args: Array<string | number> = [];
    let sql = PODCAST_EPISODE_SELECT;
    if (feedId) {
      sql += ' WHERE pe.feed_id = ?';
      args.push(feedId);
    }
    sql += ` ORDER BY COALESCE(pe.published_at, pe.first_seen_at) ${order}, pe.created_at ${order}`;
    if (options.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?';
      args.push(Math.max(1, Math.min(1_000, Math.round(options.limit))));
      args.push(Math.max(0, Math.round(options.offset ?? 0)));
    } else if (options.offset !== undefined && options.offset > 0) {
      sql += ' LIMIT -1 OFFSET ?';
      args.push(Math.round(options.offset));
    }
    const result = await this.client.execute({ sql, args });
    return result.rows.map(toPodcastEpisode);
  }

  async getPodcastEpisode(id: string): Promise<StoredPodcastEpisode | null> {
    const row = (
      await this.client.execute({
        sql: `${PODCAST_EPISODE_SELECT} WHERE pe.id = ?`,
        args: [id],
      })
    ).rows[0];
    return row ? toPodcastEpisode(row) : null;
  }

  async getPodcastEpisodeByMediaItemId(
    mediaItemId: string,
  ): Promise<StoredPodcastEpisode | null> {
    const row = (
      await this.client.execute({
        sql: `${PODCAST_EPISODE_SELECT} WHERE pe.media_item_id = ?`,
        args: [mediaItemId],
      })
    ).rows[0];
    return row ? toPodcastEpisode(row) : null;
  }

  async setPodcastEpisodePlayed(id: string, played: boolean): Promise<void> {
    await this.client.execute({
      sql: `UPDATE podcast_episode SET
        played = ?, completed = ?, resume_position_ms = 0, updated_at = ?
        WHERE id = ?`,
      args: [played ? 1 : 0, played ? 1 : 0, new Date().toISOString(), id],
    });
  }

  async setPodcastEpisodeResume(id: string, positionMs: number): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE podcast_episode SET resume_position_ms = ?, updated_at = ? WHERE id = ?',
      args: [Math.max(0, Math.round(positionMs)), new Date().toISOString(), id],
    });
  }

  async markPodcastEpisodeStarted(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute({
      sql: `UPDATE podcast_episode SET
        last_played_at = ?, play_count = play_count + 1, updated_at = ?
        WHERE id = ?`,
      args: [now, now, id],
    });
  }

  async savePodcastQueue(entries: readonly StoredPodcastQueueEntry[]): Promise<void> {
    const transaction = await this.client.transaction('write');
    try {
      await transaction.execute('DELETE FROM podcast_queue_entry');
      const now = new Date().toISOString();
      for (const [index, entry] of entries.entries()) {
        await transaction.execute({
          sql: `INSERT INTO podcast_queue_entry (entry_id, episode_id, position, added_at)
                VALUES (?, ?, ?, ?)`,
          args: [entry.entryId, entry.episodeId, index, now],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async loadPodcastQueue(): Promise<StoredPodcastQueueEntry[]> {
    const result = await this.client.execute(
      'SELECT entry_id, episode_id FROM podcast_queue_entry ORDER BY position ASC',
    );
    return result.rows.map((row) => ({
      entryId: text(row, 'entry_id'),
      episodeId: text(row, 'episode_id'),
    }));
  }

  async savePodcastPlaybackState(state: StoredPodcastPlaybackState): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO podcast_playback_state (id, current_entry_id, position_ms, speed, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              current_entry_id = excluded.current_entry_id,
              position_ms = excluded.position_ms,
              speed = excluded.speed,
              updated_at = excluded.updated_at`,
      args: [
        state.currentEntryId,
        Math.max(0, Math.round(state.positionMs)),
        Number.isFinite(state.speed) && state.speed > 0 ? state.speed : 1,
        new Date().toISOString(),
      ],
    });
  }

  async loadPodcastPlaybackState(): Promise<StoredPodcastPlaybackState> {
    const row = (
      await this.client.execute(
        'SELECT current_entry_id, position_ms, speed FROM podcast_playback_state WHERE id = 1',
      )
    ).rows[0];
    if (!row) return { currentEntryId: null, positionMs: 0, speed: 1 };
    return {
      currentEntryId: nullableText(row, 'current_entry_id'),
      positionMs: Math.max(0, integer(row, 'position_ms')),
      speed: nullableNumber(row, 'speed') ?? 1,
    };
  }

  async podcastEpisodeCount(): Promise<number> {
    const row = (await this.client.execute('SELECT COUNT(*) AS c FROM podcast_episode')).rows[0];
    return integer(row, 'c');
  }

  async updatePodcastFeedFetchState(
    feedId: string,
    state: PodcastFetchState,
  ): Promise<void> {
    await this.client.execute({
      sql: `UPDATE podcast_feed SET
        etag = COALESCE(?, etag),
        last_modified = COALESCE(?, last_modified),
        last_fetched_at = COALESCE(?, last_fetched_at),
        last_success_at = COALESCE(?, last_success_at),
        next_fetch_at = COALESCE(?, next_fetch_at),
        fetch_error = ?,
        failure_count = COALESCE(?, failure_count),
        updated_at = ?
        WHERE id = ?`,
      args: [
        state.etag ?? null,
        state.lastModified ?? null,
        state.lastFetchedAt ?? null,
        state.lastSuccessAt ?? null,
        state.nextFetchAt ?? null,
        state.fetchError ?? null,
        state.failureCount ?? null,
        new Date().toISOString(),
        feedId,
      ],
    });
  }

  async listDuePodcastFeeds(now = new Date().toISOString()): Promise<StoredPodcastFeed[]> {
    const result = await this.client.execute({
      sql: `${PODCAST_FEED_SELECT}
            WHERE f.subscribed = 1
              AND (f.next_fetch_at IS NULL OR f.next_fetch_at <= ?)
            ORDER BY f.next_fetch_at ASC`,
      args: [now],
    });
    return result.rows.map(toPodcastFeed);
  }

  async getPodcastDirectoryCache(
    provider: string,
    queryKey: string,
  ): Promise<StoredPodcastDirectoryCache | null> {
    const row = (
      await this.client.execute({
        sql: `SELECT payload_json, fetched_at, expires_at FROM podcast_directory_cache
              WHERE provider = ? AND query_key = ?`,
        args: [provider, queryKey],
      })
    ).rows[0];
    if (!row) return null;
    return {
      payloadJson: text(row, 'payload_json'),
      fetchedAt: text(row, 'fetched_at'),
      expiresAt: text(row, 'expires_at'),
    };
  }

  async savePodcastDirectoryCache(input: {
    provider: string;
    queryKey: string;
    payloadJson: string;
    fetchedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO podcast_directory_cache
              (id, provider, query_key, payload_json, fetched_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, query_key) DO UPDATE SET
              payload_json = excluded.payload_json,
              fetched_at = excluded.fetched_at,
              expires_at = excluded.expires_at`,
      args: [
        this.idFactory(),
        input.provider,
        input.queryKey,
        input.payloadJson,
        input.fetchedAt,
        input.expiresAt,
      ],
    });
  }

  async upsertJellyfinServer(input: {
    url: string;
    name: string;
    jellyfinId: string;
    version: string | null;
  }): Promise<StoredJellyfinServer> {
    const existing = (
      await this.client.execute({ sql: 'SELECT * FROM jellyfin_server WHERE url = ?', args: [input.url] })
    ).rows[0];
    const now = new Date().toISOString();
    if (existing) {
      const id = text(existing, 'id');
      await this.client.execute({
        sql: `UPDATE jellyfin_server SET name = ?, jellyfin_id = ?, version = ? WHERE id = ?`,
        args: [input.name, input.jellyfinId, input.version, id],
      });
      return {
        id,
        url: input.url,
        name: input.name,
        jellyfinId: input.jellyfinId,
        version: input.version,
        createdAt: text(existing, 'created_at'),
        lastConnectedAt: nullableText(existing, 'last_connected_at'),
      };
    }
    const id = this.idFactory();
    await this.client.execute({
      sql: `INSERT INTO jellyfin_server (id, url, name, jellyfin_id, version, created_at, last_connected_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      args: [id, input.url, input.name, input.jellyfinId, input.version, now],
    });
    return {
      id,
      url: input.url,
      name: input.name,
      jellyfinId: input.jellyfinId,
      version: input.version,
      createdAt: now,
      lastConnectedAt: null,
    };
  }

  async listJellyfinServers(): Promise<StoredJellyfinServer[]> {
    const result = await this.client.execute('SELECT * FROM jellyfin_server ORDER BY created_at ASC');
    return result.rows.map((row) => this.toJellyfinServer(row));
  }

  async getJellyfinServer(id: string): Promise<StoredJellyfinServer | null> {
    const row = (
      await this.client.execute({ sql: 'SELECT * FROM jellyfin_server WHERE id = ?', args: [id] })
    ).rows[0];
    return row ? this.toJellyfinServer(row) : null;
  }

  async touchJellyfinServer(id: string): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE jellyfin_server SET last_connected_at = ? WHERE id = ?',
      args: [new Date().toISOString(), id],
    });
  }

  async removeJellyfinServer(id: string): Promise<boolean> {
    const result = await this.client.execute({ sql: 'DELETE FROM jellyfin_server WHERE id = ?', args: [id] });
    return (result.rowsAffected ?? 0) > 0;
  }

  async saveJellyfinAccount(input: {
    serverId: string;
    userId: string;
    userName: string;
    tokenCiphertext: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT INTO jellyfin_account (server_id, user_id, user_name, token_ciphertext, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(server_id) DO UPDATE SET
              user_id = excluded.user_id,
              user_name = excluded.user_name,
              token_ciphertext = excluded.token_ciphertext,
              updated_at = excluded.updated_at`,
      args: [input.serverId, input.userId, input.userName, input.tokenCiphertext, now, now],
    });
  }

  async getJellyfinAccount(serverId: string): Promise<StoredJellyfinAccount | null> {
    const row = (
      await this.client.execute({
        sql: 'SELECT * FROM jellyfin_account WHERE server_id = ?',
        args: [serverId],
      })
    ).rows[0];
    if (!row) return null;
    return {
      serverId: text(row, 'server_id'),
      userId: text(row, 'user_id'),
      userName: text(row, 'user_name'),
      tokenCiphertext: text(row, 'token_ciphertext'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
    };
  }

  async removeJellyfinAccount(serverId: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM jellyfin_account WHERE server_id = ?', args: [serverId] });
  }

  private toJellyfinServer(row: Row): StoredJellyfinServer {
    return {
      id: text(row, 'id'),
      url: text(row, 'url'),
      name: text(row, 'name'),
      jellyfinId: text(row, 'jellyfin_id'),
      version: nullableText(row, 'version'),
      createdAt: text(row, 'created_at'),
      lastConnectedAt: nullableText(row, 'last_connected_at'),
    };
  }
}
