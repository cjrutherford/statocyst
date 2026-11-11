package net.christopherrutherford.statocyst.db

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Proves the v6 → v7 podcast migration against the exact Room schema. The
 * migration must preserve existing music rows and mediaKind defaults.
 */
class PodcastMigrationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val databaseName = "statocyst-podcast-migration.db"

    @After
    fun tearDown() {
        context.deleteDatabase(databaseName)
    }

    @Test
    fun migrate6To7PreservesMusicAndAddsPodcastTables() {
        context.deleteDatabase(databaseName)
        val raw = SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(databaseName), null)
        createV6Schema(raw)
        raw.execSQL(
            "INSERT INTO media_item (" +
                "id, sourceId, path, pathKey, fileName, ext, sizeBytes, mtimeMs, " +
                "title, artist, album, durationMs, sourceKind, sourceLabel, addedAt, updatedAt, missing, serverId" +
                ") VALUES ('t1', 'local', '/music/a.mp3', '/music/a.mp3', 'a.mp3', 'mp3', 1, 2, " +
                "'Track', 'Artist', 'Album', 1000, 'local', 'Music', 'now', 'now', 0, '')",
        )
        raw.execSQL(
            "INSERT INTO download (trackId, localPath, sizeBytes, sha256, container, verified, createdAt, profile, sourceBytes) " +
                "VALUES ('t1', '/music/a.mp3', 1, 'abc', 'mp3', 1, 'now', 'original', 1)",
        )
        raw.version = 6
        raw.close()

        val database = Room.databaseBuilder(context, StatocystDatabase::class.java, databaseName)
            .addMigrations(StatocystDatabase.MIGRATION_6_7, StatocystDatabase.MIGRATION_7_8)
            .allowMainThreadQueries()
            .build()
        try {
            val item = runBlocking { database.mediaItemDao().getById("t1") }
            assertEquals("music", item?.mediaKind)
            assertEquals(1, runBlocking { database.downloadDao().getAll().size })
            assertEquals(0, runBlocking { database.podcastDao().listFeeds().size })
            assertEquals(0, runBlocking { database.podcastDao().listEpisodes("missing-feed").size })
            assertEquals(0, runBlocking { database.podcastDao().listQueue().size })
            assertEquals(null, runBlocking { database.podcastDao().getPlaybackState() })
        } finally {
            database.close()
        }
    }

    private fun createV6Schema(db: SQLiteDatabase) {
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
                "`albumId` TEXT, `serverId` TEXT NOT NULL DEFAULT '', PRIMARY KEY(`id`))",
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
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `favorite` (`trackId` TEXT NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`trackId`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `playlist` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`id`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `playlist_track` (`playlistId` TEXT NOT NULL, `position` INTEGER NOT NULL, `trackId` TEXT NOT NULL, PRIMARY KEY(`playlistId`, `position`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `recent` (`trackId` TEXT NOT NULL, `playedAt` INTEGER NOT NULL, PRIMARY KEY(`trackId`))",
        )
    }
}
