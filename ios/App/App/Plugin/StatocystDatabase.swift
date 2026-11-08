import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct MediaItemEntity: Equatable {
    var id: String
    var sourceId: String
    var path: String
    var pathKey: String
    var fileName: String
    var ext: String
    var sizeBytes: Int64
    var mtimeMs: Int64
    var title: String
    var artist: String
    var album: String
    var albumArtist: String?
    var trackNo: Int?
    var discNo: Int?
    var year: Int?
    var genre: String?
    var durationMs: Int64
    var bitrate: Int?
    var sampleRate: Int?
    var channels: Int?
    var codec: String?
    var format: String?
    var artworkPath: String?
    var jellyfinImageTag: String?
    var sourceKind: String
    var sourceLabel: String
    var addedAt: String
    var updatedAt: String
    var missing: Bool = false
    var albumId: String? = nil
    var serverId: String = ""
    var mediaKind: String = "music"
}

struct DownloadEntity: Equatable {
    var trackId: String
    var localPath: String
    var sizeBytes: Int64
    var sha256: String
    var container: String?
    var verified: Bool
    var createdAt: String
}

struct CacheEntryEntity: Equatable {
    var trackId: String
    var localPath: String
    var sizeBytes: Int64
    var container: String?
    var createdAt: Int64
    var lastAccessAt: Int64
}

struct PodcastFeedEntity: Equatable {
    var id: String
    var feedUrl: String
    var resolvedUrl: String?
    var siteUrl: String?
    var title: String
    var author: String?
    var descriptionText: String?
    var imageUrl: String?
    var artworkPath: String?
    var language: String?
    var explicit: Bool = false
    var categoriesJson: String?
    var feedType: String
    var podcastIndexId: Int64?
    var etag: String?
    var lastModified: String?
    var lastFetchedAt: String?
    var lastSuccessAt: String?
    var nextFetchAt: String?
    var fetchError: String?
    var failureCount: Int = 0
    var refreshIntervalMinutes: Int = 60
    var defaultSpeed: Double = 1.0
    var skipIntroSeconds: Int = 0
    var skipOutroSeconds: Int = 0
    var autoQueue: Bool = true
    var episodeSort: String = "newest"
    var subscribed: Bool = true
    var lastViewedAt: String?
    var createdAt: String
    var updatedAt: String
}

struct PodcastEpisodeEntity: Equatable {
    var id: String
    var feedId: String
    var mediaItemId: String
    var guid: String
    var title: String
    var descriptionText: String?
    var linksJson: String?
    var link: String?
    var enclosureUrl: String
    var enclosureType: String?
    var enclosureLengthBytes: Int64?
    var durationMs: Int64 = 0
    var publishedAt: String?
    var seasonNo: Int?
    var episodeNo: Int?
    var episodeType: String?
    var imageUrl: String?
    var artworkPath: String?
    var explicit: Bool = false
    var chaptersUrl: String?
    var transcriptUrl: String?
    var transcriptType: String?
    var playbackSpeed: Double?
    var resumePositionMs: Int64 = 0
    var played: Bool = false
    var completed: Bool = false
    var playCount: Int = 0
    var lastPlayedAt: String?
    var firstSeenAt: String
    var createdAt: String
    var updatedAt: String
}

struct PodcastQueueEntryEntity: Equatable {
    var entryId: String
    var episodeId: String
    var position: Int
    var addedAt: String
}

struct PodcastPlaybackStateEntity: Equatable {
    var id: Int = 1
    var currentEntryId: String?
    var positionMs: Int64
    var speed: Double
    var updatedAt: String
}

struct PodcastDirectoryCacheEntity: Equatable {
    var id: String
    var provider: String
    var queryKey: String
    var payloadJson: String
    var fetchedAt: String
    var expiresAt: String
}

struct FavoriteEntity: Equatable {
    var trackId: String
    var position: Int
}

struct PlaylistEntity: Equatable {
    var id: String
    var name: String
    var createdAt: Int64
    var position: Int
}

struct PlaylistTrackEntity: Equatable {
    var playlistId: String
    var position: Int
    var trackId: String
}

/**
 * Thread-safe SQLite database matching Android's Room schema v7.
 * Uses the system SQLite3 C library so zero external dependencies are required.
 */
