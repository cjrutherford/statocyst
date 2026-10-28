package net.christopherrutherford.statocyst.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface MediaItemDao {
    @Query("SELECT * FROM media_item ORDER BY artist, album, discNo, trackNo, title")
    suspend fun getAll(): List<MediaItemEntity>

    @Query("SELECT * FROM media_item WHERE id = :id")
    suspend fun getById(id: String): MediaItemEntity?

    @Query("SELECT * FROM media_item WHERE pathKey = :pathKey")
    suspend fun getByPathKey(pathKey: String): MediaItemEntity?

    @Query("SELECT COUNT(*) FROM media_item")
    suspend fun count(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: MediaItemEntity): Long

    @Query("DELETE FROM media_item WHERE id = :id")
    suspend fun deleteById(id: String): Int
}
