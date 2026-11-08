package net.christopherrutherford.statocyst.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        MediaItemEntity::class,
        DownloadEntity::class,
        CacheEntryEntity::class,
        FavoriteEntity::class,
        PlaylistEntity::class,
        PlaylistTrackEntity::class,
        RecentEntity::class,
        PodcastFeedEntity::class,
        PodcastEpisodeEntity::class,
        PodcastQueueEntryEntity::class,
        PodcastPlaybackStateEntity::class,
        PodcastDirectoryCacheEntity::class,
    ],
    version = 7,
    exportSchema = false,
)
abstract class StatocystDatabase : RoomDatabase() {
    abstract fun mediaItemDao(): MediaItemDao
    abstract fun downloadDao(): DownloadDao
    abstract fun cacheDao(): CacheDao
    abstract fun userDao(): UserDao
    abstract fun podcastDao(): PodcastDao

    companion object {
        @Volatile
        private var INSTANCE: StatocystDatabase? = null

        /**
         * v1 → v2 added album artwork identity. Existing rows keep their tracks;
         * the new column is nullable.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `media_item` ADD COLUMN `albumId` TEXT")
            }
        }

        /**
         * v2 → v3 adds protected downloads and the rolling cache. Media items are
         * preserved: installed libraries must survive an app upgrade.
         */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `download` (" +
                        "`trackId` TEXT NOT NULL, `localPath` TEXT NOT NULL, " +
                        "`sizeBytes` INTEGER NOT NULL, `sha256` TEXT NOT NULL, " +
                        "`container` TEXT, `verified` INTEGER NOT NULL, " +
                        "`createdAt` TEXT NOT NULL, PRIMARY KEY(`trackId`))",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `cache_entry` (" +
                        "`trackId` TEXT NOT NULL, `localPath` TEXT NOT NULL, " +
                        "`sizeBytes` INTEGER NOT NULL, `container` TEXT, " +
                        "`createdAt` INTEGER NOT NULL, `lastAccessAt` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`trackId`))",
                )
            }
        }

