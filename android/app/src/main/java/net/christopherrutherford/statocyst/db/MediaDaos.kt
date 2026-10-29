package net.christopherrutherford.statocyst.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface DownloadDao {
    @Query("SELECT * FROM download ORDER BY createdAt DESC")
    suspend fun getAll(): List<DownloadEntity>

    @Query("SELECT * FROM download WHERE trackId = :trackId")
    suspend fun get(trackId: String): DownloadEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DownloadEntity)

    @Query("DELETE FROM download WHERE trackId = :trackId")
    suspend fun delete(trackId: String): Int
}

@Dao
interface CacheDao {
    @Query("SELECT * FROM cache_entry ORDER BY lastAccessAt DESC")
    suspend fun getAll(): List<CacheEntryEntity>

    @Query("SELECT * FROM cache_entry WHERE trackId = :trackId")
    suspend fun get(trackId: String): CacheEntryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: CacheEntryEntity)

    @Query("UPDATE cache_entry SET lastAccessAt = :at WHERE trackId = :trackId")
    suspend fun touch(trackId: String, at: Long)

    @Query("DELETE FROM cache_entry WHERE trackId = :trackId")
    suspend fun delete(trackId: String): Int

    @Query("SELECT COALESCE(SUM(sizeBytes), 0) FROM cache_entry")
    suspend fun totalBytes(): Long

    @Query("SELECT COUNT(*) FROM cache_entry")
    suspend fun count(): Int
}
