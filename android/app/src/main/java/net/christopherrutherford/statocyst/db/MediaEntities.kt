package net.christopherrutherford.statocyst.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/** A verified, pinned download. Mirrors the desktop `stored_download` record. */
@Entity(tableName = "download")
data class DownloadEntity(
    @PrimaryKey val trackId: String,
    val localPath: String,
    val sizeBytes: Long,
    val sha256: String,
    val container: String?,
    val verified: Boolean,
    val createdAt: String,
    /** Wire name of the quality profile; "original" for records written before profiles. */
    val profile: String = "original",
    val codec: String? = null,
    val bitRate: Int? = null,
    /** Original file size, so the space saved by a transcode can be reported. */
    val sourceBytes: Long = 0,
)

/** An entry in the evictable rolling cache (never a pinned download). */
@Entity(tableName = "cache_entry")
data class CacheEntryEntity(
    @PrimaryKey val trackId: String,
    val localPath: String,
    val sizeBytes: Long,
    val container: String?,
    val createdAt: Long,
    val lastAccessAt: Long,
)
