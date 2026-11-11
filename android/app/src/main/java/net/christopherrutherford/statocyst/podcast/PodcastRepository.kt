package net.christopherrutherford.statocyst.podcast

import androidx.room.withTransaction
import java.time.Instant
import java.util.UUID
import net.christopherrutherford.statocyst.db.MediaItemDao
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.PodcastDao
import net.christopherrutherford.statocyst.db.PodcastEpisodeEntity
import net.christopherrutherford.statocyst.db.PodcastFeedEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.json.JSONArray
import org.json.JSONObject

data class PodcastFeedRecord(
    val feed: PodcastFeedEntity,
    val unplayed: Int,
    val newEpisodes: Int,
)

data class PodcastEpisodeRecord(
    val episode: PodcastEpisodeEntity,
    val media: MediaItemEntity,
    val feedTitle: String,
)

/** Room-backed podcast storage shared by the plugin and the native refresh path. */
class PodcastRepository(private val database: StatocystDatabase) {
    private val feeds: PodcastDao get() = database.podcastDao()
    private val media: MediaItemDao get() = database.mediaItemDao()

    suspend fun listFeeds(): List<PodcastFeedRecord> =
        feeds.listFeeds().map { feed ->
            val episodes = feeds.listEpisodes(feed.id)
            PodcastFeedRecord(
                feed = feed,
                unplayed = episodes.count { !it.played },
                newEpisodes = episodes.count { !it.played },
            )
        }

    suspend fun getFeed(id: String): PodcastFeedRecord? {
        val feed = feeds.getFeed(id) ?: return null
        val episodes = feeds.listEpisodes(feed.id)
        return PodcastFeedRecord(feed, episodes.count { !it.played }, episodes.count { !it.played })
    }

    suspend fun getFeedByUrl(url: String): PodcastFeedRecord? {
        val feed = feeds.getFeedByUrl(url) ?: return null
        val episodes = feeds.listEpisodes(feed.id)
        return PodcastFeedRecord(feed, episodes.count { !it.played }, episodes.count { !it.played })
    }

    suspend fun listEpisodes(feedId: String): List<PodcastEpisodeRecord> {
        val feedTitle = feeds.getFeed(feedId)?.title ?: "Podcasts"
        return feeds.listEpisodes(feedId).mapNotNull { episode ->
            media.getById(episode.mediaItemId)?.let { PodcastEpisodeRecord(episode, it, feedTitle) }
        }
    }

    suspend fun getEpisode(id: String): PodcastEpisodeRecord? {
        val episode = feeds.getEpisode(id) ?: return null
        val item = media.getById(episode.mediaItemId) ?: return null
        val feedTitle = feeds.getFeed(episode.feedId)?.title ?: "Podcasts"
        return PodcastEpisodeRecord(episode, item, feedTitle)
    }

    suspend fun saveFeed(feedJson: JSONObject, episodesJson: JSONArray): PodcastFeedRecord =
        database.withTransaction {
            val now = Instant.now().toString()
            val url = feedJson.optString("feedUrl")
            val existing = feeds.getFeedByUrl(url)
            val id = existing?.id ?: UUID.randomUUID().toString()
            val feed = PodcastFeedEntity(
                id = id,
                feedUrl = url,
                resolvedUrl = feedJson.optNullableString("resolvedUrl"),
                siteUrl = feedJson.optNullableString("siteUrl"),
                title = feedJson.optString("title", url),
                author = feedJson.optNullableString("author"),
                descriptionText = feedJson.optNullableString("descriptionText"),
                imageUrl = feedJson.optNullableString("imageUrl"),
                artworkPath = feedJson.optNullableString("artworkPath") ?: existing?.artworkPath,
                language = feedJson.optNullableString("language"),
                explicit = feedJson.optBoolean("explicit", false),
                categoriesJson = feedJson.optJSONArray("categories")?.toString(),
                feedType = feedJson.optString("feedType", "rss"),
                podcastIndexId = feedJson.optNullableLong("podcastIndexId"),
                etag = feedJson.optNullableString("etag"),
                lastModified = feedJson.optNullableString("lastModified"),
                lastFetchedAt = feedJson.optNullableString("lastFetchedAt"),
                lastSuccessAt = feedJson.optNullableString("lastSuccessAt"),
                nextFetchAt = feedJson.optNullableString("nextFetchAt"),
                fetchError = feedJson.optNullableString("fetchError"),
                failureCount = feedJson.optInt("failureCount", 0),
                refreshIntervalMinutes = feedJson.optInt("refreshIntervalMinutes", existing?.refreshIntervalMinutes ?: 60),
                defaultSpeed = feedJson.optDouble("defaultSpeed", existing?.defaultSpeed ?: 1.0),
                skipIntroSeconds = feedJson.optInt("skipIntroSeconds", existing?.skipIntroSeconds ?: 0),
                skipOutroSeconds = feedJson.optInt("skipOutroSeconds", existing?.skipOutroSeconds ?: 0),
                autoQueue = feedJson.optBoolean("autoQueue", existing?.autoQueue ?: true),
                episodeSort = feedJson.optString("episodeSort", existing?.episodeSort ?: "newest"),
                subscribed = feedJson.optBoolean("subscribed", existing?.subscribed ?: true),
                lastViewedAt = existing?.lastViewedAt,
                createdAt = existing?.createdAt ?: now,
                updatedAt = now,
                defaultMediaForm = mediaFormOf(
                    feedJson.optString("defaultMediaForm", existing?.defaultMediaForm ?: "audio"),
                ),
            )
            feeds.upsertFeed(feed)

            for (index in 0 until episodesJson.length()) {
                val episodeJson = episodesJson.optJSONObject(index) ?: continue
                saveEpisode(feed, episodeJson, now)
            }
            feeds.getFeed(id)?.let { stored ->
                val storedEpisodes = feeds.listEpisodes(id)
                PodcastFeedRecord(stored, storedEpisodes.count { !it.played }, storedEpisodes.count { !it.played })
            } ?: PodcastFeedRecord(feed, 0, 0)
        }

