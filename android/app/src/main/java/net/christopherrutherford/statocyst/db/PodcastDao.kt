package net.christopherrutherford.statocyst.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PodcastDao {
    @Query("SELECT * FROM podcast_feed ORDER BY title COLLATE NOCASE")
    suspend fun listFeeds(): List<PodcastFeedEntity>

    @Query("SELECT * FROM podcast_feed WHERE id = :id")
    suspend fun getFeed(id: String): PodcastFeedEntity?

    @Query("SELECT * FROM podcast_feed WHERE feedUrl = :feedUrl")
    suspend fun getFeedByUrl(feedUrl: String): PodcastFeedEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFeed(entity: PodcastFeedEntity)

    @Query("DELETE FROM podcast_feed WHERE id = :id")
    suspend fun deleteFeed(id: String): Int

    @Query("SELECT * FROM podcast_episode WHERE feedId = :feedId ORDER BY COALESCE(publishedAt, firstSeenAt) DESC")
    suspend fun listEpisodes(feedId: String): List<PodcastEpisodeEntity>

    @Query("SELECT * FROM podcast_episode WHERE id = :id")
    suspend fun getEpisode(id: String): PodcastEpisodeEntity?

    @Query("SELECT * FROM podcast_episode WHERE mediaItemId = :mediaItemId")
    suspend fun getEpisodeByMediaItem(mediaItemId: String): PodcastEpisodeEntity?

    @Query("SELECT * FROM podcast_episode WHERE feedId = :feedId AND guid = :guid")
    suspend fun getEpisodeByGuid(feedId: String, guid: String): PodcastEpisodeEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertEpisode(entity: PodcastEpisodeEntity)

    @Query("DELETE FROM podcast_episode WHERE id = :id")
    suspend fun deleteEpisode(id: String): Int

    @Query("DELETE FROM podcast_episode WHERE feedId = :feedId")
    suspend fun deleteEpisodesForFeed(feedId: String): Int

    @Query("UPDATE podcast_episode SET played = :played, completed = :completed, resumePositionMs = 0, updatedAt = :updatedAt WHERE id = :id")
    suspend fun setPlayed(id: String, played: Boolean, completed: Boolean, updatedAt: String)

    @Query("UPDATE podcast_episode SET resumePositionMs = :positionMs, updatedAt = :updatedAt WHERE id = :id")
    suspend fun setResume(id: String, positionMs: Long, updatedAt: String)

    @Query("SELECT * FROM podcast_queue_entry ORDER BY position ASC")
    suspend fun listQueue(): List<PodcastQueueEntryEntity>

    @Query("DELETE FROM podcast_queue_entry")
    suspend fun clearQueue()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertQueueEntry(entity: PodcastQueueEntryEntity)

    @Query("SELECT * FROM podcast_playback_state WHERE id = 1")
    suspend fun getPlaybackState(): PodcastPlaybackStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun savePlaybackState(entity: PodcastPlaybackStateEntity)

    @Query("SELECT * FROM podcast_directory_cache WHERE provider = :provider AND queryKey = :queryKey")
    suspend fun getDirectoryCache(provider: String, queryKey: String): PodcastDirectoryCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDirectoryCache(entity: PodcastDirectoryCacheEntity)
}
