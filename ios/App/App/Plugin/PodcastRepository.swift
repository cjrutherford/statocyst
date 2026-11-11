import Foundation
import SQLite3

private let PODCAST_SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct PodcastFeedRecord {
    let feed: PodcastFeedEntity
    let unplayed: Int
    let newEpisodes: Int
}

struct PodcastEpisodeRecord {
    let episode: PodcastEpisodeEntity
    let media: MediaItemEntity
    let feedTitle: String
}

/** One usable enclosure selected for a download (primary or alternate). */
struct PodcastMediaSource {
    let url: String
    let type: String?
    let form: String
}

/**
 * SQLite-backed podcast storage for the iOS host.
 *
 * A separate connection is used from StatocystDatabase so podcast writes and
 * media-item reads can happen on independent queues. WAL makes the rows visible
 * immediately to PlaybackManager and CarPlay.
 */
final class PodcastRepository {
    static let shared = PodcastRepository()

    private let queue = DispatchQueue(label: "com.hopefulaspirationsindustries.statocyst.podcasts")
    private var db: OpaquePointer?

    init(url: URL = StatocystDatabase.shared.databaseURL) {
        if sqlite3_open_v2(
            url.path,
            &db,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
            nil
        ) != SQLITE_OK {
            db = nil
            return
        }
        sqlite3_busy_timeout(db, 5_000)
        exec("PRAGMA journal_mode = WAL;")
        exec("PRAGMA synchronous = NORMAL;")
    }

    deinit {
        if let db = db {
            sqlite3_close(db)
        }
    }

    // MARK: - Reads

