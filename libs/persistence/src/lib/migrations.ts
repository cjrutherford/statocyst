export interface Migration {
  version: number;
  name: string;
  statements: string[];
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
