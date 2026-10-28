package net.christopherrutherford.statocyst.media

import net.christopherrutherford.statocyst.db.MediaItemEntity

/**
 * Stable, deterministic media IDs for the Android Auto browse tree. IDs are
 * content-addressed strings so a given catalog always yields the same IDs
 * across restarts and clients.
 */
object BrowseIds {
    const val ROOT = "statocyst"
    const val ALBUMS = "albums"
    const val ARTISTS = "artists"
    const val TRACKS = "tracks"
    const val QUEUE = "queue"

    fun album(albumArtist: String, album: String): String = "album::$albumArtist::$album"
    fun artist(artist: String): String = "artist::$artist"
    fun track(id: String): String = "track::$id"

    fun trackEntityId(mediaId: String): String? =
        if (mediaId.startsWith("track::")) mediaId.removePrefix("track::") else null
}

/** A single browse-tree node, independent of any Android framework type. */
data class BrowseNode(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val playable: Boolean = false,
    val trackNumber: Int? = null,
    val trackId: String? = null,
    val albumId: String? = null,
    val imageTag: String? = null,
)

/**
 * Builds a deterministic browse hierarchy from the local catalog. Pure Kotlin so
 * the tree shape and stable IDs can be unit-tested without an Android runtime.
 */
object BrowseTree {

    fun root(): BrowseNode = BrowseNode(BrowseIds.ROOT, "Statocyst")

    fun children(parentId: String, tracks: List<MediaItemEntity>): List<BrowseNode> = when {
        parentId == BrowseIds.ROOT -> listOf(
            BrowseNode(BrowseIds.ALBUMS, "Albums"),
            BrowseNode(BrowseIds.ARTISTS, "Artists"),
            BrowseNode(BrowseIds.TRACKS, "Tracks"),
            BrowseNode(BrowseIds.QUEUE, "Queue"),
        )
        parentId == BrowseIds.ALBUMS -> albums(tracks)
        parentId.startsWith("album::") -> albumTracks(parentId, tracks)
        parentId == BrowseIds.ARTISTS -> artists(tracks)
        parentId.startsWith("artist::") -> artistTracks(parentId, tracks)
        parentId == BrowseIds.TRACKS -> tracks.map(::trackNode)
        parentId == BrowseIds.QUEUE -> emptyList() // native queue lands in S021
        else -> emptyList()
    }

    /** Resolves a single media ID back to its node (used by onGetItem). */
    fun node(mediaId: String, tracks: List<MediaItemEntity>): BrowseNode? = when {
        mediaId == BrowseIds.ROOT -> root()
        mediaId == BrowseIds.ALBUMS -> BrowseNode(BrowseIds.ALBUMS, "Albums")
        mediaId == BrowseIds.ARTISTS -> BrowseNode(BrowseIds.ARTISTS, "Artists")
        mediaId == BrowseIds.TRACKS -> BrowseNode(BrowseIds.TRACKS, "Tracks")
        mediaId == BrowseIds.QUEUE -> BrowseNode(BrowseIds.QUEUE, "Queue")
        mediaId.startsWith("album::") -> {
            val key = mediaId.removePrefix("album::")
            tracks.firstOrNull {
                BrowseIds.album(it.albumArtist ?: it.artist, it.album) == "album::$key"
            }?.let {
                BrowseNode(mediaId, it.album, it.albumArtist ?: it.artist, albumId = it.albumId, imageTag = it.jellyfinImageTag)
            }
        }
        mediaId.startsWith("artist::") -> {
            val artist = mediaId.removePrefix("artist::")
            tracks.firstOrNull { (it.albumArtist ?: it.artist) == artist }?.let {
                BrowseNode(mediaId, artist, albumId = it.albumId, imageTag = it.jellyfinImageTag)
            } ?: BrowseNode(mediaId, artist)
        }
        mediaId.startsWith("track::") -> {
            val id = mediaId.removePrefix("track::")
            tracks.firstOrNull { it.id == id }?.let(::trackNode)
        }
        else -> null
    }

    private fun albums(tracks: List<MediaItemEntity>): List<BrowseNode> {
        val map = LinkedHashMap<String, BrowseNode>()
        for (t in tracks) {
            val artist = t.albumArtist ?: t.artist
            val id = BrowseIds.album(artist, t.album)
            if (!map.containsKey(id)) {
                map[id] = BrowseNode(id, t.album, artist, albumId = t.albumId, imageTag = t.jellyfinImageTag)
            }
        }
        return map.values.sortedBy { it.title.lowercase() }
    }

    private fun artists(tracks: List<MediaItemEntity>): List<BrowseNode> {
        val map = LinkedHashMap<String, BrowseNode>()
        for (t in tracks) {
            val artist = t.albumArtist ?: t.artist
            val id = BrowseIds.artist(artist)
            if (!map.containsKey(id)) {
                map[id] = BrowseNode(id, artist, albumId = t.albumId, imageTag = t.jellyfinImageTag)
            }
        }
        return map.values.sortedBy { it.title.lowercase() }
    }

    private fun albumTracks(parentId: String, tracks: List<MediaItemEntity>): List<BrowseNode> {
        val key = parentId.removePrefix("album::")
        return tracks
            .filter { BrowseIds.album(it.albumArtist ?: it.artist, it.album) == "album::$key" }
            .sortedWith(compareBy({ it.discNo ?: 0 }, { it.trackNo ?: 0 }, { it.title.lowercase() }))
            .map(::trackNode)
    }

    private fun artistTracks(parentId: String, tracks: List<MediaItemEntity>): List<BrowseNode> {
        val artist = parentId.removePrefix("artist::")
        return tracks
            .filter { (it.albumArtist ?: it.artist) == artist }
            .sortedBy { it.title.lowercase() }
            .map(::trackNode)
    }

    private fun trackNode(t: MediaItemEntity): BrowseNode = BrowseNode(
        id = BrowseIds.track(t.id),
        title = t.title,
        subtitle = t.artist,
        playable = true,
        trackNumber = t.trackNo,
        trackId = t.id,
        albumId = t.albumId,
        imageTag = t.jellyfinImageTag,
    )
}