    func listFeeds() -> [PodcastFeedRecord] {
        return queue.sync {
            var records: [PodcastFeedRecord] = []
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "SELECT \(Self.feedColumns) FROM podcast_feed ORDER BY title COLLATE NOCASE;",
                -1,
                &stmt,
                nil
            ) == SQLITE_OK else { return [] }
            while sqlite3_step(stmt) == SQLITE_ROW {
                guard let feed = readFeed(stmt) else { continue }
                let counts = episodeCountsLocked(feedId: feed.id)
                records.append(PodcastFeedRecord(feed: feed, unplayed: counts.0, newEpisodes: counts.0))
            }
            return records
        }
    }

    func getFeed(id: String) -> PodcastFeedRecord? {
        return queue.sync { feedRecordLocked(id: id) }
    }

    func getFeedByUrl(_ url: String) -> PodcastFeedRecord? {
        return queue.sync {
            guard let id = feedIdByUrlLocked(url) else { return nil }
            return feedRecordLocked(id: id)
        }
    }

    func listEpisodes(feedId: String) -> [PodcastEpisodeRecord] {
        return queue.sync { listEpisodesLocked(feedId: feedId) }
    }

    func getEpisode(id: String) -> PodcastEpisodeRecord? {
        return queue.sync { episodeRecordLocked(id: id) }
    }

    /// The enclosure for a podcast media item in the requested form.
    ///
    /// Returns nil when the feed does not publish that form; the caller must not
    /// guess a tier or fall back to a different source silently.
    func mediaSourceForMedia(mediaItemId: String, form: String) -> PodcastMediaSource? {
        let wanted = StatocystDatabase.normalizedMediaForm(form)
        return queue.sync {
            guard let episode = episodeLockedByMedia(mediaItemId) else { return nil }
            if StatocystDatabase.normalizedMediaForm(episode.mediaForm) == wanted,
               let url = Self.httpUrl(episode.enclosureUrl) {
                return PodcastMediaSource(url: url, type: episode.enclosureType, form: wanted)
            }
            return Self.alternates(fromJson: episode.alternatesJson).first { $0.form == wanted }
        }
    }

    /// The media item's primary form, read from the episode row.
    func mediaFormForMedia(mediaItemId: String) -> String? {
        return queue.sync {
            episodeLockedByMedia(mediaItemId).map {
                StatocystDatabase.normalizedMediaForm($0.mediaForm)
            }
        }
    }

    // MARK: - Writes

    @discardableResult
    func saveFeed(feedJson: [String: Any], episodes: [[String: Any]]) -> PodcastFeedRecord? {
        return queue.sync {
            let now = Self.isoNow()
            let url = Self.string(feedJson, "feedUrl") ?? ""
            guard !url.isEmpty else { return nil }
            let existing = feedIdByUrlLocked(url).flatMap { feedLocked(id: $0) }
            let id = existing?.id ?? UUID().uuidString
            let feed = PodcastFeedEntity(
                id: id,
                feedUrl: url,
                resolvedUrl: Self.optionalString(feedJson, "resolvedUrl"),
                siteUrl: Self.optionalString(feedJson, "siteUrl"),
                title: Self.string(feedJson, "title") ?? url,
                author: Self.optionalString(feedJson, "author"),
                descriptionText: Self.optionalString(feedJson, "descriptionText"),
                imageUrl: Self.optionalString(feedJson, "imageUrl"),
                artworkPath: Self.optionalString(feedJson, "artworkPath") ?? existing?.artworkPath,
                language: Self.optionalString(feedJson, "language"),
                explicit: Self.bool(feedJson, "explicit"),
                categoriesJson: Self.jsonString(feedJson["categories"]),
                feedType: Self.string(feedJson, "feedType") ?? "rss",
                podcastIndexId: Self.optionalInt64(feedJson, "podcastIndexId"),
                etag: Self.optionalString(feedJson, "etag"),
                lastModified: Self.optionalString(feedJson, "lastModified"),
                lastFetchedAt: Self.optionalString(feedJson, "lastFetchedAt"),
                lastSuccessAt: Self.optionalString(feedJson, "lastSuccessAt"),
                nextFetchAt: Self.optionalString(feedJson, "nextFetchAt"),
                fetchError: Self.optionalString(feedJson, "fetchError"),
                failureCount: Self.int(feedJson, "failureCount") ?? 0,
                refreshIntervalMinutes: Self.int(feedJson, "refreshIntervalMinutes")
                    ?? existing?.refreshIntervalMinutes ?? 60,
                defaultSpeed: Self.double(feedJson, "defaultSpeed") ?? existing?.defaultSpeed ?? 1.0,
                skipIntroSeconds: Self.int(feedJson, "skipIntroSeconds")
                    ?? existing?.skipIntroSeconds ?? 0,
                skipOutroSeconds: Self.int(feedJson, "skipOutroSeconds")
                    ?? existing?.skipOutroSeconds ?? 0,
                autoQueue: Self.bool(feedJson, "autoQueue", fallback: existing?.autoQueue ?? true),
                episodeSort: Self.string(feedJson, "episodeSort")
                    ?? existing?.episodeSort ?? "newest",
                subscribed: Self.bool(feedJson, "subscribed", fallback: existing?.subscribed ?? true),
                lastViewedAt: existing?.lastViewedAt,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                defaultMediaForm: Self.mediaFormValue(feedJson["defaultMediaForm"])
                    ?? existing?.defaultMediaForm ?? "audio"
            )
            exec("BEGIN IMMEDIATE;")
            guard insertFeedLocked(feed) else {
                exec("ROLLBACK;")
                return nil
            }
            for episodeJson in episodes {
                saveEpisodeLocked(feed: feed, json: episodeJson, now: now)
            }
            exec("COMMIT;")
            return feedRecordLocked(id: id)
        }
    }

    @discardableResult
    func updateFeed(id: String, patch: [String: Any]) -> PodcastFeedRecord? {
        return queue.sync {
            guard var feed = feedLocked(id: id) else { return nil }
            feed.title = Self.string(patch, "title") ?? feed.title
            feed.refreshIntervalMinutes = Self.int(patch, "refreshIntervalMinutes")
                ?? feed.refreshIntervalMinutes
            feed.defaultSpeed = Self.double(patch, "defaultSpeed") ?? feed.defaultSpeed
            feed.skipIntroSeconds = Self.int(patch, "skipIntroSeconds") ?? feed.skipIntroSeconds
            feed.skipOutroSeconds = Self.int(patch, "skipOutroSeconds") ?? feed.skipOutroSeconds
            feed.autoQueue = Self.bool(patch, "autoQueue", fallback: feed.autoQueue)
            feed.episodeSort = Self.string(patch, "episodeSort") ?? feed.episodeSort
            feed.subscribed = Self.bool(patch, "subscribed", fallback: feed.subscribed)
            feed.defaultMediaForm = Self.mediaFormValue(patch["defaultMediaForm"]) ?? feed.defaultMediaForm
            feed.updatedAt = Self.isoNow()
            guard insertFeedLocked(feed) else { return nil }
            return feedRecordLocked(id: id)
        }
    }

    @discardableResult
    func removeFeed(id: String) -> Bool {
        return queue.sync {
            let episodes = episodesLocked(feedId: id)
            exec("BEGIN IMMEDIATE;")
            for episode in episodes {
                deleteMediaLocked(episode.mediaItemId)
                deleteEpisodeLocked(episode.id)
            }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(db, "DELETE FROM podcast_feed WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK else {
                exec("ROLLBACK;")
                return false
            }
            bind(stmt, 1, id)
            _ = sqlite3_step(stmt)
            exec("COMMIT;")
            return true
        }
    }

    @discardableResult
    func setPlayed(id: String, played: Bool) -> PodcastEpisodeRecord? {
        return queue.sync {
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "UPDATE podcast_episode SET played = ?, completed = ?, resumePositionMs = 0, updatedAt = ? WHERE id = ?;",
                -1,
                &stmt,
                nil
            ) == SQLITE_OK else { return nil }
            sqlite3_bind_int(stmt, 1, played ? 1 : 0)
            sqlite3_bind_int(stmt, 2, played ? 1 : 0)
            bind(stmt, 3, Self.isoNow())
            bind(stmt, 4, id)
            _ = sqlite3_step(stmt)
            return episodeRecordLocked(id: id)
        }
    }

    @discardableResult
    func setResume(id: String, positionMs: Int64) -> Bool {
        return queue.sync {
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "UPDATE podcast_episode SET resumePositionMs = ?, updatedAt = ? WHERE id = ?;",
                -1,
                &stmt,
                nil
            ) == SQLITE_OK else { return false }
            sqlite3_bind_int64(stmt, 1, max(0, positionMs))
            bind(stmt, 2, Self.isoNow())
            bind(stmt, 3, id)
            return sqlite3_step(stmt) == SQLITE_DONE
        }
    }

    @discardableResult
    func setResumeForMedia(mediaItemId: String, positionMs: Int64) -> Bool {
        return queue.sync {
            guard let episode = episodeLockedByMedia(mediaItemId) else { return false }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "UPDATE podcast_episode SET resumePositionMs = ?, updatedAt = ? WHERE id = ?;",
                -1,
                &stmt,
                nil
            ) == SQLITE_OK else { return false }
            sqlite3_bind_int64(stmt, 1, max(0, positionMs))
            bind(stmt, 2, Self.isoNow())
            bind(stmt, 3, episode.id)
            return sqlite3_step(stmt) == SQLITE_DONE
        }
    }

    /// The saved resume position for a podcast media item, or zero for music.
    func resumeForMedia(mediaItemId: String) -> Int64 {
        return queue.sync {
            episodeLockedByMedia(mediaItemId)?.resumePositionMs ?? 0
        }
    }

    /// Records the first play of an episode, matching the desktop host.
    @discardableResult
    func markStartedForMedia(mediaItemId: String) -> Bool {
        return queue.sync {
            guard let episode = episodeLockedByMedia(mediaItemId) else { return false }
            var stmt: OpaquePointer?
            defer { sqlite3_finalize(stmt) }
            guard sqlite3_prepare_v2(
                db,
                "UPDATE podcast_episode SET lastPlayedAt = ?, playCount = playCount + 1, updatedAt = ? WHERE id = ?;",
                -1,
                &stmt,
                nil
            ) == SQLITE_OK else { return false }
            let now = Self.isoNow()
            bind(stmt, 1, now)
            bind(stmt, 2, now)
            bind(stmt, 3, episode.id)
            return sqlite3_step(stmt) == SQLITE_DONE
        }
    }

    // MARK: - Locked helpers

    private func feedRecordLocked(id: String) -> PodcastFeedRecord? {
        guard let feed = feedLocked(id: id) else { return nil }
        let counts = episodeCountsLocked(feedId: id)
        return PodcastFeedRecord(feed: feed, unplayed: counts.0, newEpisodes: counts.0)
    }

    private func episodeCountsLocked(feedId: String) -> (Int, Int) {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(
            db,
            "SELECT COUNT(*), SUM(CASE WHEN played = 0 THEN 1 ELSE 0 END) FROM podcast_episode WHERE feedId = ?;",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return (0, 0) }
        bind(stmt, 1, feedId)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return (0, 0) }
        let total = Int(sqlite3_column_int(stmt, 0))
        let unplayed = Int(sqlite3_column_int(stmt, 1))
        return (total, unplayed)
    }

    private func feedIdByUrlLocked(_ url: String) -> String? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT id FROM podcast_feed WHERE feedUrl = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK
        else { return nil }
        bind(stmt, 1, url)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return text(stmt, 0)
    }

    private func feedLocked(id: String) -> PodcastFeedEntity? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(
            db,
            "SELECT \(Self.feedColumns) FROM podcast_feed WHERE id = ? LIMIT 1;",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return nil }
        bind(stmt, 1, id)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return readFeed(stmt)
    }

    private func episodesLocked(feedId: String) -> [PodcastEpisodeEntity] {
        var items: [PodcastEpisodeEntity] = []
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(
            db,
            "SELECT \(Self.episodeColumns) FROM podcast_episode WHERE feedId = ? " +
                "ORDER BY COALESCE(publishedAt, firstSeenAt) DESC;",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return [] }
        bind(stmt, 1, feedId)
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let episode = readEpisode(stmt) { items.append(episode) }
        }
        return items
    }

    private func listEpisodesLocked(feedId: String) -> [PodcastEpisodeRecord] {
        let feedTitle = feedLocked(id: feedId)?.title ?? "Podcasts"
        return episodesLocked(feedId: feedId).compactMap { episode in
            guard let media = mediaLocked(id: episode.mediaItemId) else { return nil }
            return PodcastEpisodeRecord(episode: episode, media: media, feedTitle: feedTitle)
        }
    }

    private func episodeLocked(id: String) -> PodcastEpisodeEntity? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(
            db,
            "SELECT \(Self.episodeColumns) FROM podcast_episode WHERE id = ? LIMIT 1;",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return nil }
        bind(stmt, 1, id)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return readEpisode(stmt)
    }

    private func episodeLockedByMedia(_ mediaItemId: String) -> PodcastEpisodeEntity? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(
            db,
            "SELECT \(Self.episodeColumns) FROM podcast_episode WHERE mediaItemId = ? LIMIT 1;",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return nil }
        bind(stmt, 1, mediaItemId)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return readEpisode(stmt)
    }

    private func episodeRecordLocked(id: String) -> PodcastEpisodeRecord? {
        guard let episode = episodeLocked(id: id),
              let media = mediaLocked(id: episode.mediaItemId) else { return nil }
        let title = feedLocked(id: episode.feedId)?.title ?? "Podcasts"
        return PodcastEpisodeRecord(episode: episode, media: media, feedTitle: title)
    }

    private func episodeByGuidLocked(feedId: String, guid: String) -> PodcastEpisodeEntity? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(
            db,
            "SELECT \(Self.episodeColumns) FROM podcast_episode WHERE feedId = ? AND guid = ? LIMIT 1;",
            -1,
            &stmt,
            nil
        ) == SQLITE_OK else { return nil }
        bind(stmt, 1, feedId)
        bind(stmt, 2, guid)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return readEpisode(stmt)
    }

    private func mediaLocked(id: String) -> MediaItemEntity? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT * FROM media_item WHERE id = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK
        else { return nil }
        bind(stmt, 1, id)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return readMedia(stmt)
    }

    private func mediaIdByPathKeyLocked(_ pathKey: String) -> String? {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT id FROM media_item WHERE pathKey = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK
        else { return nil }
        bind(stmt, 1, pathKey)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return text(stmt, 0)
    }

    private func insertFeedLocked(_ feed: PodcastFeedEntity) -> Bool {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        let sql = """
            INSERT OR REPLACE INTO podcast_feed (
                id, feedUrl, resolvedUrl, siteUrl, title, author, descriptionText, imageUrl,
                artworkPath, language, explicit, categoriesJson, feedType, podcastIndexId,
                etag, lastModified, lastFetchedAt, lastSuccessAt, nextFetchAt, fetchError,
                failureCount, refreshIntervalMinutes, defaultSpeed, skipIntroSeconds,
                skipOutroSeconds, autoQueue, episodeSort, subscribed, lastViewedAt, createdAt, updatedAt,
                defaultMediaForm
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            );
        """
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
        bind(stmt, 1, feed.id)
        bind(stmt, 2, feed.feedUrl)
        bindOptional(stmt, 3, feed.resolvedUrl)
        bindOptional(stmt, 4, feed.siteUrl)
        bind(stmt, 5, feed.title)
        bindOptional(stmt, 6, feed.author)
        bindOptional(stmt, 7, feed.descriptionText)
        bindOptional(stmt, 8, feed.imageUrl)
        bindOptional(stmt, 9, feed.artworkPath)
        bindOptional(stmt, 10, feed.language)
        sqlite3_bind_int(stmt, 11, feed.explicit ? 1 : 0)
        bindOptional(stmt, 12, feed.categoriesJson)
        bind(stmt, 13, feed.feedType)
        bindOptionalInt64(stmt, 14, feed.podcastIndexId)
        bindOptional(stmt, 15, feed.etag)
        bindOptional(stmt, 16, feed.lastModified)
        bindOptional(stmt, 17, feed.lastFetchedAt)
        bindOptional(stmt, 18, feed.lastSuccessAt)
        bindOptional(stmt, 19, feed.nextFetchAt)
        bindOptional(stmt, 20, feed.fetchError)
        sqlite3_bind_int(stmt, 21, Int32(feed.failureCount))
        sqlite3_bind_int(stmt, 22, Int32(feed.refreshIntervalMinutes))
        sqlite3_bind_double(stmt, 23, feed.defaultSpeed)
        sqlite3_bind_int(stmt, 24, Int32(feed.skipIntroSeconds))
        sqlite3_bind_int(stmt, 25, Int32(feed.skipOutroSeconds))
        sqlite3_bind_int(stmt, 26, feed.autoQueue ? 1 : 0)
        bind(stmt, 27, feed.episodeSort)
        sqlite3_bind_int(stmt, 28, feed.subscribed ? 1 : 0)
        bindOptional(stmt, 29, feed.lastViewedAt)
        bind(stmt, 30, feed.createdAt)
        bind(stmt, 31, feed.updatedAt)
        bind(stmt, 32, StatocystDatabase.normalizedMediaForm(feed.defaultMediaForm))
        return sqlite3_step(stmt) == SQLITE_DONE
    }

    private func saveEpisodeLocked(feed: PodcastFeedEntity, json: [String: Any], now: String) {
        let enclosure = Self.string(json, "enclosureUrl") ?? ""
        let guid = Self.string(json, "guid") ?? enclosure
        guard !enclosure.isEmpty, !guid.isEmpty else { return }
        let pathKey = Self.string(json, "pathKey") ?? "podcast:\(feed.id):\(guid)"
        let existingEpisode = episodeByGuidLocked(feedId: feed.id, guid: guid)
        let existingMediaId = mediaIdByPathKeyLocked(pathKey)
        let mediaId = existingMediaId ?? existingEpisode?.mediaItemId ?? UUID().uuidString
        let existingMedia = existingMediaId.flatMap { mediaLocked(id: $0) }
        let title = Self.string(json, "title") ?? "Untitled episode"
        let enclosureType = Self.optionalString(json, "enclosureType")
        let ext = Self.extensionFor(type: enclosureType, url: enclosure)
        let publishedAt = Self.optionalString(json, "publishedAt")
        let year = publishedAt.flatMap { Int($0.prefix(4)) }
        let artworkPath = Self.optionalString(json, "artworkPath") ?? feed.artworkPath
        let mediaForm = Self.mediaFormValue(json["mediaForm"])
            ?? existingEpisode?.mediaForm ?? "audio"
        let alternatesJson: String?
        if let rawAlternates = json["alternates"] {
            alternatesJson = Self.alternatesJson(rawAlternates, excluding: enclosure)
        } else {
            alternatesJson = existingEpisode?.alternatesJson
        }
        let media = MediaItemEntity(
            id: mediaId,
            sourceId: "podcast",
            path: enclosure,
            pathKey: pathKey,
            fileName: "\(title).\(ext)",
            ext: ext,
            sizeBytes: Self.int64(json, "enclosureLengthBytes") ?? 0,
            mtimeMs: 0,
            title: title,
            artist: feed.title,
            album: feed.title,
            albumArtist: feed.author ?? feed.title,
            trackNo: Self.optionalInt(json, "episodeNo"),
            discNo: Self.optionalInt(json, "seasonNo"),
            year: year,
            genre: "Podcast",
            durationMs: Self.int64(json, "durationMs") ?? 0,
            bitrate: nil,
            sampleRate: nil,
            channels: nil,
            codec: enclosureType,
            format: enclosureType,
            artworkPath: artworkPath,
            jellyfinImageTag: nil,
            sourceKind: "podcast",
            sourceLabel: "Podcasts",
            addedAt: existingMedia?.addedAt ?? now,
            updatedAt: now,
            missing: false,
            albumId: nil,
            serverId: "",
            mediaKind: "podcast",
            mediaForm: mediaForm
        )
        _ = upsertMediaLocked(media)

        let episode = PodcastEpisodeEntity(
            id: existingEpisode?.id ?? UUID().uuidString,
            feedId: feed.id,
            mediaItemId: mediaId,
            guid: guid,
            title: title,
            descriptionText: Self.optionalString(json, "descriptionText"),
            linksJson: Self.jsonString(json["links"]),
            link: Self.optionalString(json, "link"),
            enclosureUrl: enclosure,
            enclosureType: enclosureType,
            enclosureLengthBytes: Self.optionalInt64(json, "enclosureLengthBytes"),
            durationMs: Self.int64(json, "durationMs") ?? 0,
            publishedAt: publishedAt,
            seasonNo: Self.optionalInt(json, "seasonNo"),
            episodeNo: Self.optionalInt(json, "episodeNo"),
            episodeType: Self.optionalString(json, "episodeType"),
            imageUrl: Self.optionalString(json, "imageUrl"),
            artworkPath: artworkPath,
            explicit: Self.bool(json, "explicit"),
            chaptersUrl: Self.optionalString(json, "chaptersUrl"),
            transcriptUrl: Self.optionalString(json, "transcriptUrl"),
            transcriptType: Self.optionalString(json, "transcriptType"),
            playbackSpeed: existingEpisode?.playbackSpeed,
            resumePositionMs: existingEpisode?.resumePositionMs ?? 0,
            played: existingEpisode?.played ?? false,
            completed: existingEpisode?.completed ?? false,
            playCount: existingEpisode?.playCount ?? 0,
            lastPlayedAt: existingEpisode?.lastPlayedAt,
            firstSeenAt: Self.optionalString(json, "firstSeenAt") ?? existingEpisode?.firstSeenAt ?? now,
            createdAt: existingEpisode?.createdAt ?? now,
            updatedAt: now,
            mediaForm: mediaForm,
            alternatesJson: alternatesJson,
            posterUrl: Self.optionalString(json, "posterUrl") ?? existingEpisode?.posterUrl,
            videoWidth: Self.optionalInt(json, "videoWidth") ?? existingEpisode?.videoWidth,
            videoHeight: Self.optionalInt(json, "videoHeight") ?? existingEpisode?.videoHeight
        )
        _ = insertEpisodeLocked(episode)
    }

    private func insertEpisodeLocked(_ episode: PodcastEpisodeEntity) -> Bool {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        let sql = """
            INSERT OR REPLACE INTO podcast_episode (
                id, feedId, mediaItemId, guid, title, descriptionText, linksJson, link,
                enclosureUrl, enclosureType, enclosureLengthBytes, durationMs, publishedAt,
                seasonNo, episodeNo, episodeType, imageUrl, artworkPath, explicit,
                chaptersUrl, transcriptUrl, transcriptType, playbackSpeed, resumePositionMs,
                played, completed, playCount, lastPlayedAt, firstSeenAt, createdAt, updatedAt,
                mediaForm, alternatesJson, posterUrl, videoWidth, videoHeight
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            );
        """
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
        bind(stmt, 1, episode.id)
        bind(stmt, 2, episode.feedId)
        bind(stmt, 3, episode.mediaItemId)
        bind(stmt, 4, episode.guid)
        bind(stmt, 5, episode.title)
        bindOptional(stmt, 6, episode.descriptionText)
        bindOptional(stmt, 7, episode.linksJson)
        bindOptional(stmt, 8, episode.link)
        bind(stmt, 9, episode.enclosureUrl)
        bindOptional(stmt, 10, episode.enclosureType)
        bindOptionalInt64(stmt, 11, episode.enclosureLengthBytes)
        sqlite3_bind_int64(stmt, 12, episode.durationMs)
        bindOptional(stmt, 13, episode.publishedAt)
        bindOptionalInt(stmt, 14, episode.seasonNo)
        bindOptionalInt(stmt, 15, episode.episodeNo)
        bindOptional(stmt, 16, episode.episodeType)
        bindOptional(stmt, 17, episode.imageUrl)
        bindOptional(stmt, 18, episode.artworkPath)
        sqlite3_bind_int(stmt, 19, episode.explicit ? 1 : 0)
        bindOptional(stmt, 20, episode.chaptersUrl)
        bindOptional(stmt, 21, episode.transcriptUrl)
        bindOptional(stmt, 22, episode.transcriptType)
        if let speed = episode.playbackSpeed {
            sqlite3_bind_double(stmt, 23, speed)
        } else {
            sqlite3_bind_null(stmt, 23)
        }
        sqlite3_bind_int64(stmt, 24, episode.resumePositionMs)
        sqlite3_bind_int(stmt, 25, episode.played ? 1 : 0)
        sqlite3_bind_int(stmt, 26, episode.completed ? 1 : 0)
        sqlite3_bind_int(stmt, 27, Int32(episode.playCount))
        bindOptional(stmt, 28, episode.lastPlayedAt)
        bind(stmt, 29, episode.firstSeenAt)
        bind(stmt, 30, episode.createdAt)
        bind(stmt, 31, episode.updatedAt)
        bind(stmt, 32, StatocystDatabase.normalizedMediaForm(episode.mediaForm))
        bindOptional(stmt, 33, episode.alternatesJson)
        bindOptional(stmt, 34, episode.posterUrl)
        bindOptionalInt(stmt, 35, episode.videoWidth)
        bindOptionalInt(stmt, 36, episode.videoHeight)
        return sqlite3_step(stmt) == SQLITE_DONE
    }

    private func deleteMediaLocked(_ id: String) {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "DELETE FROM media_item WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK else { return }
        bind(stmt, 1, id)
        _ = sqlite3_step(stmt)
    }

    private func deleteEpisodeLocked(_ id: String) {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "DELETE FROM podcast_episode WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK else { return }
        bind(stmt, 1, id)
        _ = sqlite3_step(stmt)
    }

    private func upsertMediaLocked(_ item: MediaItemEntity) -> Bool {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        let sql = """
            INSERT OR REPLACE INTO media_item (
                id, sourceId, path, pathKey, fileName, ext, sizeBytes, mtimeMs,
                title, artist, album, albumArtist, trackNo, discNo, year, genre,
                durationMs, bitrate, sampleRate, channels, codec, format,
                artworkPath, jellyfinImageTag, sourceKind, sourceLabel,
                addedAt, updatedAt, missing, albumId, serverId, mediaKind, mediaForm
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            );
        """
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
        bind(stmt, 1, item.id)
        bind(stmt, 2, item.sourceId)
        bind(stmt, 3, item.path)
        bind(stmt, 4, item.pathKey)
        bind(stmt, 5, item.fileName)
        bind(stmt, 6, item.ext)
        sqlite3_bind_int64(stmt, 7, item.sizeBytes)
        sqlite3_bind_int64(stmt, 8, item.mtimeMs)
        bind(stmt, 9, item.title)
        bind(stmt, 10, item.artist)
        bind(stmt, 11, item.album)
        bindOptional(stmt, 12, item.albumArtist)
        bindOptionalInt(stmt, 13, item.trackNo)
        bindOptionalInt(stmt, 14, item.discNo)
        bindOptionalInt(stmt, 15, item.year)
        bindOptional(stmt, 16, item.genre)
        sqlite3_bind_int64(stmt, 17, item.durationMs)
        bindOptionalInt(stmt, 18, item.bitrate)
        bindOptionalInt(stmt, 19, item.sampleRate)
        bindOptionalInt(stmt, 20, item.channels)
        bindOptional(stmt, 21, item.codec)
        bindOptional(stmt, 22, item.format)
        bindOptional(stmt, 23, item.artworkPath)
        bindOptional(stmt, 24, item.jellyfinImageTag)
        bind(stmt, 25, item.sourceKind)
        bind(stmt, 26, item.sourceLabel)
        bind(stmt, 27, item.addedAt)
        bind(stmt, 28, item.updatedAt)
        sqlite3_bind_int(stmt, 29, item.missing ? 1 : 0)
        bindOptional(stmt, 30, item.albumId)
        bind(stmt, 31, item.serverId)
        bind(stmt, 32, item.mediaKind)
        bind(stmt, 33, StatocystDatabase.normalizedMediaForm(item.mediaForm))
        return sqlite3_step(stmt) == SQLITE_DONE
    }

    // MARK: - Row readers

    private func readFeed(_ stmt: OpaquePointer?) -> PodcastFeedEntity? {
        guard let stmt = stmt else { return nil }
        return PodcastFeedEntity(
            id: text(stmt, 0),
            feedUrl: text(stmt, 1),
            resolvedUrl: optionalText(stmt, 2),
            siteUrl: optionalText(stmt, 3),
            title: text(stmt, 4),
            author: optionalText(stmt, 5),
            descriptionText: optionalText(stmt, 6),
            imageUrl: optionalText(stmt, 7),
            artworkPath: optionalText(stmt, 8),
            language: optionalText(stmt, 9),
            explicit: sqlite3_column_int(stmt, 10) != 0,
            categoriesJson: optionalText(stmt, 11),
            feedType: text(stmt, 12),
            podcastIndexId: optionalInt64(stmt, 13),
            etag: optionalText(stmt, 14),
            lastModified: optionalText(stmt, 15),
            lastFetchedAt: optionalText(stmt, 16),
            lastSuccessAt: optionalText(stmt, 17),
            nextFetchAt: optionalText(stmt, 18),
            fetchError: optionalText(stmt, 19),
            failureCount: Int(sqlite3_column_int(stmt, 20)),
            refreshIntervalMinutes: Int(sqlite3_column_int(stmt, 21)),
            defaultSpeed: sqlite3_column_double(stmt, 22),
            skipIntroSeconds: Int(sqlite3_column_int(stmt, 23)),
            skipOutroSeconds: Int(sqlite3_column_int(stmt, 24)),
            autoQueue: sqlite3_column_int(stmt, 25) != 0,
            episodeSort: text(stmt, 26),
            subscribed: sqlite3_column_int(stmt, 27) != 0,
            lastViewedAt: optionalText(stmt, 28),
            createdAt: text(stmt, 29),
            updatedAt: text(stmt, 30),
            defaultMediaForm: StatocystDatabase.normalizedMediaForm(optionalText(stmt, 31))
        )
    }

    private func readEpisode(_ stmt: OpaquePointer?) -> PodcastEpisodeEntity? {
        guard let stmt = stmt else { return nil }
        return PodcastEpisodeEntity(
            id: text(stmt, 0),
            feedId: text(stmt, 1),
            mediaItemId: text(stmt, 2),
            guid: text(stmt, 3),
            title: text(stmt, 4),
            descriptionText: optionalText(stmt, 5),
            linksJson: optionalText(stmt, 6),
            link: optionalText(stmt, 7),
            enclosureUrl: text(stmt, 8),
            enclosureType: optionalText(stmt, 9),
            enclosureLengthBytes: optionalInt64(stmt, 10),
            durationMs: sqlite3_column_int64(stmt, 11),
            publishedAt: optionalText(stmt, 12),
            seasonNo: optionalInt(stmt, 13),
            episodeNo: optionalInt(stmt, 14),
            episodeType: optionalText(stmt, 15),
            imageUrl: optionalText(stmt, 16),
            artworkPath: optionalText(stmt, 17),
            explicit: sqlite3_column_int(stmt, 18) != 0,
            chaptersUrl: optionalText(stmt, 19),
            transcriptUrl: optionalText(stmt, 20),
            transcriptType: optionalText(stmt, 21),
            playbackSpeed: optionalDouble(stmt, 22),
            resumePositionMs: sqlite3_column_int64(stmt, 23),
            played: sqlite3_column_int(stmt, 24) != 0,
            completed: sqlite3_column_int(stmt, 25) != 0,
            playCount: Int(sqlite3_column_int(stmt, 26)),
            lastPlayedAt: optionalText(stmt, 27),
            firstSeenAt: text(stmt, 28),
            createdAt: text(stmt, 29),
            updatedAt: text(stmt, 30),
            mediaForm: StatocystDatabase.normalizedMediaForm(optionalText(stmt, 31)),
            alternatesJson: optionalText(stmt, 32),
            posterUrl: optionalText(stmt, 33),
            videoWidth: optionalInt(stmt, 34),
            videoHeight: optionalInt(stmt, 35)
        )
    }

    private func readMedia(_ stmt: OpaquePointer?) -> MediaItemEntity? {
        guard let stmt = stmt else { return nil }
        return MediaItemEntity(
            id: text(stmt, 0),
            sourceId: text(stmt, 1),
            path: text(stmt, 2),
            pathKey: text(stmt, 3),
            fileName: text(stmt, 4),
            ext: text(stmt, 5),
            sizeBytes: sqlite3_column_int64(stmt, 6),
            mtimeMs: sqlite3_column_int64(stmt, 7),
            title: text(stmt, 8),
            artist: text(stmt, 9),
            album: text(stmt, 10),
            albumArtist: optionalText(stmt, 11),
            trackNo: optionalInt(stmt, 12),
            discNo: optionalInt(stmt, 13),
            year: optionalInt(stmt, 14),
            genre: optionalText(stmt, 15),
            durationMs: sqlite3_column_int64(stmt, 16),
            bitrate: optionalInt(stmt, 17),
            sampleRate: optionalInt(stmt, 18),
            channels: optionalInt(stmt, 19),
            codec: optionalText(stmt, 20),
            format: optionalText(stmt, 21),
            artworkPath: optionalText(stmt, 22),
            jellyfinImageTag: optionalText(stmt, 23),
            sourceKind: text(stmt, 24),
            sourceLabel: text(stmt, 25),
            addedAt: text(stmt, 26),
            updatedAt: text(stmt, 27),
            missing: sqlite3_column_int(stmt, 28) != 0,
            albumId: optionalText(stmt, 29),
            serverId: text(stmt, 30),
            mediaKind: optionalText(stmt, 31) ?? "music",
            mediaForm: StatocystDatabase.normalizedMediaForm(optionalText(stmt, 32))
        )
    }

    // MARK: - SQL helpers

    private static let feedColumns = """
        id, feedUrl, resolvedUrl, siteUrl, title, author, descriptionText, imageUrl,
        artworkPath, language, explicit, categoriesJson, feedType, podcastIndexId,
        etag, lastModified, lastFetchedAt, lastSuccessAt, nextFetchAt, fetchError,
        failureCount, refreshIntervalMinutes, defaultSpeed, skipIntroSeconds,
        skipOutroSeconds, autoQueue, episodeSort, subscribed, lastViewedAt, createdAt, updatedAt,
        defaultMediaForm
    """

    private static let episodeColumns = """
        id, feedId, mediaItemId, guid, title, descriptionText, linksJson, link,
        enclosureUrl, enclosureType, enclosureLengthBytes, durationMs, publishedAt,
        seasonNo, episodeNo, episodeType, imageUrl, artworkPath, explicit,
        chaptersUrl, transcriptUrl, transcriptType, playbackSpeed, resumePositionMs,
        played, completed, playCount, lastPlayedAt, firstSeenAt, createdAt, updatedAt,
        mediaForm, alternatesJson, posterUrl, videoWidth, videoHeight
    """

    private func exec(_ sql: String) {
        sqlite3_exec(db, sql, nil, nil, nil)
    }

    private func bind(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
        sqlite3_bind_text(stmt, index, value, -1, PODCAST_SQLITE_TRANSIENT)
    }

    private func bindOptional(_ stmt: OpaquePointer?, _ index: Int32, _ value: String?) {
        if let value = value {
            bind(stmt, index, value)
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

    private func bindOptionalInt64(_ stmt: OpaquePointer?, _ index: Int32, _ value: Int64?) {
        if let value = value {
            sqlite3_bind_int64(stmt, index, value)
        } else {
            sqlite3_bind_null(stmt, index)
        }
    }

    private func text(_ stmt: OpaquePointer?, _ index: Int32) -> String {
        guard let cString = sqlite3_column_text(stmt, index) else { return "" }
        return String(cString: cString)
    }

    private func optionalText(_ stmt: OpaquePointer?, _ index: Int32) -> String? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL,
              let cString = sqlite3_column_text(stmt, index) else { return nil }
        return String(cString: cString)
    }

    private func optionalInt(_ stmt: OpaquePointer?, _ index: Int32) -> Int? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL else { return nil }
        return Int(sqlite3_column_int(stmt, index))
    }

    private func optionalInt64(_ stmt: OpaquePointer?, _ index: Int32) -> Int64? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL else { return nil }
        return sqlite3_column_int64(stmt, index)
    }

    private func optionalDouble(_ stmt: OpaquePointer?, _ index: Int32) -> Double? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL else { return nil }
        return sqlite3_column_double(stmt, index)
    }

    // MARK: - JSON helpers

    static func string(_ json: [String: Any], _ key: String) -> String? {
        guard let value = json[key] else { return nil }
        if value is NSNull { return nil }
        if let text = value as? String { return text.isEmpty ? nil : text }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    static func optionalString(_ json: [String: Any], _ key: String) -> String? {
        string(json, key)
    }

    static func int(_ json: [String: Any], _ key: String) -> Int? {
        guard let value = json[key], !(value is NSNull) else { return nil }
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String { return Int(text) }
        return nil
    }

    static func int64(_ json: [String: Any], _ key: String) -> Int64? {
        guard let value = json[key], !(value is NSNull) else { return nil }
        if let number = value as? NSNumber { return number.int64Value }
        if let text = value as? String { return Int64(text) }
        return nil
    }

    static func optionalInt(_ json: [String: Any], _ key: String) -> Int? { int(json, key) }
    static func optionalInt64(_ json: [String: Any], _ key: String) -> Int64? { int64(json, key) }

    static func double(_ json: [String: Any], _ key: String) -> Double? {
        guard let value = json[key], !(value is NSNull) else { return nil }
        if let number = value as? NSNumber { return number.doubleValue }
        if let text = value as? String { return Double(text) }
        return nil
    }

    static func bool(_ json: [String: Any], _ key: String, fallback: Bool = false) -> Bool {
        guard let value = json[key], !(value is NSNull) else { return fallback }
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String { return text == "true" || text == "1" }
        return fallback
    }

    static func jsonString(_ value: Any?) -> String? {
        guard let value = value, JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }

    static func mediaFormValue(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        switch text.lowercased() {
        case "audio": return "audio"
        case "video": return "video"
        default: return nil
        }
    }

    static func httpUrl(_ value: String?) -> String? {
        guard let value = value,
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return value
    }

    /// Serializes the episode's non-primary enclosures. Bounded to 8, HTTP(S) only,
    /// duplicate URLs collapse, and an entry without a declared form fails closed.
    static func alternatesJson(_ value: Any?, excluding primaryUrl: String?) -> String? {
        guard let value = value as? [Any], !value.isEmpty else { return nil }
        var seen = Set<String>()
        if let primaryUrl = primaryUrl { seen.insert(primaryUrl) }
        var list: [[String: Any]] = []
        for entry in value.prefix(8) {
            guard let dict = entry as? [String: Any],
                  let url = httpUrl(string(dict, "url")),
                  let form = mediaFormValue(dict["form"]),
                  !seen.contains(url) else { continue }
            seen.insert(url)
            var item: [String: Any] = ["url": url, "form": form]
            if let type = optionalString(dict, "type") { item["type"] = type }
            if let length = optionalInt64(dict, "lengthBytes") { item["lengthBytes"] = length }
            if let width = optionalInt(dict, "width") { item["width"] = width }
            if let height = optionalInt(dict, "height") { item["height"] = height }
            if let bitrate = optionalInt(dict, "bitrate") { item["bitrate"] = bitrate }
            list.append(item)
        }
        guard !list.isEmpty else { return nil }
        return jsonString(list)
    }

    static func alternates(fromJson text: String?) -> [PodcastMediaSource] {
        guard let text = text,
              let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let raw = object as? [Any] else { return [] }
        var list: [PodcastMediaSource] = []
        for entry in raw.prefix(8) {
            guard let dict = entry as? [String: Any],
                  let url = httpUrl(string(dict, "url")),
                  let form = mediaFormValue(dict["form"]) else { continue }
            list.append(PodcastMediaSource(url: url, type: optionalString(dict, "type"), form: form))
        }
        return list
    }

    static func extensionFor(type: String?, url: String) -> String {
        switch (type ?? "").lowercased() {
        case "audio/mpeg", "audio/mp3": return "mp3"
        case "audio/mp4", "audio/x-m4a": return "m4a"
        case "audio/aac": return "aac"
        case "audio/ogg": return "ogg"
        case "audio/opus": return "opus"
        case "audio/wav", "audio/x-wav": return "wav"
        case "video/mp4": return "mp4"
        case "video/quicktime": return "mov"
        case "video/x-m4v", "video/m4v": return "m4v"
        case "video/webm": return "webm"
        case "video/x-matroska": return "mkv"
        default:
            let ext = URL(string: url)?.pathExtension.lowercased() ?? ""
            return ext.isEmpty ? "mp3" : ext
        }
    }

    static func isoNow() -> String {
        return ISO8601DateFormatter().string(from: Date())
    }
}
