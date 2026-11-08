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
  type PodcastEpisodeUpsert,
  type PodcastFeedUpsert,
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
      activeContext: 'music',
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
      activeContext: 'music',
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

describe('podcast catalog', () => {
  const feedInput = (overrides: Partial<PodcastFeedUpsert> = {}): PodcastFeedUpsert => ({
    feedUrl: 'https://feeds.example.com/deep-water.xml',
    resolvedUrl: 'https://feeds.example.com/deep-water.xml',
    siteUrl: 'https://example.com/deep-water',
    title: 'Deep Water Radio',
    author: 'Statocyst Studio',
    descriptionText: 'Stories from the bathypelagic zone.',
    imageUrl: 'https://feeds.example.com/deep-water.jpg',
    artworkPath: null,
    language: 'en',
    explicit: false,
    categories: ['Science', 'Nature'],
    feedType: 'rss',
    podcastIndexId: 1234,
    ...overrides,
  });

  const episodeInput = (
    overrides: Partial<PodcastEpisodeUpsert> = {},
  ): PodcastEpisodeUpsert => ({
    feedId: 'feed-1',
    guid: 'episode-guid-1',
    title: 'The pressure at 4,000 metres',
    descriptionText: 'A dive below the sunlight zone.',
    links: [{ title: 'Transcript', url: 'https://example.com/transcript' }],
    link: 'https://example.com/episodes/1',
    enclosureUrl: 'https://cdn.example.com/episodes/1.mp3',
    enclosureType: 'audio/mpeg',
    enclosureLengthBytes: 42_000_000,
    durationMs: 2_400_000,
    publishedAt: '2026-10-01T08:00:00.000Z',
    seasonNo: 2,
    episodeNo: 7,
    episodeType: 'full',
    explicit: false,
    ...overrides,
  });

  async function seedFeed(db: StatocystDatabase) {
    return db.upsertPodcastFeed(feedInput());
  }

  it('keeps podcast rows out of music lists and stats', async () => {
    const { db } = await open();
    const source = await db.upsertSource({ kind: 'local', label: 'Music', rootPath: '/music' });
    await db.upsertTrack(track({ sourceId: source.id }));
    const feed = await seedFeed(db);
    await db.savePodcastEpisodes(feed.id, [episodeInput({ feedId: feed.id })]);

    const music = await db.listTracks();
    expect(music).toHaveLength(1);
    expect(music[0].mediaKind).toBe('music');
    expect(await db.listAllTracks()).toHaveLength(2);
    expect((await db.stats()).tracks).toBe(1);

    const episodes = await db.listPodcastEpisodes(feed.id);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].mediaKind).toBe('podcast');
    expect(episodes[0].feedTitle).toBe('Deep Water Radio');
    expect(episodes[0].title).toBe('The pressure at 4,000 metres');
    expect(episodes[0].sourceKind).toBe('podcast');
    expect(episodes[0].mediaKind).toBe('podcast');
    expect(episodes[0].links).toEqual([
      { title: 'Transcript', url: 'https://example.com/transcript' },
    ]);
    expect(episodes[0].resumePositionMs).toBe(0);
    await db.close();
  });

  it('upserts episodes idempotently and preserves progress', async () => {
    const { db } = await open();
    const feed = await seedFeed(db);
    const first = await db.savePodcastEpisodes(feed.id, [episodeInput({ feedId: feed.id })]);
    expect(first).toHaveLength(1);
    const episodeId = first[0].episodeId;
    const mediaItemId = first[0].mediaItemId;

    await db.setPodcastEpisodeResume(episodeId, 90_000);
    await db.setPodcastEpisodePlayed(episodeId, true);
    const refreshed = await db.savePodcastEpisodes(feed.id, [
      episodeInput({
        feedId: feed.id,
        title: 'The pressure at 4,000 metres (updated)',
        durationMs: 2_500_000,
      }),
    ]);
    expect(refreshed[0].episodeId).toBe(episodeId);
    expect(refreshed[0].mediaItemId).toBe(mediaItemId);
    expect(await db.podcastEpisodeCount()).toBe(1);

    const stored = await db.getPodcastEpisode(episodeId);
    expect(stored?.title).toBe('The pressure at 4,000 metres (updated)');
    expect(stored?.durationMs).toBe(2_500_000);
    expect(stored?.played).toBe(true);
    expect(stored?.completed).toBe(true);
    expect(stored?.resumePositionMs).toBe(0);
    await db.close();
  });

  it('removes a feed, its episodes and their media rows without orphans', async () => {
    const { db } = await open();
    const feed = await seedFeed(db);
    const [saved] = await db.savePodcastEpisodes(feed.id, [
      episodeInput({ feedId: feed.id }),
      episodeInput({ feedId: feed.id, guid: 'episode-guid-2', title: 'Second' }),
    ]);
    await db.savePodcastQueue([{ entryId: 'pq-1', episodeId: saved.episodeId }]);
    await db.saveDownload({
      trackId: saved.mediaItemId,
      localPath: '/tmp/episode.mp3',
      sizeBytes: 10,
      sha256: 'hash',
      container: 'mp3',
      verified: true,
    });

    expect(await db.removePodcastFeed(feed.id)).toBe(true);
    expect(await db.podcastEpisodeCount()).toBe(0);
    expect(await db.getTrack(saved.mediaItemId).catch(() => null)).toBeNull();
    expect(await db.loadPodcastQueue()).toHaveLength(0);
    expect(await db.getDownload(saved.mediaItemId)).toBeNull();
    await db.close();
  });

  it('persists the podcast queue and playback state independently of music', async () => {
    const { db, path } = await open();
    const feed = await seedFeed(db);
    const [saved] = await db.savePodcastEpisodes(feed.id, [episodeInput({ feedId: feed.id })]);
    await db.savePodcastQueue([{ entryId: 'pq-1', episodeId: saved.episodeId }]);
    await db.savePodcastPlaybackState({
      currentEntryId: 'pq-1',
      positionMs: 123_000,
      speed: 1.5,
    });
    await db.close();

    const reopened = await StatocystDatabase.open({ path });
    expect(await reopened.loadPodcastQueue()).toEqual([
      { entryId: 'pq-1', episodeId: saved.episodeId },
    ]);
    expect(await reopened.loadPodcastPlaybackState()).toEqual({
      currentEntryId: 'pq-1',
      positionMs: 123_000,
      speed: 1.5,
    });
    await reopened.close();
  });

  it('creates one deterministic podcast source and updates feed settings', async () => {
    const { db } = await open();
    const first = await db.ensurePodcastSource();
    const second = await db.ensurePodcastSource();
    expect(first.id).toBe('podcast');
    expect(second.id).toBe('podcast');
    expect(second.kind).toBe('podcast');

    const feed = await seedFeed(db);
    const updated = await db.updatePodcastFeed(feed.id, {
      title: 'Deep Water Radio (renamed)',
      refreshIntervalMinutes: 30,
      defaultSpeed: 1.25,
      skipIntroSeconds: 15,
      skipOutroSeconds: 30,
      autoQueue: false,
      episodeSort: 'oldest',
      subscribed: false,
    });
    expect(updated.title).toBe('Deep Water Radio (renamed)');
    expect(updated.refreshIntervalMinutes).toBe(30);
    expect(updated.defaultSpeed).toBe(1.25);
    expect(updated.skipIntroSeconds).toBe(15);
    expect(updated.skipOutroSeconds).toBe(30);
    expect(updated.autoQueue).toBe(false);
    expect(updated.episodeSort).toBe('oldest');
    expect(updated.subscribed).toBe(false);
    await db.close();
  });

  it('migrates a real v5 database and preserves music data through the source rebuild', async () => {
    const directory = await tempDir();
    const path = join(directory, 'v5.db');
    const client = createClient({ url: `file:${path}` });
    await runMigrations(client, MIGRATIONS.slice(0, 5));
    const now = '2026-10-01T00:00:00.000Z';
    await client.execute({
      sql: 'INSERT INTO media_source (id, kind, label, root_path, created_at) VALUES (?, ?, ?, ?, ?)',
      args: ['source-local', 'local', 'Music', '/music', now],
    });
    await client.execute({
      sql: 'INSERT INTO media_source (id, kind, label, root_path, created_at) VALUES (?, ?, ?, ?, ?)',
      args: ['source-demo', 'demo', 'Demos', '/demo', now],
    });
    await client.execute({
      sql: 'INSERT INTO media_source (id, kind, label, root_path, created_at) VALUES (?, ?, ?, ?, ?)',
      args: ['source-jellyfin', 'jellyfin', 'Jellyfin', 'server-1', now],
    });
    await client.execute({
      sql: `INSERT INTO media_item (
        id, source_id, path, path_key, file_name, ext, size_bytes, mtime_ms,
        title, artist, album, duration_ms, added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'track-1',
        'source-local',
        '/music/sonar-bloom.mp3',
        '/music/sonar-bloom.mp3',
        'sonar-bloom.mp3',
        'mp3',
        1024,
        1_700_000_000_000,
        'Pre-migration track',
        'Statocyst Ensemble',
        'Bathypelagic Sessions',
        184_000,
        now,
        now,
      ],
    });
    await client.execute({
      sql: 'INSERT INTO queue_entry (entry_id, media_item_id, position, added_at) VALUES (?, ?, ?, ?)',
      args: ['entry-1', 'track-1', 0, now],
    });
    await client.execute({
      sql: `UPDATE playback_state SET
        current_entry_id = ?, position_ms = ?, shuffle = 1, repeat = 'all', updated_at = ?
        WHERE id = 1`,
      args: ['entry-1', 42_000, now],
    });
    await client.execute({
      sql: `INSERT INTO download (track_id, local_path, size_bytes, sha256, container, verified, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)`,
      args: ['track-1', '/music/sonar-bloom.mp3', 1024, 'abc', 'mp3', now],
    });
    await client.execute({
      sql: `INSERT INTO jellyfin_server (id, url, name, jellyfin_id, version, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['server-1', 'https://jelly.example.com', 'Jellyfin', 'jf-1', '12.1.0', now],
    });
    client.close();

    const db = await StatocystDatabase.open({ path });
    expect(await db.schemaVersion()).toBe(MIGRATIONS.length);
    expect(await db.integrityCheck()).toBe('ok');
    expect(await db.foreignKeyCheck()).toBe(0);
    expect((await db.listTracks())[0].title).toBe('Pre-migration track');
    expect((await db.listTracks())[0].mediaKind).toBe('music');
    expect(await db.loadQueue()).toEqual([{ entryId: 'entry-1', trackId: 'track-1' }]);
    expect(await db.loadPlaybackState()).toEqual({
      currentEntryId: 'entry-1',
      positionMs: 42_000,
      shuffle: true,
      repeat: 'all',
      activeContext: 'music',
    });
    expect((await db.getDownload('track-1'))?.verified).toBe(true);
    expect((await db.listJellyfinServers()).length).toBe(1);
    expect((await db.getSource('source-local'))?.kind).toBe('local');
    expect((await db.getSource('source-demo'))?.kind).toBe('demo');
    expect((await db.getSource('source-jellyfin'))?.kind).toBe('jellyfin');
    expect((await db.ensurePodcastSource()).id).toBe('podcast');
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
