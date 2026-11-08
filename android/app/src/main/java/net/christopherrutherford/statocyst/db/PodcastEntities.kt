package net.christopherrutherford.statocyst.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A subscribed RSS/Atom feed. Mirrors the desktop `podcast_feed` table. Feed
 * fetching and parsing live in the shared renderer + native transport; this is
 * only the durable library row.
 */
@Entity(
    tableName = "podcast_feed",
    indices = [
        Index(value = ["feedUrl"], unique = true),
        Index("nextFetchAt"),
    ],
)
data class PodcastFeedEntity(
    @PrimaryKey val id: String,
    val feedUrl: String,
    val resolvedUrl: String?,
    val siteUrl: String?,
    val title: String,
    val author: String?,
    val descriptionText: String?,
    val imageUrl: String?,
    val artworkPath: String?,
    val language: String?,
    val explicit: Boolean = false,
    val categoriesJson: String?,
    val feedType: String,
    val podcastIndexId: Long?,
    val etag: String?,
    val lastModified: String?,
    val lastFetchedAt: String?,
    val lastSuccessAt: String?,
    val nextFetchAt: String?,
    val fetchError: String?,
    val failureCount: Int = 0,
    val refreshIntervalMinutes: Int = 60,
    val defaultSpeed: Double = 1.0,
    val skipIntroSeconds: Int = 0,
    val skipOutroSeconds: Int = 0,
    val autoQueue: Boolean = true,
    val episodeSort: String = "newest",
    val subscribed: Boolean = true,
    val lastViewedAt: String?,
    val createdAt: String,
    val updatedAt: String,
)

/** Episode metadata linked 1:1 to a `media_item` row with mediaKind = podcast. */
@Entity(
    tableName = "podcast_episode",
    indices = [
        Index("feedId"),
        Index(value = ["mediaItemId"], unique = true),
        Index(value = ["feedId", "publishedAt"]),
        Index("lastPlayedAt"),
    ],
)
data class PodcastEpisodeEntity(
    @PrimaryKey val id: String,
    val feedId: String,
    val mediaItemId: String,
    val guid: String,
    val title: String,
    val descriptionText: String?,
    val linksJson: String?,
    val link: String?,
    val enclosureUrl: String,
    val enclosureType: String?,
    val enclosureLengthBytes: Long?,
    val durationMs: Long = 0,
    val publishedAt: String?,
    val seasonNo: Int?,
    val episodeNo: Int?,
    val episodeType: String?,
    val imageUrl: String?,
    val artworkPath: String?,
    val explicit: Boolean = false,
    val chaptersUrl: String?,
    val transcriptUrl: String?,
    val transcriptType: String?,
    val playbackSpeed: Double?,
    val resumePositionMs: Long = 0,
    val played: Boolean = false,
    val completed: Boolean = false,
    val playCount: Int = 0,
    val lastPlayedAt: String?,
    val firstSeenAt: String,
    val createdAt: String,
    val updatedAt: String,
)

@Entity(tableName = "podcast_queue_entry", indices = [Index("position")])
data class PodcastQueueEntryEntity(
    @PrimaryKey val entryId: String,
    val episodeId: String,
    val position: Int,
    val addedAt: String,
)

@Entity(tableName = "podcast_playback_state")
data class PodcastPlaybackStateEntity(
    @PrimaryKey val id: Int = 1,
    val currentEntryId: String?,
    val positionMs: Long,
    val speed: Double,
    val updatedAt: String,
)

@Entity(
    tableName = "podcast_directory_cache",
    indices = [Index(value = ["provider", "queryKey"], unique = true)],
)
data class PodcastDirectoryCacheEntity(
    @PrimaryKey val id: String,
    val provider: String,
    val queryKey: String,
    val payloadJson: String,
    val fetchedAt: String,
    val expiresAt: String,
)
