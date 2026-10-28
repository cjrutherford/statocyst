import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import {
  FORBIDDEN_CREDENTIAL_COLUMNS,
  MIGRATIONS,
  MigrationChecksumError,
  MigrationIntegrityError,
  MigrationRecoveryError,
  StatocystDatabase,
  runMigrations,
  type Migration,
  type TrackUpsert,
} from '../index';

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'statocyst-persistence-'));
  directories.push(directory);
  return directory;
}

function ids() {
  let counter = 0;
  return () => `id-${++counter}`;
}

const track = (overrides: Partial<TrackUpsert> = {}): TrackUpsert => ({
  sourceId: 'source-1',
  path: '/music/sonar-bloom.mp3',
  pathKey: '/music/sonar-bloom.mp3',
  fileName: 'sonar-bloom.mp3',
  ext: 'mp3',
  sizeBytes: 1024,
  mtimeMs: 1_700_000_000_000,
  title: 'Sonar Bloom',
  artist: 'Statocyst Ensemble',
  album: 'Bathypelagic Sessions',
  albumArtist: 'Statocyst Ensemble',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: 'Ambient',
  durationMs: 184_000,
  bitrate: 192_000,
  sampleRate: 44_100,
  channels: 2,
  codec: 'MP3',
  format: 'MPEG 1 Layer 3',
  artworkPath: null,
  ...overrides,
});

async function open(idFactory = ids()) {
  const directory = await tempDir();
  const path = join(directory, 'statocyst.db');
  const db = await StatocystDatabase.open({ path, idFactory });
  return { db, path, directory };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('libSQL desktop foundation', () => {
  it('runs the migration, reports WAL and passes integrity check', async () => {
    const { db } = await open();
    expect(await db.schemaVersion()).toBe(MIGRATIONS.length);
    expect(await db.journalMode()).toBe('wal');
    expect(await db.integrityCheck()).toBe('ok');
    await db.close();
  });

  it('persists a source and track across a real process-level reopen', async () => {
    const { db, path } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const inserted = await db.upsertTrack(track({ sourceId: source.id }));
    expect(inserted.duplicate).toBe(false);
    expect(inserted.track.title).toBe('Sonar Bloom');
    expect(inserted.track.sourceLabel).toBe('Music');
    expect(inserted.track.artworkUrl).toBeNull();
    await db.saveQueue([{ entryId: 'entry-1', trackId: inserted.track.id }]);
    await db.savePlaybackState({
      currentEntryId: 'entry-1',
      positionMs: 42_500,
      shuffle: true,
      repeat: 'all',
    });
    await db.setAppState('settings', JSON.stringify({ theme: 'dark' }));
    await db.close();

    const reopened = await StatocystDatabase.open({ path });
    const tracks = await reopened.listTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(inserted.track.id);
    expect(await reopened.loadQueue()).toEqual([
      { entryId: 'entry-1', trackId: inserted.track.id },
    ]);
    expect(await reopened.loadPlaybackState()).toEqual({
      currentEntryId: 'entry-1',
      positionMs: 42_500,
      shuffle: true,
      repeat: 'all',
    });
    expect(await reopened.getAppState('settings')).toBe(JSON.stringify({ theme: 'dark' }));
    await reopened.close();
  });

  it('deduplicates by path key while updating metadata', async () => {
    const { db } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const first = await db.upsertTrack(track({ sourceId: source.id }));
    const second = await db.upsertTrack(track({ sourceId: source.id, title: 'Sonar Bloom (Remastered)' }));
    expect(second.duplicate).toBe(true);
    expect(second.track.id).toBe(first.track.id);
    expect(second.track.title).toBe('Sonar Bloom (Remastered)');
    expect(await db.listTracks()).toHaveLength(1);
    await db.close();
  });

  it('reuses a media source for the same root path', async () => {
    const { db } = await open();
    const first = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const second = await db.upsertSource({ kind: 'local', label: 'Renamed', rootPath: '/music' });
    expect(second.id).toBe(first.id);
    expect(second.label).toBe('Music');
    await db.close();
  });

  it('cascades queue removal when a track is deleted', async () => {
    const { db } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const { track: stored } = await db.upsertTrack(track({ sourceId: source.id }));
    await db.saveQueue([
      { entryId: 'a', trackId: stored.id },
      { entryId: 'b', trackId: stored.id },
    ]);
    expect(await db.countQueueEntries()).toBe(2);
    expect(await db.removeTrack(stored.id)).toBe(true);
    expect(await db.countQueueEntries()).toBe(0);
    await db.close();
  });

  it('preserves queue order and replaces it atomically', async () => {
    const { db } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const a = (await db.upsertTrack(track({ sourceId: source.id }))).track;
    const b = (await db.upsertTrack(track({
      sourceId: source.id,
      path: '/music/tide-glass.flac',
      pathKey: '/music/tide-glass.flac',
      fileName: 'tide-glass.flac',
      ext: 'flac',
      title: 'Tide Glass',
    }))).track;
    await db.saveQueue([
      { entryId: 'b-entry', trackId: b.id },
      { entryId: 'a-entry', trackId: a.id },
    ]);
    expect(await db.loadQueue()).toEqual([
      { entryId: 'b-entry', trackId: b.id },
      { entryId: 'a-entry', trackId: a.id },
    ]);
    await db.saveQueue([{ entryId: 'a-entry', trackId: a.id }]);
    expect(await db.loadQueue()).toEqual([{ entryId: 'a-entry', trackId: a.id }]);
    await db.close();
  });

  it('stores hostile text as data, not SQL', async () => {
    const { db } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const hostile = "x'); DROP TABLE media_item; --";
    const result = await db.upsertTrack(track({ sourceId: source.id, title: hostile, album: hostile }));
    expect(result.track.title).toBe(hostile);
    expect(await db.listTracks()).toHaveLength(1);
    await db.close();
  });

  it('supports concurrent readers under WAL', async () => {
    const { db, path } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const stored = (await db.upsertTrack(track({ sourceId: source.id }))).track;
    const reader = await StatocystDatabase.open({ path });
    expect((await reader.listTracks())[0].id).toBe(stored.id);
    await db.upsertTrack(track({
      sourceId: source.id,
      path: '/music/tide-glass.flac',
      pathKey: '/music/tide-glass.flac',
      fileName: 'tide-glass.flac',
      ext: 'flac',
      title: 'Tide Glass',
    }));
    expect(await reader.listTracks()).toHaveLength(2);
    await reader.close();
    await db.close();
  });

  it('never adds credential-shaped columns to the catalog', async () => {
    const { db } = await open();
    for (const table of ['media_source', 'media_item', 'queue_entry', 'playback_state', 'app_state']) {
      const columns = (await db.tableColumns(table)).map((column) => column.toLowerCase());
      for (const forbidden of FORBIDDEN_CREDENTIAL_COLUMNS) {
        expect(columns, `${table}.${forbidden}`).not.toContain(forbidden);
      }
    }
    await db.close();
  });

  it('rolls back a failed migration and leaves the ledger consistent', async () => {
    const directory = await tempDir();
    const client = createClient({ url: `file:${join(directory, 'rollback.db')}` });
    const broken: Migration[] = [
      MIGRATIONS[0],
      {
        version: 2,
        name: 'broken_migration',
        statements: ['CREATE TABLE should_not_exist (id TEXT)', 'THIS IS NOT SQL'],
      },
    ];
    await expect(runMigrations(client, broken)).rejects.toThrow();
    const version = await client.execute('SELECT MAX(version) AS v FROM schema_migrations');
    expect(Number(version.rows[0]['v'])).toBe(1);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'",
    );
    expect(tables.rows).toHaveLength(0);
    client.close();
  });

  it('refuses to silently change an applied migration', async () => {
    const directory = await tempDir();
    const client = createClient({ url: `file:${join(directory, 'checksum.db')}` });
    await runMigrations(client, [MIGRATIONS[0]]);
    const mutated: Migration = {
      ...MIGRATIONS[0],
      statements: [...MIGRATIONS[0].statements, 'CREATE TABLE drift (id TEXT)'],
    };
    await expect(runMigrations(client, [mutated])).rejects.toBeInstanceOf(MigrationChecksumError);
    client.close();
  });
});