    suspend fun updateFeed(id: String, patch: JSONObject): PodcastFeedRecord? =
        database.withTransaction {
            val existing = feeds.getFeed(id) ?: return@withTransaction null
            val updated = existing.copy(
                title = patch.optString("title", existing.title),
                refreshIntervalMinutes = patch.optInt("refreshIntervalMinutes", existing.refreshIntervalMinutes),
                defaultSpeed = patch.optDouble("defaultSpeed", existing.defaultSpeed),
                skipIntroSeconds = patch.optInt("skipIntroSeconds", existing.skipIntroSeconds),
                skipOutroSeconds = patch.optInt("skipOutroSeconds", existing.skipOutroSeconds),
                autoQueue = patch.optBoolean("autoQueue", existing.autoQueue),
                episodeSort = patch.optString("episodeSort", existing.episodeSort),
                subscribed = patch.optBoolean("subscribed", existing.subscribed),
                defaultMediaForm = mediaFormOf(
                    patch.optString("defaultMediaForm", existing.defaultMediaForm),
                ),
                updatedAt = Instant.now().toString(),
            )
            feeds.upsertFeed(updated)
            val episodes = feeds.listEpisodes(id)
            PodcastFeedRecord(updated, episodes.count { !it.played }, episodes.count { !it.played })
        }

    suspend fun removeFeed(id: String): Boolean =
        database.withTransaction {
            val episodes = feeds.listEpisodes(id)
            for (episode in episodes) {
                media.deleteById(episode.mediaItemId)
            }
            feeds.deleteEpisodesForFeed(id)
            feeds.deleteFeed(id) > 0
        }

    suspend fun setPlayed(id: String, played: Boolean): PodcastEpisodeRecord? =
        database.withTransaction {
            feeds.setPlayed(id, played, played, Instant.now().toString())
            getEpisode(id)
        }

