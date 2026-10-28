package net.christopherrutherford.statocyst.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [MediaItemEntity::class, DownloadEntity::class, CacheEntryEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class StatocystDatabase : RoomDatabase() {
    abstract fun mediaItemDao(): MediaItemDao
    abstract fun downloadDao(): DownloadDao
    abstract fun cacheDao(): CacheDao

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

        fun getInstance(context: Context): StatocystDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(context, StatocystDatabase::class.java, "statocyst.db")
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