describe('jellyfin server profiles and accounts', () => {
  it('persists server profiles and reconciles them by URL', async () => {
    const { db } = await open();
    const created = await db.upsertJellyfinServer({
      url: 'https://jelly.example.com',
      name: 'Test Server',
      jellyfinId: 'jellyfin-id-1',
      version: '12.1.0',
    });
    expect(created.id).toBeTruthy();
    expect(created.lastConnectedAt).toBeNull();

    // Same URL updates in place rather than duplicating.
    const updated = await db.upsertJellyfinServer({
      url: 'https://jelly.example.com',
      name: 'Renamed',
      jellyfinId: 'jellyfin-id-1',
      version: '12.4.0',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('Renamed');

    const servers = await db.listJellyfinServers();
    expect(servers).toHaveLength(1);

    await db.touchJellyfinServer(created.id);
    expect((await db.getJellyfinServer(created.id))?.lastConnectedAt).toBeTruthy();

    expect(await db.removeJellyfinServer(created.id)).toBe(true);
    expect(await db.listJellyfinServers()).toHaveLength(0);
    await db.close();
  });

  it('stores an encrypted account token as an opaque ciphertext blob', async () => {
    const { db, path } = await open();
    const server = await db.upsertJellyfinServer({
      url: 'https://jelly.example.com',
      name: 'Test Server',
      jellyfinId: 'jellyfin-id-1',
      version: '12.1.0',
    });
    const plaintextToken = 'secret-access-token-value';
    const ciphertext = Buffer.from(plaintextToken).toString('base64'); // stand-in for safeStorage output
    await db.saveJellyfinAccount({
      serverId: server.id,
      userId: 'user-1',
      userName: 'statocyst',
      tokenCiphertext: ciphertext,
    });

    const account = await db.getJellyfinAccount(server.id);
    expect(account?.userId).toBe('user-1');
    expect(account?.tokenCiphertext).toBe(ciphertext);
    expect(account?.tokenCiphertext).not.toBe(plaintextToken);

    // The plaintext token never lands in the database file.
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain(plaintextToken);

    // Re-saving replaces the token (one account per server).
    await db.saveJellyfinAccount({
      serverId: server.id,
      userId: 'user-1',
      userName: 'statocyst',
      tokenCiphertext: 'updated-ciphertext',
    });
    expect((await db.getJellyfinAccount(server.id))?.tokenCiphertext).toBe('updated-ciphertext');

    await db.removeJellyfinAccount(server.id);
    expect(await db.getJellyfinAccount(server.id)).toBeNull();
    await db.close();
  });

  it('cascades account deletion when the server is removed', async () => {
    const { db } = await open();
    const server = await db.upsertJellyfinServer({
      url: 'https://jelly.example.com',
      name: 'Test Server',
      jellyfinId: 'jellyfin-id-1',
      version: '12.1.0',
    });
    await db.saveJellyfinAccount({
      serverId: server.id,
      userId: 'user-1',
      userName: 'statocyst',
      tokenCiphertext: 'cipher',
    });
    await db.removeJellyfinServer(server.id);
    expect(await db.getJellyfinAccount(server.id)).toBeNull();
    await db.close();
  });
});

describe('migration backup and recovery', () => {
  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async function seed(path: string): Promise<string> {
    const db = await StatocystDatabase.open({ path });
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    const inserted = await db.upsertTrack(track({ sourceId: source.id }));
    await db.close();
    return inserted.track.id;
  }

  it('restores the pre-migration snapshot when a later migration is inconsistent', async () => {
    const directory = await tempDir();
    const path = join(directory, 'recovery.db');
    const trackId = await seed(path);

    const inconsistent: Migration[] = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: 'add_probe_table',
        statements: ['CREATE TABLE migration_probe (id TEXT)'],
      },
      {
        version: MIGRATIONS.length + 3,
        name: 'skipped_version',
        statements: ['CREATE TABLE should_not_run (id TEXT)'],
      },
    ];

    const attempt = StatocystDatabase.open({ path, migrations: inconsistent });
    await expect(attempt).rejects.toBeInstanceOf(MigrationRecoveryError);
    const error = (await attempt.catch((reason: unknown) => reason)) as MigrationRecoveryError;
    expect(error.originalError).toBeInstanceOf(MigrationIntegrityError);

    const backupPath = `${path}.backup-v${MIGRATIONS.length}`;
    expect(error.backupPath).toBe(backupPath);
    expect(await exists(backupPath)).toBe(true);

    // The live file is back on the pre-migration schema with the user's data.
    const reopened = await StatocystDatabase.open({ path });
    expect(await reopened.schemaVersion()).toBe(MIGRATIONS.length);
    expect(await reopened.integrityCheck()).toBe('ok');
    expect((await reopened.listTracks()).map((stored) => stored.id)).toEqual([trackId]);
    // The partially applied migration was rolled back with the restore.
    expect(await reopened.tableColumns('migration_probe')).toEqual([]);
    await reopened.close();
  });

  it('does not create a backup on a first run (nothing to protect)', async () => {
    const directory = await tempDir();
    const path = join(directory, 'fresh.db');
    const db = await StatocystDatabase.open({ path });
    await db.close();
    expect(await exists(`${path}.backup-v0`)).toBe(false);
  });

  it('honours backupBeforeMigrate: false and propagates the raw failure', async () => {
    const directory = await tempDir();
    const path = join(directory, 'opt-out.db');
    await seed(path);

    const upgrade: Migration[] = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: 'add_probe_table',
        statements: ['CREATE TABLE migration_probe (id TEXT)'],
      },
      {
        version: MIGRATIONS.length + 3,
        name: 'skipped_version',
        statements: ['CREATE TABLE should_not_run (id TEXT)'],
      },
    ];

    await expect(
      StatocystDatabase.open({ path, migrations: upgrade, backupBeforeMigrate: false }),
    ).rejects.toBeInstanceOf(MigrationIntegrityError);
    expect(await exists(`${path}.backup-v${MIGRATIONS.length}`)).toBe(false);
  });

  it('keeps the snapshot after a successful upgrade', async () => {
    const directory = await tempDir();
    const path = join(directory, 'upgrade.db');
    await seed(path);

    const upgrade: Migration[] = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: 'add_probe_table',
        statements: ['CREATE TABLE migration_probe (id TEXT)'],
      },
    ];

    const db = await StatocystDatabase.open({ path, migrations: upgrade });
    expect(await db.schemaVersion()).toBe(MIGRATIONS.length + 1);
    expect(await db.tableColumns('migration_probe')).toEqual(['id']);
    await db.close();
    expect(await exists(`${path}.backup-v${MIGRATIONS.length}`)).toBe(true);
  });
});
