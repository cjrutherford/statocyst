export interface Migration {
  version: number;
  name: string;
  statements: string[];
  /**
   * Run this migration with SQLite foreign-key enforcement temporarily off.
   * Only for a table rebuild where the parent is referenced with ON DELETE
   * CASCADE; the runner always restores enforcement afterwards.
   */
  foreignKeysOff?: boolean;
}

/**
 * Additive migrations only. A migration is checksummed; an edited migration
 * that has already run is a startup error rather than a silent schema drift.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_catalog_queue_state',
    statements: [
      `CREATE TABLE media_source (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('local', 'demo', 'jellyfin')),
        label TEXT NOT NULL,
        root_path TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (kind, root_path)
      )`,
      `CREATE TABLE media_item (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES media_source(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        ext TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT,
        track_no INTEGER,
        disc_no INTEGER,
        year INTEGER,
        genre TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        bitrate INTEGER,
        sample_rate INTEGER,
        channels INTEGER,
        codec TEXT,
        format TEXT,
        artwork_path TEXT,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_played_at TEXT,
        play_count INTEGER NOT NULL DEFAULT 0,
        missing INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_media_item_source ON media_item(source_id)`,
      `CREATE INDEX idx_media_item_album ON media_item(album, artist)`,
      `CREATE INDEX idx_media_item_title ON media_item(title)`,
      `CREATE TABLE queue_entry (
        entry_id TEXT PRIMARY KEY,
        media_item_id TEXT NOT NULL REFERENCES media_item(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_queue_entry_position ON queue_entry(position)`,
      `CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_entry_id TEXT,
        position_ms INTEGER NOT NULL DEFAULT 0,
        shuffle INTEGER NOT NULL DEFAULT 0 CHECK (shuffle IN (0, 1)),
        repeat TEXT NOT NULL DEFAULT 'off' CHECK (repeat IN ('off', 'all', 'one')),
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `INSERT INTO playback_state (id, current_entry_id, position_ms, shuffle, repeat, updated_at)
       VALUES (1, NULL, 0, 0, 'off', CURRENT_TIMESTAMP)`,
    ],
  },
  {
    version: 2,
    name: 'jellyfin_server_profiles',
    statements: [
      `CREATE TABLE jellyfin_server (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        jellyfin_id TEXT NOT NULL,
        version TEXT,
        created_at TEXT NOT NULL,
        last_connected_at TEXT
      )`,
      `CREATE TABLE jellyfin_account (
        server_id TEXT PRIMARY KEY REFERENCES jellyfin_server(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        token_ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 3,
    name: 'jellyfin_remote_artwork',
    statements: [
      `ALTER TABLE media_item ADD COLUMN jellyfin_image_tag TEXT`,
    ],
  },
  {
    version: 4,
    name: 'protected_downloads',
    statements: [
      `CREATE TABLE download (
        track_id TEXT PRIMARY KEY REFERENCES media_item(id) ON DELETE CASCADE,
        local_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        container TEXT,
        verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 5,
    name: 'adaptive_cache',
    statements: [
      `CREATE TABLE cache_entry (
        track_id TEXT PRIMARY KEY REFERENCES media_item(id) ON DELETE CASCADE,
        local_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        last_access_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 6,
    name: 'podcasts',
    foreignKeysOff: true,
    statements: [
      `ALTER TABLE media_item ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'music'
        CHECK (media_kind IN ('music', 'podcast'))`,
      `CREATE INDEX idx_media_item_kind ON media_item(media_kind)`,
      `ALTER TABLE playback_state ADD COLUMN active_context TEXT NOT NULL DEFAULT 'music'
        CHECK (active_context IN ('music', 'podcast'))`,
      // The only CHECK change is on the tiny source table. Foreign-key
      // enforcement is disabled by the runner for this migration because
      // media_item references media_source with ON DELETE CASCADE.
      `CREATE TABLE media_source_v2 (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('local', 'demo', 'jellyfin', 'podcast')),
        label TEXT NOT NULL,
        root_path TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (kind, root_path)
      )`,
      `INSERT INTO media_source_v2 (id, kind, label, root_path, created_at)
        SELECT id, kind, label, root_path, created_at FROM media_source`,
      `DROP TABLE media_source`,
      `ALTER TABLE media_source_v2 RENAME TO media_source`,
      `CREATE TABLE podcast_feed (
        id TEXT PRIMARY KEY,
        feed_url TEXT NOT NULL UNIQUE,
        resolved_url TEXT,
        site_url TEXT,
        title TEXT NOT NULL,
        author TEXT,
        description_text TEXT,
        image_url TEXT,
        artwork_path TEXT,
        language TEXT,
        explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
        categories_json TEXT,
        feed_type TEXT NOT NULL CHECK (feed_type IN ('rss', 'atom')),
        podcast_index_id INTEGER,
        etag TEXT,
        last_modified TEXT,
        last_fetched_at TEXT,
        last_success_at TEXT,
        next_fetch_at TEXT,
        fetch_error TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
        default_speed REAL NOT NULL DEFAULT 1.0,
        skip_intro_seconds INTEGER NOT NULL DEFAULT 0,
        skip_outro_seconds INTEGER NOT NULL DEFAULT 0,
        auto_queue INTEGER NOT NULL DEFAULT 1 CHECK (auto_queue IN (0, 1)),
        episode_sort TEXT NOT NULL DEFAULT 'newest' CHECK (episode_sort IN ('newest', 'oldest')),
        subscribed INTEGER NOT NULL DEFAULT 1 CHECK (subscribed IN (0, 1)),
        last_viewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_podcast_feed_due ON podcast_feed(next_fetch_at) WHERE subscribed = 1`,
      `CREATE TABLE podcast_episode (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL REFERENCES podcast_feed(id) ON DELETE CASCADE,
        media_item_id TEXT NOT NULL UNIQUE REFERENCES media_item(id) ON DELETE CASCADE,
        guid TEXT NOT NULL,
        title TEXT NOT NULL,
        description_text TEXT,
        links_json TEXT,
        link TEXT,
        enclosure_url TEXT NOT NULL,
        enclosure_type TEXT,
        enclosure_length_bytes INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        published_at TEXT,
        season_no INTEGER,
        episode_no INTEGER,
        episode_type TEXT,
        image_url TEXT,
        artwork_path TEXT,
        explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
        chapters_url TEXT,
        transcript_url TEXT,
        transcript_type TEXT,
        playback_speed REAL,
        resume_position_ms INTEGER NOT NULL DEFAULT 0,
        played INTEGER NOT NULL DEFAULT 0 CHECK (played IN (0, 1)),
        completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        play_count INTEGER NOT NULL DEFAULT 0,
        last_played_at TEXT,
        first_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (feed_id, guid)
      )`,
      `CREATE INDEX idx_podcast_episode_feed_date ON podcast_episode(feed_id, published_at DESC)`,
      `CREATE INDEX idx_podcast_episode_continue ON podcast_episode(last_played_at DESC)
        WHERE completed = 0 AND resume_position_ms > 0`,
      `CREATE TABLE podcast_queue_entry (
        entry_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL REFERENCES podcast_episode(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_podcast_queue_entry_position ON podcast_queue_entry(position)`,
      `CREATE TABLE podcast_playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_entry_id TEXT,
        position_ms INTEGER NOT NULL DEFAULT 0,
        speed REAL NOT NULL DEFAULT 1.0,
        updated_at TEXT NOT NULL
      )`,
      `INSERT INTO podcast_playback_state (id, current_entry_id, position_ms, speed, updated_at)
        VALUES (1, NULL, 0, 1.0, CURRENT_TIMESTAMP)`,
      `CREATE TABLE podcast_directory_cache (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        query_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        UNIQUE (provider, query_key)
      )`,
    ],
  },
];

/** Fields that must never be persisted in the catalog. Used by the security test. */
export const FORBIDDEN_CREDENTIAL_COLUMNS = [
  'access_token',
  'refresh_token',
  'password',
  'api_key',
  'secret',
  'credential',
] as const;