        /** v3 → v4 mirrors favorites/playlists for Android Auto and records recents. */
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `favorite` (`trackId` TEXT NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`trackId`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `playlist` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `position` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `playlist_track` (`playlistId` TEXT NOT NULL, `position` INTEGER NOT NULL, `trackId` TEXT NOT NULL, PRIMARY KEY(`playlistId`, `position`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `recent` (`trackId` TEXT NOT NULL, `playedAt` INTEGER NOT NULL, PRIMARY KEY(`trackId`))")
            }
        }

        /**
         * v4 → v5 records which Jellyfin server a track came from, so several servers
         * can share one library. Existing rows get an empty id and keep working: they
         * resolve to the single session that existed before.
         */
        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `media_item` ADD COLUMN `serverId` TEXT NOT NULL DEFAULT ''")
            }
        }

        /**
         * v5 → v6 records how a pinned copy was produced. Existing rows are originals,
         * so the defaults are truthful rather than a guess.
         */
        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `download` ADD COLUMN `profile` TEXT NOT NULL DEFAULT 'original'")
                db.execSQL("ALTER TABLE `download` ADD COLUMN `codec` TEXT")
                db.execSQL("ALTER TABLE `download` ADD COLUMN `bitRate` INTEGER")
                db.execSQL("ALTER TABLE `download` ADD COLUMN `sourceBytes` INTEGER NOT NULL DEFAULT 0")
            }
        }

        /**
         * v6 → v7 adds first-class podcasts. Existing media rows are music by
         * default, so every existing library and queue survives unchanged.
         */
        internal val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `media_item` ADD COLUMN `mediaKind` TEXT NOT NULL DEFAULT 'music'")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `podcast_feed` (" +
                        "`id` TEXT NOT NULL, `feedUrl` TEXT NOT NULL, `resolvedUrl` TEXT, " +
                        "`siteUrl` TEXT, `title` TEXT NOT NULL, `author` TEXT, " +
                        "`descriptionText` TEXT, `imageUrl` TEXT, `artworkPath` TEXT, " +
                        "`language` TEXT, `explicit` INTEGER NOT NULL, `categoriesJson` TEXT, " +
                        "`feedType` TEXT NOT NULL, `podcastIndexId` INTEGER, `etag` TEXT, " +
                        "`lastModified` TEXT, `lastFetchedAt` TEXT, `lastSuccessAt` TEXT, " +
                        "`nextFetchAt` TEXT, `fetchError` TEXT, `failureCount` INTEGER NOT NULL, " +
                        "`refreshIntervalMinutes` INTEGER NOT NULL, `defaultSpeed` REAL NOT NULL, " +
                        "`skipIntroSeconds` INTEGER NOT NULL, `skipOutroSeconds` INTEGER NOT NULL, " +
                        "`autoQueue` INTEGER NOT NULL, `episodeSort` TEXT NOT NULL, " +
                        "`subscribed` INTEGER NOT NULL, `lastViewedAt` TEXT, " +
                        "`createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_podcast_feed_feedUrl` " +
                        "ON `podcast_feed` (`feedUrl`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_podcast_feed_nextFetchAt` " +
                        "ON `podcast_feed` (`nextFetchAt`)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `podcast_episode` (" +
                        "`id` TEXT NOT NULL, `feedId` TEXT NOT NULL, `mediaItemId` TEXT NOT NULL, " +
                        "`guid` TEXT NOT NULL, `title` TEXT NOT NULL, `descriptionText` TEXT, " +
                        "`linksJson` TEXT, `link` TEXT, `enclosureUrl` TEXT NOT NULL, " +
                        "`enclosureType` TEXT, `enclosureLengthBytes` INTEGER, " +
                        "`durationMs` INTEGER NOT NULL, `publishedAt` TEXT, `seasonNo` INTEGER, " +
                        "`episodeNo` INTEGER, `episodeType` TEXT, `imageUrl` TEXT, " +
                        "`artworkPath` TEXT, `explicit` INTEGER NOT NULL, `chaptersUrl` TEXT, " +
                        "`transcriptUrl` TEXT, `transcriptType` TEXT, `playbackSpeed` REAL, " +
                        "`resumePositionMs` INTEGER NOT NULL, `played` INTEGER NOT NULL, " +
                        "`completed` INTEGER NOT NULL, `playCount` INTEGER NOT NULL, " +
                        "`lastPlayedAt` TEXT, `firstSeenAt` TEXT NOT NULL, " +
                        "`createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_podcast_episode_feedId` " +
                        "ON `podcast_episode` (`feedId`)",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_podcast_episode_mediaItemId` " +
                        "ON `podcast_episode` (`mediaItemId`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_podcast_episode_feedId_publishedAt` " +
                        "ON `podcast_episode` (`feedId`, `publishedAt`)",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_podcast_episode_lastPlayedAt` " +
                        "ON `podcast_episode` (`lastPlayedAt`)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `podcast_queue_entry` (" +
                        "`entryId` TEXT NOT NULL, `episodeId` TEXT NOT NULL, " +
                        "`position` INTEGER NOT NULL, `addedAt` TEXT NOT NULL, " +
                        "PRIMARY KEY(`entryId`))",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_podcast_queue_entry_position` " +
                        "ON `podcast_queue_entry` (`position`)",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `podcast_playback_state` (" +
                        "`id` INTEGER NOT NULL, `currentEntryId` TEXT, " +
                        "`positionMs` INTEGER NOT NULL, `speed` REAL NOT NULL, " +
                        "`updatedAt` TEXT NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `podcast_directory_cache` (" +
                        "`id` TEXT NOT NULL, `provider` TEXT NOT NULL, `queryKey` TEXT NOT NULL, " +
                        "`payloadJson` TEXT NOT NULL, `fetchedAt` TEXT NOT NULL, " +
                        "`expiresAt` TEXT NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_podcast_directory_cache_provider_queryKey` " +
                        "ON `podcast_directory_cache` (`provider`, `queryKey`)",
                )
            }
        }

        fun getInstance(context: Context): StatocystDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(context, StatocystDatabase::class.java, "statocyst.db")
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
