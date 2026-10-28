package net.christopherrutherford.statocyst.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
abstract class UserDao {
    @Query("SELECT * FROM favorite ORDER BY position")
    abstract suspend fun favorites(): List<FavoriteEntity>

    @Query("SELECT * FROM playlist ORDER BY position")
    abstract suspend fun playlists(): List<PlaylistEntity>

    @Query("SELECT * FROM playlist_track ORDER BY playlistId, position")
    abstract suspend fun playlistTracks(): List<PlaylistTrackEntity>

    @Query("SELECT * FROM recent ORDER BY playedAt DESC LIMIT :limit")
    abstract suspend fun recents(limit: Int): List<RecentEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertFavorites(rows: List<FavoriteEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertPlaylists(rows: List<PlaylistEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertPlaylistTracks(rows: List<PlaylistTrackEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertRecent(row: RecentEntity)

    @Query("DELETE FROM favorite")
    abstract suspend fun clearFavorites()

    @Query("DELETE FROM playlist")
    abstract suspend fun clearPlaylists()

    @Query("DELETE FROM playlist_track")
    abstract suspend fun clearPlaylistTracks()

    @Query("DELETE FROM recent WHERE trackId NOT IN (SELECT trackId FROM recent ORDER BY playedAt DESC LIMIT :keep)")
    abstract suspend fun trimRecents(keep: Int)

    /** The web layer is the editor of favorites/playlists; native keeps a mirror for Auto. */
    @Transaction
    open suspend fun replaceUserState(
        favorites: List<FavoriteEntity>,
        playlists: List<PlaylistEntity>,
        playlistTracks: List<PlaylistTrackEntity>,
    ) {
        clearFavorites()
        clearPlaylists()
        clearPlaylistTracks()
        insertFavorites(favorites)
        insertPlaylists(playlists)
        insertPlaylistTracks(playlistTracks)
    }
}