final class StatocystDatabase {
    static let SCHEMA_VERSION = 6
    static let shared = StatocystDatabase()

    let databaseURL: URL
    private let queue = DispatchQueue(label: "com.hopefulaspirationsindustries.statocyst.db")
    private var db: OpaquePointer?

    init(customURL: URL? = nil) {
        if let customURL = customURL {
            self.databaseURL = customURL
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let dir = appSupport.appendingPathComponent("Statocyst", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.databaseURL = dir.appendingPathComponent("statocyst.db")
        }
        queue.sync {
            openAndMigrate()
        }
    }

    deinit {
        if let db = db {
            sqlite3_close(db)
        }
    }

    static func appDataDirectory() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("Statocyst", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func openAndMigrate() {
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        if sqlite3_open_v2(databaseURL.path, &db, flags, nil) != SQLITE_OK {
            return
        }
        execRaw("PRAGMA journal_mode = WAL;")
        execRaw("PRAGMA synchronous = NORMAL;")
        execRaw("""
            CREATE TABLE IF NOT EXISTS media_item (
                id TEXT NOT NULL PRIMARY KEY,
                sourceId TEXT NOT NULL,
                path TEXT NOT NULL,
                pathKey TEXT NOT NULL,
                fileName TEXT NOT NULL,
                ext TEXT NOT NULL,
                sizeBytes INTEGER NOT NULL,
                mtimeMs INTEGER NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                albumArtist TEXT,
                trackNo INTEGER,
                discNo INTEGER,
                year INTEGER,
                genre TEXT,
                durationMs INTEGER NOT NULL,
                bitrate INTEGER,
                sampleRate INTEGER,
                channels INTEGER,
                codec TEXT,
                format TEXT,
                artworkPath TEXT,
                jellyfinImageTag TEXT,
                sourceKind TEXT NOT NULL,
                sourceLabel TEXT NOT NULL,
                addedAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                missing INTEGER NOT NULL DEFAULT 0,
                albumId TEXT,
                serverId TEXT NOT NULL DEFAULT '',
                mediaKind TEXT NOT NULL DEFAULT 'music'
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS download (
                trackId TEXT NOT NULL PRIMARY KEY,
                localPath TEXT NOT NULL,
                sizeBytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                container TEXT,
                verified INTEGER NOT NULL,
                createdAt TEXT NOT NULL
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS cache_entry (
                trackId TEXT NOT NULL PRIMARY KEY,
                localPath TEXT NOT NULL,
                sizeBytes INTEGER NOT NULL,
                container TEXT,
                createdAt INTEGER NOT NULL,
                lastAccessAt INTEGER NOT NULL
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS favorite (
                trackId TEXT NOT NULL PRIMARY KEY,
                position INTEGER NOT NULL
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS playlist (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                position INTEGER NOT NULL
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS playlist_track (
                playlistId TEXT NOT NULL,
                position INTEGER NOT NULL,
                trackId TEXT NOT NULL,
                PRIMARY KEY (playlistId, position)
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS recent (
                trackId TEXT NOT NULL PRIMARY KEY,
                playedAt INTEGER NOT NULL
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS podcast_feed (
                id TEXT NOT NULL PRIMARY KEY,
                feedUrl TEXT NOT NULL,
                resolvedUrl TEXT,
                siteUrl TEXT,
                title TEXT NOT NULL,
                author TEXT,
                descriptionText TEXT,
                imageUrl TEXT,
                artworkPath TEXT,
                language TEXT,
                explicit INTEGER NOT NULL,
                categoriesJson TEXT,
                feedType TEXT NOT NULL,
                podcastIndexId INTEGER,
                etag TEXT,
                lastModified TEXT,
                lastFetchedAt TEXT,
                lastSuccessAt TEXT,
                nextFetchAt TEXT,
                fetchError TEXT,
                failureCount INTEGER NOT NULL,
                refreshIntervalMinutes INTEGER NOT NULL,
                defaultSpeed REAL NOT NULL,
                skipIntroSeconds INTEGER NOT NULL,
                skipOutroSeconds INTEGER NOT NULL,
                autoQueue INTEGER NOT NULL,
                episodeSort TEXT NOT NULL,
                subscribed INTEGER NOT NULL,
                lastViewedAt TEXT,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );
        """)
        execRaw("CREATE UNIQUE INDEX IF NOT EXISTS index_podcast_feed_feedUrl ON podcast_feed(feedUrl);")
        execRaw("CREATE INDEX IF NOT EXISTS index_podcast_feed_nextFetchAt ON podcast_feed(nextFetchAt);")
        execRaw("""
            CREATE TABLE IF NOT EXISTS podcast_episode (
                id TEXT NOT NULL PRIMARY KEY,
                feedId TEXT NOT NULL,
                mediaItemId TEXT NOT NULL,
                guid TEXT NOT NULL,
                title TEXT NOT NULL,
                descriptionText TEXT,
                linksJson TEXT,
                link TEXT,
                enclosureUrl TEXT NOT NULL,
                enclosureType TEXT,
                enclosureLengthBytes INTEGER,
                durationMs INTEGER NOT NULL,
                publishedAt TEXT,
                seasonNo INTEGER,
                episodeNo INTEGER,
                episodeType TEXT,
                imageUrl TEXT,
                artworkPath TEXT,
                explicit INTEGER NOT NULL,
                chaptersUrl TEXT,
                transcriptUrl TEXT,
                transcriptType TEXT,
                playbackSpeed REAL,
                resumePositionMs INTEGER NOT NULL,
                played INTEGER NOT NULL,
                completed INTEGER NOT NULL,
                playCount INTEGER NOT NULL,
                lastPlayedAt TEXT,
                firstSeenAt TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );
        """)
        execRaw("CREATE INDEX IF NOT EXISTS index_podcast_episode_feedId ON podcast_episode(feedId);")
        execRaw("CREATE UNIQUE INDEX IF NOT EXISTS index_podcast_episode_mediaItemId ON podcast_episode(mediaItemId);")
        execRaw("CREATE INDEX IF NOT EXISTS index_podcast_episode_feedId_publishedAt ON podcast_episode(feedId, publishedAt);")
        execRaw("CREATE INDEX IF NOT EXISTS index_podcast_episode_lastPlayedAt ON podcast_episode(lastPlayedAt);")
        execRaw("""
            CREATE TABLE IF NOT EXISTS podcast_queue_entry (
                entryId TEXT NOT NULL PRIMARY KEY,
                episodeId TEXT NOT NULL,
                position INTEGER NOT NULL,
                addedAt TEXT NOT NULL
            );
        """)
        execRaw("CREATE INDEX IF NOT EXISTS index_podcast_queue_entry_position ON podcast_queue_entry(position);")
        execRaw("""
            CREATE TABLE IF NOT EXISTS podcast_playback_state (
                id INTEGER NOT NULL PRIMARY KEY,
                currentEntryId TEXT,
                positionMs INTEGER NOT NULL,
                speed REAL NOT NULL,
                updatedAt TEXT NOT NULL
            );
        """)
        execRaw("""
            CREATE TABLE IF NOT EXISTS podcast_directory_cache (
                id TEXT NOT NULL PRIMARY KEY,
                provider TEXT NOT NULL,
                queryKey TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                fetchedAt TEXT NOT NULL,
                expiresAt TEXT NOT NULL
            );
        """)
        execRaw("CREATE UNIQUE INDEX IF NOT EXISTS index_podcast_directory_cache_provider_queryKey ON podcast_directory_cache(provider, queryKey);")
        if !tableHasColumn("media_item", "mediaKind") {
            execRaw("ALTER TABLE media_item ADD COLUMN mediaKind TEXT NOT NULL DEFAULT 'music';")
        }
        execRaw("PRAGMA user_version = \(Self.SCHEMA_VERSION);")
    }

    private func tableHasColumn(_ table: String, _ column: String) -> Bool {
        guard let db = db else { return false }
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "PRAGMA table_info(\(table));", -1, &stmt, nil) == SQLITE_OK else {
            return false
        }
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let cStr = sqlite3_column_text(stmt, 1), String(cString: cStr) == column {
                return true
            }
        }
        return false
    }

