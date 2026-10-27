package net.christopherrutherford.statocyst.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "media_item")
data class MediaItemEntity(
    @PrimaryKey val id: String,
    val sourceId: String,
    val path: String,
    val pathKey: String,
    val fileName: String,
    val ext: String,
    val sizeBytes: Long,
    val mtimeMs: Long,
    val title: String,
    val artist: String,
    val album: String,
    val albumArtist: String?,
    val trackNo: Int?,
    val discNo: Int?,
    val year: Int?,
    val genre: String?,
    val durationMs: Long,
    val bitrate: Int?,
    val sampleRate: Int?,
    val channels: Int?,
    val codec: String?,
    val format: String?,
    val artworkPath: String?,
    val jellyfinImageTag: String?,
    val sourceKind: String,
    val sourceLabel: String,
    val addedAt: String,
    val updatedAt: String,
    val missing: Boolean = false,
)
