import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient, type Client, type InStatement, type Row } from '@libsql/client';
import type { RepeatMode, Track } from '@statocyst/contracts';
import { MIGRATIONS, type Migration } from './migrations';

export interface StoredMediaSource {
  id: string;
  kind: 'local' | 'demo' | 'jellyfin';
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
  sourceKind: 'local' | 'demo' | 'jellyfin';
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
}

export interface TrackUpsertResult {
  track: StoredTrack;
  duplicate: boolean;
}

export interface StoredQueueEntry {
  entryId: string;
  trackId: string;
}

export interface StoredPlaybackState {
  currentEntryId: string | null;
  positionMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
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
    artworkUrl: artworkPath ? `statocyst-art://track/${id}` : null,
    addedAt: text(row, 'added_at'),
    updatedAt: text(row, 'updated_at'),
    lastPlayedAt: nullableText(row, 'last_played_at'),
    playCount: integer(row, 'play_count'),
    missing: bool(row, 'missing'),
    sourceId: text(row, 'source_id'),
    sourceLabel: text(row, 'source_label'),
    sourceKind: text(row, 'source_kind') as StoredTrack['sourceKind'],
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

export class StatocystDatabase {
  private constructor(
    private readonly client: Client,
    private readonly idFactory: () => string,
  ) {}

  static async open(options: OpenDatabaseOptions): Promise<StatocystDatabase> {
    await mkdir(dirname(options.path), { recursive: true });
    const client = createClient({ url: `file:${options.path}` });
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute('PRAGMA busy_timeout = 5000');
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA synchronous = NORMAL');
    const database = new StatocystDatabase(client, options.idFactory ?? randomUUID);
    await runMigrations(client, options.migrations ?? MIGRATIONS);
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

  async upsertSource(input: {
    kind: 'local' | 'demo' | 'jellyfin';
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

  async upsertTrack(input: TrackUpsert): Promise<TrackUpsertResult> {
    const existing = (
      await this.client.execute({
        sql: 'SELECT id FROM media_item WHERE path_key = ?',
        args: [input.pathKey],
      })
    ).rows[0];
    const now = new Date().toISOString();
    if (existing) {
      const id = text(existing, 'id');
      await this.client.execute({
        sql: `UPDATE media_item SET
          source_id = ?, path = ?, file_name = ?, ext = ?, size_bytes = ?, mtime_ms = ?,
          title = ?, artist = ?, album = ?, album_artist = ?, track_no = ?, disc_no = ?,
          year = ?, genre = ?, duration_ms = ?, bitrate = ?, sample_rate = ?, channels = ?,
          codec = ?, format = ?, artwork_path = ?, updated_at = ?, missing = 0
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
          now,
          id,
        ],
      });
      return { track: await this.getTrack(id), duplicate: true };
    }

    const id = input.id ?? this.idFactory();
    await this.client.execute({
      sql: `INSERT INTO media_item (
        id, source_id, path, path_key, file_name, ext, size_bytes, mtime_ms,
        title, artist, album, album_artist, track_no, disc_no, year, genre,
        duration_ms, bitrate, sample_rate, channels, codec, format, artwork_path,
        added_at, updated_at, missing
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
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
        now,
        now,
      ],
    });
    return { track: await this.getTrack(id), duplicate: false };
  }

  async getTrack(id: string): Promise<StoredTrack> {
    const row = (
      await this.client.execute({
        sql: `${TRACK_SELECT} WHERE m.id = ?`,
        args: [id],
      })
    ).rows[0];
    if (!row) throw new Error(`Track ${id} does not exist`);
    return toTrack(row);
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
    const result = await this.client.execute(`${TRACK_SELECT} ORDER BY m.artist, m.album, m.disc_no, m.track_no, m.title`);
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
      sql: `INSERT INTO playback_state (id, current_entry_id, position_ms, shuffle, repeat, updated_at)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              current_entry_id = excluded.current_entry_id,
              position_ms = excluded.position_ms,
              shuffle = excluded.shuffle,
              repeat = excluded.repeat,
              updated_at = excluded.updated_at`,
      args: [
        state.currentEntryId,
        Math.max(0, Math.round(state.positionMs)),
        state.shuffle ? 1 : 0,
        state.repeat,
        new Date().toISOString(),
      ],
    });
  }

  async loadPlaybackState(): Promise<StoredPlaybackState> {
    const row = (
      await this.client.execute(
        'SELECT current_entry_id, position_ms, shuffle, repeat FROM playback_state WHERE id = 1',
      )
    ).rows[0];
    if (!row) {
      return { currentEntryId: null, positionMs: 0, shuffle: false, repeat: 'off' };
    }
    return {
      currentEntryId: nullableText(row, 'current_entry_id'),
      positionMs: Math.max(0, integer(row, 'position_ms')),
      shuffle: bool(row, 'shuffle'),
      repeat: text(row, 'repeat') as RepeatMode,
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

  async countQueueEntries(): Promise<number> {
    const row = (await this.client.execute('SELECT COUNT(*) AS c FROM queue_entry')).rows[0];
    return integer(row, 'c');
  }

  async tableColumns(table: string): Promise<string[]> {
    const result = await this.client.execute(`PRAGMA table_info(${table})`);
    return result.rows.map((row) => text(row, 'name'));
  }
}
