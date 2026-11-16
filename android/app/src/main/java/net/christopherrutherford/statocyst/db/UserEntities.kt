package net.christopherrutherford.statocyst.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/** A favorited track. `position` keeps the web layer's order (oldest first). */
@Entity(tableName = "favorite")
data class FavoriteEntity(
    @PrimaryKey val trackId: String,
    val position: Int,
)

@Entity(tableName = "playlist")
data class PlaylistEntity(
    @PrimaryKey val id: String,
    val name: String,
    val createdAt: Long,
    val position: Int,
)

@Entity(tableName = "playlist_track", primaryKeys = ["playlistId", "position"])
data class PlaylistTrackEntity(
    val playlistId: String,
    val position: Int,
    val trackId: String,
)

/** Last start and local play count; drives the "Recently played" folder and recommendations. */
@Entity(tableName = "recent")
data class RecentEntity(
    @PrimaryKey val trackId: String,
    val playedAt: Long,
    @ColumnInfo(defaultValue = "0") val playCount: Int = 0,
)