    private suspend fun saveEpisode(feed: PodcastFeedEntity, json: JSONObject, now: String) {
        val guid = json.optString("guid").takeIf { it.isNotEmpty() }
            ?: json.optString("enclosureUrl")
        if (guid.isEmpty()) return
        val pathKey = json.optString("pathKey").takeIf { it.isNotEmpty() }
            ?: "podcast:${feed.id}:$guid"
        val enclosure = json.optString("enclosureUrl")
        if (enclosure.isEmpty()) return
        val existingMedia = media.getByPathKey(pathKey)
        val mediaId = existingMedia?.id ?: UUID.randomUUID().toString()
        val title = json.optString("title", "Untitled episode")
        val ext = extensionFor(json.optNullableString("enclosureType"), enclosure)
        val publishedAt = json.optNullableString("publishedAt")
        val form = mediaFormOf(json.optString("mediaForm", "audio"))
        val item = MediaItemEntity(
            id = mediaId,
            sourceId = "podcast",
            path = enclosure,
            pathKey = pathKey,
            fileName = "$title.$ext",
            ext = ext,
            sizeBytes = json.optLong("enclosureLengthBytes", 0),
            mtimeMs = 0,
            title = title,
            artist = feed.title,
            album = feed.title,
            albumArtist = feed.author ?: feed.title,
            trackNo = json.optNullableInt("episodeNo"),
            discNo = json.optNullableInt("seasonNo"),
            year = publishedAt?.take(4)?.toIntOrNull(),
            genre = "Podcast",
            durationMs = json.optLong("durationMs", 0),
            bitrate = null,
            sampleRate = null,
            channels = null,
            codec = json.optNullableString("enclosureType"),
            format = json.optNullableString("enclosureType"),
            artworkPath = json.optNullableString("artworkPath") ?: feed.artworkPath,
            jellyfinImageTag = null,
            sourceKind = "podcast",
            sourceLabel = "Podcasts",
            addedAt = existingMedia?.addedAt ?: now,
            updatedAt = now,
            missing = false,
            albumId = null,
            serverId = "",
            mediaKind = "podcast",
            mediaForm = form,
        )
        media.upsert(item)

        val existing = feeds.getEpisodeByGuid(feed.id, guid)
        val episode = PodcastEpisodeEntity(
            id = existing?.id ?: UUID.randomUUID().toString(),
            feedId = feed.id,
            mediaItemId = mediaId,
            guid = guid,
            title = title,
            descriptionText = json.optNullableString("descriptionText"),
            linksJson = json.optJSONArray("links")?.toString(),
            link = json.optNullableString("link"),
            enclosureUrl = enclosure,
            enclosureType = json.optNullableString("enclosureType"),
            enclosureLengthBytes = json.optNullableLong("enclosureLengthBytes"),
            durationMs = json.optLong("durationMs", 0),
            publishedAt = publishedAt,
            seasonNo = json.optNullableInt("seasonNo"),
            episodeNo = json.optNullableInt("episodeNo"),
            episodeType = json.optNullableString("episodeType"),
            imageUrl = json.optNullableString("imageUrl"),
            artworkPath = json.optNullableString("artworkPath") ?: feed.artworkPath,
            explicit = json.optBoolean("explicit", false),
            chaptersUrl = json.optNullableString("chaptersUrl"),
            transcriptUrl = json.optNullableString("transcriptUrl"),
            transcriptType = json.optNullableString("transcriptType"),
            playbackSpeed = existing?.playbackSpeed,
            resumePositionMs = existing?.resumePositionMs ?: 0,
            played = existing?.played ?: false,
            completed = existing?.completed ?: false,
            playCount = existing?.playCount ?: 0,
            lastPlayedAt = existing?.lastPlayedAt,
            firstSeenAt = json.optNullableString("firstSeenAt") ?: existing?.firstSeenAt ?: now,
            createdAt = existing?.createdAt ?: now,
            updatedAt = now,
            mediaForm = form,
            alternatesJson = alternatesJson(json.optJSONArray("alternates"), enclosure),
            posterUrl = json.optNullableString("posterUrl") ?: existing?.posterUrl,
            videoWidth = json.optNullableInt("videoWidth") ?: existing?.videoWidth,
            videoHeight = json.optNullableInt("videoHeight") ?: existing?.videoHeight,
        )
        feeds.upsertEpisode(episode)
    }
}

private fun JSONObject.optNullableString(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotEmpty() }
}

private fun JSONObject.optNullableInt(key: String): Int? =
    if (!has(key) || isNull(key)) null else optInt(key)

private fun JSONObject.optNullableLong(key: String): Long? =
    if (!has(key) || isNull(key)) null else optLong(key)

private fun mediaFormOf(value: String?): String =
    if (value.equals("video", ignoreCase = true)) "video" else "audio"

/**
 * The bounded non-primary enclosure list. Malformed entries are dropped instead of
 * failing the episode: a bad alternate must never lose the primary row.
 */
private fun alternatesJson(alternates: JSONArray?, primaryUrl: String): String? {
    alternates ?: return null
    val sanitized = JSONArray()
    val seen = mutableSetOf(primaryUrl)
    for (index in 0 until alternates.length()) {
        if (sanitized.length() >= 8) break
        val item = alternates.optJSONObject(index) ?: continue
        val url = item.optString("url")
        if (!url.startsWith("http://") && !url.startsWith("https://")) continue
        if (!seen.add(url)) continue
        val form = mediaFormOf(item.optString("form", if (item.optString("type").startsWith("video/")) "video" else "audio"))
        sanitized.put(
            JSONObject()
                .put("url", url)
                .put("type", item.optNullableString("type"))
                .put("form", form)
                .put("lengthBytes", item.optNullableLong("lengthBytes"))
                .put("width", item.optNullableInt("width"))
                .put("height", item.optNullableInt("height"))
                .put("bitrate", item.optNullableInt("bitrate")),
        )
    }
    return if (sanitized.length() == 0) null else sanitized.toString()
}

private fun extensionFor(type: String?, url: String): String {
    val fromType = mapOf(
        "audio/mpeg" to "mp3",
        "audio/mp3" to "mp3",
        "audio/mp4" to "m4a",
        "audio/x-m4a" to "m4a",
        "audio/aac" to "aac",
        "audio/ogg" to "ogg",
        "audio/opus" to "opus",
        "audio/wav" to "wav",
        "audio/x-wav" to "wav",
        "audio/flac" to "flac",
        "audio/webm" to "webm",
        "video/mp4" to "mp4",
        "video/quicktime" to "mov",
        "video/webm" to "webm",
        "video/x-matroska" to "mkv",
        "video/mpeg" to "mpeg",
    )
    val base = type?.substringBefore(';')?.trim()?.lowercase()
    fromType[base]?.let { return it }
    val candidate = url.substringBefore('?').substringAfterLast('.', "").lowercase()
    return if (candidate in fromType.values) candidate else "bin"
}
