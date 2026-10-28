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
    ],
    version = 4,
    exportSchema = false,
)
abstract class StatocystDatabase : RoomDatabase() {
    abstract fun mediaItemDao(): MediaItemDao
    abstract fun downloadDao(): DownloadDao
    abstract fun cacheDao(): CacheDao
    abstract fun userDao(): UserDao

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

        fun getInstance(context: Context): StatocystDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(context, StatocystDatabase::class.java, "statocyst.db")
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
