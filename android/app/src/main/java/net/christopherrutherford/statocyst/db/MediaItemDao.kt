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

    @Query("SELECT id FROM media_item WHERE serverId = :serverId")
    suspend fun idsByServer(serverId: String): List<String>

    @Query("SELECT id FROM media_item WHERE serverId = '' AND sourceKind LIKE 'jellyfin%'")
    suspend fun unattributedRemoteIds(): List<String>

    @Query("DELETE FROM media_item WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>): Int

    @Query("DELETE FROM media_item WHERE id = :id")
    suspend fun deleteById(id: String): Int
}
