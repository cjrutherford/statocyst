package net.christopherrutherford.statocyst.db

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Proves the v7 → v8 video-podcast migration. It is additive: existing music and
 * podcast rows keep their data and read as `mediaForm = "audio"`, and the new
 * podcast columns/index exist with Room's expected schema.
 */
class VideoMigrationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val databaseName = "statocyst-video-migration.db"

    @After
    fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    @Test
    fun migrate7To8PreservesRowsAndDefaultsToAudio() {
        context.deleteDatabase(databaseName)
        val raw = SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(databaseName), null)
        createV7Schema(raw)
        raw.execSQL(
            "INSERT INTO media_item (" +
                "id, sourceId, path, pathKey, fileName, ext, sizeBytes, mtimeMs, " +
                "title, artist, album, durationMs, sourceKind, sourceLabel, addedAt, updatedAt, " +
                "missing, serverId, mediaKind" +
                ") VALUES ('music-1', 'local', '/music/a.mp3', '/music/a.mp3', 'a.mp3', 'mp3', 1, 2, " +
                "'Track', 'Artist', 'Album', 1000, 'local', 'Music', 'now', 'now', 0, '', 'music')",
        )
        raw.execSQL(
            "INSERT INTO media_item (" +
                "id, sourceId, path, pathKey, fileName, ext, sizeBytes, mtimeMs, " +
                "title, artist, album, durationMs, sourceKind, sourceLabel, addedAt, updatedAt, " +
                "missing, serverId, mediaKind" +
                ") VALUES ('ep-media', 'podcast', 'https://cdn.example.com/ep.mp3', 'podcast:f1:ep-1', " +
                "'ep.mp3', 'mp3', 10, 0, 'Episode', 'Show', 'Show', 60000, 'podcast', 'Podcasts', " +
                "'now', 'now', 0, '', 'podcast')",
        )
        raw.execSQL(
            "INSERT INTO podcast_feed (" +
                "id, feedUrl, title, explicit, feedType, failureCount, refreshIntervalMinutes, " +
                "defaultSpeed, skipIntroSeconds, skipOutroSeconds, autoQueue, episodeSort, " +
                "subscribed, createdAt, updatedAt" +
                ") VALUES ('f1', 'https://feeds.example.com/show.xml', 'Show', 0, 'rss', 0, 60, " +
                "1.0, 0, 0, 1, 'newest', 1, 'now', 'now')",
        )
        raw.execSQL(
            "INSERT INTO podcast_episode (" +
                "id, feedId, mediaItemId, guid, title, enclosureUrl, durationMs, resumePositionMs, " +
                "played, completed, playCount, firstSeenAt, createdAt, updatedAt" +
                ") VALUES ('ep-1', 'f1', 'ep-media', 'ep-1', 'Episode', " +
                "'https://cdn.example.com/ep.mp3', 60000, 0, 0, 0, 0, 'now', 'now', 'now')",
        )
        raw.version = 7
        raw.close()

        val database = Room.databaseBuilder(context, StatocystDatabase::class.java, databaseName)
            .addMigrations(StatocystDatabase.MIGRATION_7_8)
            .allowMainThreadQueries()
            .build()
        try {
            val music = runBlocking { database.mediaItemDao().getById("music-1") }
            assertEquals("music", music?.mediaKind)
            assertEquals("audio", music?.mediaForm)

            val episodeMedia = runBlocking { database.mediaItemDao().getById("ep-media") }
            assertEquals("podcast", episodeMedia?.mediaKind)
            assertEquals("audio", episodeMedia?.mediaForm)

            val feed = runBlocking { database.podcastDao().getFeed("f1") }
            assertEquals("Show", feed?.title)
            assertEquals("audio", feed?.defaultMediaForm)

            val episode = runBlocking { database.podcastDao().getEpisode("ep-1") }
            assertEquals("audio", episode?.mediaForm)
            assertNull(episode?.alternatesJson)
            assertNull(episode?.posterUrl)
            assertNull(episode?.videoWidth)
            assertNull(episode?.videoHeight)

            // The new form is writable, including the alternate/poster metadata.
            val video = episode!!.copy(
                mediaForm = "video",
                alternatesJson = """[{"url":"https://cdn.example.com/ep.m4a","type":"audio/mp4","form":"audio"}]""",
                posterUrl = "https://cdn.example.com/ep.jpg",
                videoWidth = 1920,
                videoHeight = 1080,
            )
            runBlocking { database.podcastDao().upsertEpisode(video) }
            val stored = runBlocking { database.podcastDao().getEpisode("ep-1") }
            assertEquals("video", stored?.mediaForm)
            assertEquals(1920, stored?.videoWidth)
            assertEquals(1080, stored?.videoHeight)
            assertEquals("https://cdn.example.com/ep.jpg", stored?.posterUrl)
        } finally {
            database.close()
        }
    }

    private fun createV7Schema(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `media_item` (" +
                "`id` TEXT NOT NULL, `sourceId` TEXT NOT NULL, `path` TEXT NOT NULL, " +
                "`pathKey` TEXT NOT NULL, `fileName` TEXT NOT NULL, `ext` TEXT NOT NULL, " +
                "`sizeBytes` INTEGER NOT NULL, `mtimeMs` INTEGER NOT NULL, `title` TEXT NOT NULL, " +
                "`artist` TEXT NOT NULL, `album` TEXT NOT NULL, `albumArtist` TEXT, " +
                "`trackNo` INTEGER, `discNo` INTEGER, `year` INTEGER, `genre` TEXT, " +
                "`durationMs` INTEGER NOT NULL, `bitrate` INTEGER, `sampleRate` INTEGER, " +
                "`channels` INTEGER, `codec` TEXT, `format` TEXT, `artworkPath` TEXT, " +
                "`jellyfinImageTag` TEXT, `sourceKind` TEXT NOT NULL, `sourceLabel` TEXT NOT NULL, " +
                "`addedAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, `missing` INTEGER NOT NULL, " +
                "`albumId` TEXT, `serverId` TEXT NOT NULL DEFAULT '', " +
                "`mediaKind` TEXT NOT NULL DEFAULT 'music', PRIMARY KEY(`id`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `download` (" +
                "`trackId` TEXT NOT NULL, `localPath` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, " +
                "`sha256` TEXT NOT NULL, `container` TEXT, `verified` INTEGER NOT NULL, " +
                "`createdAt` TEXT NOT NULL, `profile` TEXT NOT NULL DEFAULT 'original', " +
                "`codec` TEXT, `bitRate` INTEGER, `sourceBytes` INTEGER NOT NULL DEFAULT 0, " +
                "PRIMARY KEY(`trackId`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `cache_entry` (" +
                "`trackId` TEXT NOT NULL, `localPath` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, " +
                "`container` TEXT, `createdAt` INTEGER NOT NULL, `lastAccessAt` INTEGER NOT NULL, " +
                "PRIMARY KEY(`trackId`))",
        )
        db.execSQL("CREATE TABLE IF NOT EXISTS `favorite` (`trackId` TEXT NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`trackId`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `playlist` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`id`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `playlist_track` (`playlistId` TEXT NOT NULL, `position` INTEGER NOT NULL, `trackId` TEXT NOT NULL, PRIMARY KEY(`playlistId`, `position`))")
        db.execSQL("CREATE TABLE IF NOT EXISTS `recent` (`trackId` TEXT NOT NULL, `playedAt` INTEGER NOT NULL, PRIMARY KEY(`trackId`))")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `podcast_feed` (" +
                "`id` TEXT NOT NULL, `feedUrl` TEXT NOT NULL, `resolvedUrl` TEXT, " +
                "`siteUrl` TEXT, `title` TEXT NOT NULL, `author` TEXT, `descriptionText` TEXT, " +
                "`imageUrl` TEXT, `artworkPath` TEXT, `language` TEXT, " +
                "`explicit` INTEGER NOT NULL, `categoriesJson` TEXT, `feedType` TEXT NOT NULL, " +
                "`podcastIndexId` INTEGER, `etag` TEXT, `lastModified` TEXT, `lastFetchedAt` TEXT, " +
                "`lastSuccessAt` TEXT, `nextFetchAt` TEXT, `fetchError` TEXT, " +
                "`failureCount` INTEGER NOT NULL, `refreshIntervalMinutes` INTEGER NOT NULL, " +
                "`defaultSpeed` REAL NOT NULL, `skipIntroSeconds` INTEGER NOT NULL, " +
                "`skipOutroSeconds` INTEGER NOT NULL, `autoQueue` INTEGER NOT NULL, " +
                "`episodeSort` TEXT NOT NULL, `subscribed` INTEGER NOT NULL, `lastViewedAt` TEXT, " +
                "`createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, PRIMARY KEY(`id`))",
        )
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_podcast_feed_feedUrl` ON `podcast_feed` (`feedUrl`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_podcast_feed_nextFetchAt` ON `podcast_feed` (`nextFetchAt`)")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `podcast_episode` (" +
                "`id` TEXT NOT NULL, `feedId` TEXT NOT NULL, `mediaItemId` TEXT NOT NULL, " +
                "`guid` TEXT NOT NULL, `title` TEXT NOT NULL, `descriptionText` TEXT, " +
                "`linksJson` TEXT, `link` TEXT, `enclosureUrl` TEXT NOT NULL, " +
                "`enclosureType` TEXT, `enclosureLengthBytes` INTEGER, `durationMs` INTEGER NOT NULL, " +
                "`publishedAt` TEXT, `seasonNo` INTEGER, `episodeNo` INTEGER, `episodeType` TEXT, " +
                "`imageUrl` TEXT, `artworkPath` TEXT, `explicit` INTEGER NOT NULL, " +
                "`chaptersUrl` TEXT, `transcriptUrl` TEXT, `transcriptType` TEXT, " +
                "`playbackSpeed` REAL, `resumePositionMs` INTEGER NOT NULL, `played` INTEGER NOT NULL, " +
                "`completed` INTEGER NOT NULL, `playCount` INTEGER NOT NULL, `lastPlayedAt` TEXT, " +
                "`firstSeenAt` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, " +
                "PRIMARY KEY(`id`))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_podcast_episode_feedId` ON `podcast_episode` (`feedId`)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_podcast_episode_mediaItemId` ON `podcast_episode` (`mediaItemId`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_podcast_episode_feedId_publishedAt` ON `podcast_episode` (`feedId`, `publishedAt`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_podcast_episode_lastPlayedAt` ON `podcast_episode` (`lastPlayedAt`)")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `podcast_queue_entry` (" +
                "`entryId` TEXT NOT NULL, `episodeId` TEXT NOT NULL, `position` INTEGER NOT NULL, " +
                "`addedAt` TEXT NOT NULL, PRIMARY KEY(`entryId`))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_podcast_queue_entry_position` ON `podcast_queue_entry` (`position`)")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `podcast_playback_state` (" +
                "`id` INTEGER NOT NULL, `currentEntryId` TEXT, `positionMs` INTEGER NOT NULL, " +
                "`speed` REAL NOT NULL, `updatedAt` TEXT NOT NULL, PRIMARY KEY(`id`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `podcast_directory_cache` (" +
                "`id` TEXT NOT NULL, `provider` TEXT NOT NULL, `queryKey` TEXT NOT NULL, " +
                "`payloadJson` TEXT NOT NULL, `fetchedAt` TEXT NOT NULL, `expiresAt` TEXT NOT NULL, " +
                "PRIMARY KEY(`id`))",
        )
        db.execSQL(
            "CREATE UNIQUE INDEX IF NOT EXISTS `index_podcast_directory_cache_provider_queryKey` " +
                "ON `podcast_directory_cache` (`provider`, `queryKey`)",
        )
    }
}