    @discardableResult
    private func execRaw(_ sql: String) -> Bool {
        guard let db = db else { return false }
        var errMsg: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(db, sql, nil, nil, &errMsg)
        if let errMsg = errMsg {
            sqlite3_free(errMsg)
        }
        return rc == SQLITE_OK
    }

    // MARK: - Diagnostics

    func integrityCheck() -> String {
        return queue.sync {
            guard let db = db else { return "failed" }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "PRAGMA integrity_check;", -1, &stmt, nil) == SQLITE_OK else {
                return "unknown"
            }
            if sqlite3_step(stmt) == SQLITE_ROW, let cStr = sqlite3_column_text(stmt, 0) {
                let result = String(cString: cStr)
                return result == "ok" ? "ok" : "failed"
            }
            return "unknown"
        }
    }

    func schemaVersion() -> Int {
        return queue.sync {
            guard let db = db else { return 0 }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "PRAGMA user_version;", -1, &stmt, nil) == SQLITE_OK else {
                return 0
            }
            if sqlite3_step(stmt) == SQLITE_ROW {
                return Int(sqlite3_column_int(stmt, 0))
            }
            return 0
        }
    }

    // MARK: - Media Items

    func getAllMediaItems() -> [MediaItemEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "SELECT * FROM media_item ORDER BY LOWER(artist), LOWER(album), COALESCE(discNo, 1), COALESCE(trackNo, 0), LOWER(title);"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            var items: [MediaItemEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let entity = readMediaItem(stmt) {
                    items.append(entity)
                }
            }
            return items
        }
    }

    func getMediaItemById(_ id: String) -> MediaItemEntity? {
        return queue.sync {
            guard let db = db else { return nil }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT * FROM media_item WHERE id = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK else {
                return nil
            }
            sqlite3_bind_text(stmt, 1, id, -1, SQLITE_TRANSIENT)
            if sqlite3_step(stmt) == SQLITE_ROW {
                return readMediaItem(stmt)
            }
            return nil
        }
    }

    func getMediaItemByPathKey(_ pathKey: String) -> MediaItemEntity? {
        return queue.sync {
            guard let db = db else { return nil }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT * FROM media_item WHERE pathKey = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK else {
                return nil
            }
            sqlite3_bind_text(stmt, 1, pathKey, -1, SQLITE_TRANSIENT)
            if sqlite3_step(stmt) == SQLITE_ROW {
                return readMediaItem(stmt)
            }
            return nil
        }
    }

    func jellyfinByTitle(_ title: String) -> [MediaItemEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "SELECT * FROM media_item WHERE sourceKind LIKE 'jellyfin%' AND LOWER(title) = LOWER(?);"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            sqlite3_bind_text(stmt, 1, title, -1, SQLITE_TRANSIENT)
            var items: [MediaItemEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let entity = readMediaItem(stmt) {
                    items.append(entity)
                }
            }
            return items
        }
    }

    func upsertMediaItem(_ item: MediaItemEntity) {
        queue.sync {
            guard let db = db else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = """
                INSERT OR REPLACE INTO media_item (
                    id, sourceId, path, pathKey, fileName, ext, sizeBytes, mtimeMs,
                    title, artist, album, albumArtist, trackNo, discNo, year, genre,
                    durationMs, bitrate, sampleRate, channels, codec, format,
                    artworkPath, jellyfinImageTag, sourceKind, sourceLabel,
                    addedAt, updatedAt, missing, albumId, serverId, mediaKind
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                );
            """
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            bindText(stmt, 1, item.id)
            bindText(stmt, 2, item.sourceId)
            bindText(stmt, 3, item.path)
            bindText(stmt, 4, item.pathKey)
            bindText(stmt, 5, item.fileName)
            bindText(stmt, 6, item.ext)
            sqlite3_bind_int64(stmt, 7, item.sizeBytes)
            sqlite3_bind_int64(stmt, 8, item.mtimeMs)
            bindText(stmt, 9, item.title)
            bindText(stmt, 10, item.artist)
            bindText(stmt, 11, item.album)
            bindOptionalText(stmt, 12, item.albumArtist)
            bindOptionalInt(stmt, 13, item.trackNo)
            bindOptionalInt(stmt, 14, item.discNo)
            bindOptionalInt(stmt, 15, item.year)
            bindOptionalText(stmt, 16, item.genre)
            sqlite3_bind_int64(stmt, 17, item.durationMs)
            bindOptionalInt(stmt, 18, item.bitrate)
            bindOptionalInt(stmt, 19, item.sampleRate)
            bindOptionalInt(stmt, 20, item.channels)
            bindOptionalText(stmt, 21, item.codec)
            bindOptionalText(stmt, 22, item.format)
            bindOptionalText(stmt, 23, item.artworkPath)
            bindOptionalText(stmt, 24, item.jellyfinImageTag)
            bindText(stmt, 25, item.sourceKind)
            bindText(stmt, 26, item.sourceLabel)
            bindText(stmt, 27, item.addedAt)
            bindText(stmt, 28, item.updatedAt)
            sqlite3_bind_int(stmt, 29, item.missing ? 1 : 0)
            bindOptionalText(stmt, 30, item.albumId)
            bindText(stmt, 31, item.serverId)
            bindText(stmt, 32, item.mediaKind)
            _ = sqlite3_step(stmt)
        }
    }

    @discardableResult
    func deleteMediaItemById(_ id: String) -> Bool {
        return queue.sync {
            guard let db = db else { return false }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "DELETE FROM media_item WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK else {
                return false
            }
            bindText(stmt, 1, id)
            _ = sqlite3_step(stmt)
            return sqlite3_changes(db) > 0
        }
    }

    func deleteMediaItemsByIds(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        queue.sync {
            guard let db = db else { return }
            execRaw("BEGIN TRANSACTION;")
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "DELETE FROM media_item WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK {
                for id in ids {
                    sqlite3_reset(stmt)
                    bindText(stmt, 1, id)
                    _ = sqlite3_step(stmt)
                }
            }
            sqlite3_finalize(stmt)
            execRaw("COMMIT;")
        }
    }

    func idsByServer(_ serverId: String) -> [String] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT id FROM media_item WHERE serverId = ?;", -1, &stmt, nil) == SQLITE_OK else {
                return []
            }
            bindText(stmt, 1, serverId)
            var ids: [String] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let cStr = sqlite3_column_text(stmt, 0) {
                    ids.append(String(cString: cStr))
                }
            }
            return ids
        }
    }

    func unattributedRemoteIds() -> [String] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "SELECT id FROM media_item WHERE sourceKind LIKE 'jellyfin%' AND serverId = '';"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            var ids: [String] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let cStr = sqlite3_column_text(stmt, 0) {
                    ids.append(String(cString: cStr))
                }
            }
            return ids
        }
    }

    func mediaItemCount() -> Int {
        return queue.sync {
            guard let db = db else { return 0 }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM media_item;", -1, &stmt, nil) == SQLITE_OK else {
                return 0
            }
            if sqlite3_step(stmt) == SQLITE_ROW {
                return Int(sqlite3_column_int(stmt, 0))
            }
            return 0
        }
    }

    // MARK: - Downloads

    func getDownload(_ trackId: String) -> DownloadEntity? {
        return queue.sync {
            guard let db = db else { return nil }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT trackId, localPath, sizeBytes, sha256, container, verified, createdAt FROM download WHERE trackId = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK else {
                return nil
            }
            bindText(stmt, 1, trackId)
            if sqlite3_step(stmt) == SQLITE_ROW {
                return readDownload(stmt)
            }
            return nil
        }
    }

    func getAllDownloads() -> [DownloadEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT trackId, localPath, sizeBytes, sha256, container, verified, createdAt FROM download ORDER BY createdAt DESC;", -1, &stmt, nil) == SQLITE_OK else {
                return []
            }
            var list: [DownloadEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let d = readDownload(stmt) {
                    list.append(d)
                }
            }
            return list
        }
    }

    func upsertDownload(_ entity: DownloadEntity) {
        queue.sync {
            guard let db = db else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "INSERT OR REPLACE INTO download (trackId, localPath, sizeBytes, sha256, container, verified, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            bindText(stmt, 1, entity.trackId)
            bindText(stmt, 2, entity.localPath)
            sqlite3_bind_int64(stmt, 3, entity.sizeBytes)
            bindText(stmt, 4, entity.sha256)
            bindOptionalText(stmt, 5, entity.container)
            sqlite3_bind_int(stmt, 6, entity.verified ? 1 : 0)
            bindText(stmt, 7, entity.createdAt)
            _ = sqlite3_step(stmt)
        }
    }

    @discardableResult
    func deleteDownload(_ trackId: String) -> Int {
        return queue.sync {
            guard let db = db else { return 0 }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "DELETE FROM download WHERE trackId = ?;", -1, &stmt, nil) == SQLITE_OK else {
                return 0
            }
            bindText(stmt, 1, trackId)
            _ = sqlite3_step(stmt)
            return Int(sqlite3_changes(db))
        }
    }

    // MARK: - Rolling Cache

    func getCacheEntry(_ trackId: String) -> CacheEntryEntity? {
        return queue.sync {
            guard let db = db else { return nil }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT trackId, localPath, sizeBytes, container, createdAt, lastAccessAt FROM cache_entry WHERE trackId = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK else {
                return nil
            }
            bindText(stmt, 1, trackId)
            if sqlite3_step(stmt) == SQLITE_ROW {
                return readCacheEntry(stmt)
            }
            return nil
        }
    }

    func getAllCacheEntries() -> [CacheEntryEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT trackId, localPath, sizeBytes, container, createdAt, lastAccessAt FROM cache_entry ORDER BY lastAccessAt ASC;", -1, &stmt, nil) == SQLITE_OK else {
                return []
            }
            var list: [CacheEntryEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let c = readCacheEntry(stmt) {
                    list.append(c)
                }
            }
            return list
        }
    }

    func upsertCacheEntry(_ entry: CacheEntryEntity) {
        queue.sync {
            guard let db = db else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "INSERT OR REPLACE INTO cache_entry (trackId, localPath, sizeBytes, container, createdAt, lastAccessAt) VALUES (?, ?, ?, ?, ?, ?);"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
            bindText(stmt, 1, entry.trackId)
            bindText(stmt, 2, entry.localPath)
            sqlite3_bind_int64(stmt, 3, entry.sizeBytes)
            bindOptionalText(stmt, 4, entry.container)
            sqlite3_bind_int64(stmt, 5, entry.createdAt)
            sqlite3_bind_int64(stmt, 6, entry.lastAccessAt)
            _ = sqlite3_step(stmt)
        }
    }

    func touchCacheEntry(_ trackId: String, timestampMs: Int64) {
        queue.sync {
            guard let db = db else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "UPDATE cache_entry SET lastAccessAt = ? WHERE trackId = ?;", -1, &stmt, nil) == SQLITE_OK else {
                return
            }
            sqlite3_bind_int64(stmt, 1, timestampMs)
            bindText(stmt, 2, trackId)
            _ = sqlite3_step(stmt)
        }
    }

    func deleteCacheEntry(_ trackId: String) {
        queue.sync {
            guard let db = db else { return }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "DELETE FROM cache_entry WHERE trackId = ?;", -1, &stmt, nil) == SQLITE_OK else {
                return
            }
            bindText(stmt, 1, trackId)
            _ = sqlite3_step(stmt)
        }
    }

    func totalCacheBytes() -> Int64 {
        return queue.sync {
            guard let db = db else { return 0 }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT COALESCE(SUM(sizeBytes), 0) FROM cache_entry;", -1, &stmt, nil) == SQLITE_OK else {
                return 0
            }
            if sqlite3_step(stmt) == SQLITE_ROW {
                return sqlite3_column_int64(stmt, 0)
            }
            return 0
        }
    }

    func cacheEntryCount() -> Int {
        return queue.sync {
            guard let db = db else { return 0 }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM cache_entry;", -1, &stmt, nil) == SQLITE_OK else {
                return 0
            }
            if sqlite3_step(stmt) == SQLITE_ROW {
                return Int(sqlite3_column_int(stmt, 0))
            }
            return 0
        }
    }

    // MARK: - User State (Favorites & Playlists)

    func getFavorites() -> [FavoriteEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT trackId, position FROM favorite ORDER BY position ASC;", -1, &stmt, nil) == SQLITE_OK else {
                return []
            }
            var list: [FavoriteEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let cStr = sqlite3_column_text(stmt, 0) {
                    list.append(FavoriteEntity(trackId: String(cString: cStr), position: Int(sqlite3_column_int(stmt, 1))))
                }
            }
            return list
        }
    }

    func isFavorite(_ trackId: String) -> Bool {
        return queue.sync {
            guard let db = db else { return false }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "SELECT 1 FROM favorite WHERE trackId = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK else {
                return false
            }
            bindText(stmt, 1, trackId)
            return sqlite3_step(stmt) == SQLITE_ROW
        }
    }

    @discardableResult
    func toggleFavorite(_ trackId: String) -> [String] {
        let current = getFavorites().map { $0.trackId }
        let updated: [String]
        if current.contains(trackId) {
            updated = current.filter { $0 != trackId }
        } else {
            updated = [trackId] + current
        }
        replaceFavoritesOnly(updated.enumerated().map { FavoriteEntity(trackId: $0.element, position: $0.offset) })
        return updated
    }

    private func replaceFavoritesOnly(_ favorites: [FavoriteEntity]) {
        queue.sync {
            guard let db = db else { return }
            execRaw("BEGIN TRANSACTION;")
            execRaw("DELETE FROM favorite;")
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO favorite (trackId, position) VALUES (?, ?);", -1, &stmt, nil) == SQLITE_OK {
                for fav in favorites {
                    sqlite3_reset(stmt)
                    bindText(stmt, 1, fav.trackId)
                    sqlite3_bind_int(stmt, 2, Int32(fav.position))
                    _ = sqlite3_step(stmt)
                }
            }
            sqlite3_finalize(stmt)
            execRaw("COMMIT;")
        }
    }

    func getAllPlaylists() -> [PlaylistEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "SELECT id, name, createdAt, position FROM playlist ORDER BY position ASC, LOWER(name) ASC;"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            var list: [PlaylistEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                let id = colString(stmt, 0)
                if id.isEmpty { continue }
                list.append(PlaylistEntity(
                    id: id,
                    name: colString(stmt, 1),
                    createdAt: sqlite3_column_int64(stmt, 2),
                    position: Int(sqlite3_column_int(stmt, 3))
                ))
            }
            return list
        }
    }

    func getAllPlaylistTracks() -> [PlaylistTrackEntity] {
        return queue.sync {
            guard let db = db else { return [] }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            let sql = "SELECT playlistId, position, trackId FROM playlist_track ORDER BY playlistId ASC, position ASC;"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            var list: [PlaylistTrackEntity] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                list.append(PlaylistTrackEntity(
                    playlistId: colString(stmt, 0),
                    position: Int(sqlite3_column_int(stmt, 1)),
                    trackId: colString(stmt, 2)
                ))
            }
            return list
        }
    }

    func replaceUserState(
        favorites: [FavoriteEntity],
        playlists: [PlaylistEntity],
        playlistTracks: [PlaylistTrackEntity]
    ) {
        queue.sync {
            guard let db = db else { return }
            execRaw("BEGIN TRANSACTION;")
            execRaw("DELETE FROM favorite;")
            execRaw("DELETE FROM playlist;")
            execRaw("DELETE FROM playlist_track;")

            var favStmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO favorite (trackId, position) VALUES (?, ?);", -1, &favStmt, nil) == SQLITE_OK {
                for fav in favorites {
                    sqlite3_reset(favStmt)
                    bindText(favStmt, 1, fav.trackId)
                    sqlite3_bind_int(favStmt, 2, Int32(fav.position))
                    _ = sqlite3_step(favStmt)
                }
            }
            sqlite3_finalize(favStmt)

            var plStmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO playlist (id, name, createdAt, position) VALUES (?, ?, ?, ?);", -1, &plStmt, nil) == SQLITE_OK {
                for pl in playlists {
                    sqlite3_reset(plStmt)
                    bindText(plStmt, 1, pl.id)
                    bindText(plStmt, 2, pl.name)
                    sqlite3_bind_int64(plStmt, 3, pl.createdAt)
                    sqlite3_bind_int(plStmt, 4, Int32(pl.position))
                    _ = sqlite3_step(plStmt)
                }
            }
            sqlite3_finalize(plStmt)

            var ptStmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO playlist_track (playlistId, position, trackId) VALUES (?, ?, ?);", -1, &ptStmt, nil) == SQLITE_OK {
                for pt in playlistTracks {
                    sqlite3_reset(ptStmt)
                    bindText(ptStmt, 1, pt.playlistId)
                    sqlite3_bind_int(ptStmt, 2, Int32(pt.position))
                    bindText(ptStmt, 3, pt.trackId)
                    _ = sqlite3_step(ptStmt)
                }
            }
            sqlite3_finalize(ptStmt)

            execRaw("COMMIT;")
        }
    }

    // MARK: - SQLite Row Readers & Binders

    private func bindText(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
        sqlite3_bind_text(stmt, index, value, -1, SQLITE_TRANSIENT)
    }

    private func bindOptionalText(_ stmt: OpaquePointer?, _ index: Int32, _ value: String?) {
        if let value = value {
            sqlite3_bind_text(stmt, index, value, -1, SQLITE_TRANSIENT)
        } else {
            sqlite3_bind_null(stmt, index)
        }
    }

    private func bindOptionalInt(_ stmt: OpaquePointer?, _ index: Int32, _ value: Int?) {
        if let value = value {
            sqlite3_bind_int(stmt, index, Int32(value))
        } else {
            sqlite3_bind_null(stmt, index)
        }
    }

    private func colString(_ stmt: OpaquePointer?, _ index: Int32) -> String {
        guard let cStr = sqlite3_column_text(stmt, index) else { return "" }
        return String(cString: cStr)
    }

    private func colOptionalString(_ stmt: OpaquePointer?, _ index: Int32) -> String? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL,
              let cStr = sqlite3_column_text(stmt, index) else { return nil }
        return String(cString: cStr)
    }

    private func colOptionalInt(_ stmt: OpaquePointer?, _ index: Int32) -> Int? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL else { return nil }
        return Int(sqlite3_column_int(stmt, index))
    }

    private func readMediaItem(_ stmt: OpaquePointer?) -> MediaItemEntity? {
        let id = colString(stmt, 0)
        if id.isEmpty { return nil }
        return MediaItemEntity(
            id: id,
            sourceId: colString(stmt, 1),
            path: colString(stmt, 2),
            pathKey: colString(stmt, 3),
            fileName: colString(stmt, 4),
            ext: colString(stmt, 5),
            sizeBytes: sqlite3_column_int64(stmt, 6),
            mtimeMs: sqlite3_column_int64(stmt, 7),
            title: colString(stmt, 8),
            artist: colString(stmt, 9),
            album: colString(stmt, 10),
            albumArtist: colOptionalString(stmt, 11),
            trackNo: colOptionalInt(stmt, 12),
            discNo: colOptionalInt(stmt, 13),
            year: colOptionalInt(stmt, 14),
            genre: colOptionalString(stmt, 15),
            durationMs: sqlite3_column_int64(stmt, 16),
            bitrate: colOptionalInt(stmt, 17),
            sampleRate: colOptionalInt(stmt, 18),
            channels: colOptionalInt(stmt, 19),
            codec: colOptionalString(stmt, 20),
            format: colOptionalString(stmt, 21),
            artworkPath: colOptionalString(stmt, 22),
            jellyfinImageTag: colOptionalString(stmt, 23),
            sourceKind: colString(stmt, 24),
            sourceLabel: colString(stmt, 25),
            addedAt: colString(stmt, 26),
            updatedAt: colString(stmt, 27),
            missing: sqlite3_column_int(stmt, 28) != 0,
            albumId: colOptionalString(stmt, 29),
            serverId: colString(stmt, 30),
            mediaKind: colString(stmt, 31)
        )
    }

    private func readDownload(_ stmt: OpaquePointer?) -> DownloadEntity? {
        let trackId = colString(stmt, 0)
        if trackId.isEmpty { return nil }
        return DownloadEntity(
            trackId: trackId,
            localPath: colString(stmt, 1),
            sizeBytes: sqlite3_column_int64(stmt, 2),
            sha256: colString(stmt, 3),
            container: colOptionalString(stmt, 4),
            verified: sqlite3_column_int(stmt, 5) != 0,
            createdAt: colString(stmt, 6)
        )
    }

    private func readCacheEntry(_ stmt: OpaquePointer?) -> CacheEntryEntity? {
        let trackId = colString(stmt, 0)
        if trackId.isEmpty { return nil }
        return CacheEntryEntity(
            trackId: trackId,
            localPath: colString(stmt, 1),
            sizeBytes: sqlite3_column_int64(stmt, 2),
            container: colOptionalString(stmt, 3),
            createdAt: sqlite3_column_int64(stmt, 4),
            lastAccessAt: sqlite3_column_int64(stmt, 5)
        )
    }
}
