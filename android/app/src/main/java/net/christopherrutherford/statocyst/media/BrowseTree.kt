package net.christopherrutherford.statocyst.media

import net.christopherrutherford.statocyst.db.MediaItemEntity

/**
 * Stable, deterministic media IDs for the Android Auto browse tree. IDs are
 * content-addressed strings so a given catalog always yields the same IDs
 * across restarts and clients.
 */
object BrowseIds {
    const val ROOT = "statocyst"
    const val RECENTS = "recents"
    const val FAVORITES = "favorites"
    const val PLAYLISTS = "playlists"
    const val ALBUMS = "albums"
    const val ARTISTS = "artists"
    const val TRACKS = "tracks"
    const val QUEUE = "queue"
    /** A non-playable status row ("You're offline"); opens to an empty list. */
    const val NOTICE = "info::notice"

    /** Folders that sit directly under the root, in display order. */
    val ROOT_FOLDERS = listOf(RECENTS, FAVORITES, PLAYLISTS, ALBUMS, ARTISTS, TRACKS, QUEUE)

    fun album(albumArtist: String, album: String): String = "album::$albumArtist::$album"
    fun artist(artist: String): String = "artist::$artist"
    fun playlist(id: String): String = "playlist::$id"
    /**
     * Track IDs listed inside a folder carry that folder (`track::<id>@@<folder>`):
     * Android Auto sends back only the media ID, so this is how "play this track"
     * knows which list to queue.
     */
    fun track(id: String, contextId: String? = null): String =
        if (contextId == null) "track::$id" else "track::$id$CONTEXT_SEP$contextId"
    private const val CONTEXT_SEP = "@@"
    fun queueItem(entryId: String): String = "queue::$entryId"
    fun search(query: String): String = "search::$query"

    fun trackEntityId(mediaId: String): String? =
        if (mediaId.startsWith("track::")) mediaId.removePrefix("track::").substringBefore(CONTEXT_SEP) else null

    fun contextOf(mediaId: String): String? =
        if (mediaId.startsWith("track::") && mediaId.contains(CONTEXT_SEP)) mediaId.substringAfter(CONTEXT_SEP) else null

    fun queueEntryId(mediaId: String): String? =
        if (mediaId.startsWith("queue::")) mediaId.removePrefix("queue::") else null
}

/** How a car head unit should lay out a folder's children (Auto content-style hints). */
enum class ChildStyle { LIST, GRID }

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
    /** Layout hint for this node's children (browsable nodes only). */
    val childStyle: ChildStyle? = null,
)

data class PlaylistInfo(val id: String, val name: String, val trackIds: List<String>)

data class QueueEntry(val entryId: String, val trackId: String)

/** Everything the tree is derived from. Favorites and recents are newest first. */
/** A status the car should show instead of an unexplained empty or failing list. */
enum class BrowseNotice(val title: String, val subtitle: String) {
    EMPTY_LIBRARY("Your library is empty", "Open Statocyst on your phone to import music or sign in to Jellyfin"),
    OFFLINE("You're offline", "Only downloaded and cached songs will play"),
    SIGNED_OUT("Jellyfin is signed out", "Open Statocyst on your phone to sign in again"),
}

data class BrowseData(
    val tracks: List<MediaItemEntity>,
    val notice: BrowseNotice? = null,
    val favorites: List<String> = emptyList(),
    val playlists: List<PlaylistInfo> = emptyList(),
    val recents: List<String> = emptyList(),
    val queue: List<QueueEntry> = emptyList(),
)

/**
 * Builds a deterministic browse hierarchy from the local catalog. Pure Kotlin so
 * the tree shape, stable IDs and paging can be unit-tested without an Android runtime.
 */
object BrowseTree {

    /** Most tracks that "play from here" will queue around the chosen one. */
    const val CONTEXT_BEFORE = 50
    const val CONTEXT_AFTER = 250

    fun root(): BrowseNode = BrowseNode(BrowseIds.ROOT, "Statocyst", childStyle = ChildStyle.GRID)

    fun children(
        parentId: String,
        data: BrowseData,
        page: Int = 0,
        pageSize: Int = Int.MAX_VALUE,
    ): List<BrowseNode> = paged(allChildren(parentId, data), page, pageSize)

    private fun allChildren(parentId: String, data: BrowseData): List<BrowseNode> = when {
        parentId == BrowseIds.ROOT ->
            listOfNotNull(data.notice?.let(::noticeNode)) + BrowseIds.ROOT_FOLDERS.mapNotNull { folder(it, data) }
        parentId == BrowseIds.RECENTS -> trackNodes(data.recents, data, parentId)
        parentId == BrowseIds.FAVORITES -> trackNodes(data.favorites, data, parentId)
        parentId == BrowseIds.PLAYLISTS -> data.playlists.map(::playlistNode)
        parentId.startsWith("playlist::") ->
            data.playlists.firstOrNull { BrowseIds.playlist(it.id) == parentId }
                ?.let { trackNodes(it.trackIds, data, parentId) }.orEmpty()
        parentId == BrowseIds.ALBUMS -> albums(data.tracks)
        parentId.startsWith("album::") -> trackNodes(albumTrackIds(parentId, data.tracks), data, parentId)
        parentId == BrowseIds.ARTISTS -> artists(data.tracks)
        parentId.startsWith("artist::") -> trackNodes(artistTrackIds(parentId, data.tracks), data, parentId)
        parentId == BrowseIds.TRACKS -> trackNodes(allTrackIds(data.tracks), data, parentId)
        parentId == BrowseIds.QUEUE -> queueNodes(data)
        else -> emptyList()
    }

    private fun noticeNode(notice: BrowseNotice) =
        BrowseNode(BrowseIds.NOTICE, notice.title, notice.subtitle, childStyle = ChildStyle.LIST)

    /** Resolves a single media ID back to its node (used by onGetItem). */
    fun node(mediaId: String, data: BrowseData): BrowseNode? = when {
        mediaId == BrowseIds.ROOT -> root()
        mediaId == BrowseIds.NOTICE -> data.notice?.let(::noticeNode)
        mediaId in BrowseIds.ROOT_FOLDERS -> folder(mediaId, data, always = true)
        mediaId.startsWith("playlist::") ->
            data.playlists.firstOrNull { BrowseIds.playlist(it.id) == mediaId }?.let(::playlistNode)
        mediaId.startsWith("album::") -> {
            val key = mediaId.removePrefix("album::")
            data.tracks.firstOrNull {
                BrowseIds.album(it.albumArtist ?: it.artist, it.album) == "album::$key"
            }?.let {
                BrowseNode(
                    mediaId, it.album, it.albumArtist ?: it.artist,
                    albumId = it.albumId, imageTag = it.jellyfinImageTag, childStyle = ChildStyle.LIST,
                )
            }
        }
        mediaId.startsWith("artist::") -> {
            val artist = mediaId.removePrefix("artist::")
            data.tracks.firstOrNull { (it.albumArtist ?: it.artist) == artist }?.let {
                BrowseNode(mediaId, artist, albumId = it.albumId, imageTag = it.jellyfinImageTag, childStyle = ChildStyle.LIST)
            } ?: BrowseNode(mediaId, artist, childStyle = ChildStyle.LIST)
        }
        mediaId.startsWith("track::") -> {
            val id = BrowseIds.trackEntityId(mediaId)
            data.tracks.firstOrNull { it.id == id }?.let { trackNode(it, BrowseIds.contextOf(mediaId)) }
        }
        mediaId.startsWith("queue::") -> {
            val entry = data.queue.firstOrNull { BrowseIds.queueItem(it.entryId) == mediaId }
            val track = entry?.let { e -> data.tracks.firstOrNull { it.id == e.trackId } }
            track?.let { trackNode(it, BrowseIds.QUEUE).copy(id = mediaId) }
        }
        else -> null
    }

    /**
     * The ordered track IDs behind a folder, used to turn "play this track" in a
     * list into "play this list from here". Null when [contextId] is not a track list.
     */
    fun contextTrackIds(contextId: String, data: BrowseData): List<String>? = when {
        contextId == BrowseIds.RECENTS -> data.recents.filter { known(it, data) }
        contextId == BrowseIds.FAVORITES -> data.favorites.filter { known(it, data) }
        contextId.startsWith("playlist::") ->
            data.playlists.firstOrNull { BrowseIds.playlist(it.id) == contextId }
                ?.trackIds?.filter { known(it, data) }
        contextId.startsWith("album::") -> albumTrackIds(contextId, data.tracks)
        contextId.startsWith("artist::") -> artistTrackIds(contextId, data.tracks)
        contextId == BrowseIds.TRACKS -> allTrackIds(data.tracks)
        contextId.startsWith("search::") -> search(contextId.removePrefix("search::"), data)
        else -> null
    }

    /** Search results as browse nodes; tracks carry the search as their folder so play queues the results. */
    fun searchResult(query: String, data: BrowseData, page: Int = 0, pageSize: Int = Int.MAX_VALUE): List<BrowseNode> =
        paged(trackNodes(search(query, data), data, BrowseIds.search(query)), page, pageSize)

    private fun normalize(text: String): String =
        text.lowercase().replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

    /**
     * Voice/text search over the catalog. An exact artist or album name returns that whole
     * artist/album (so "play Audioslave" plays Audioslave); otherwise every query word must
     * appear in the title/artist/album, ranked exact title > title prefix > title > artist/album.
     */
    fun search(query: String, data: BrowseData, limit: Int = 100): List<String> {
        val q = normalize(query)
        if (q.isEmpty()) return emptyList()
        val tracks = data.tracks
        tracks.firstOrNull { normalize(it.albumArtist ?: it.artist) == q }?.let {
            return artistTrackIds(BrowseIds.artist(it.albumArtist ?: it.artist), tracks).take(limit)
        }
        tracks.firstOrNull { normalize(it.album) == q }?.let {
            return albumTrackIds(BrowseIds.album(it.albumArtist ?: it.artist, it.album), tracks).take(limit)
        }
        val words = q.split(' ')
        return tracks.mapNotNull { t ->
            val title = normalize(t.title)
            val hay = "$title ${normalize(t.artist)} ${normalize(t.album)}"
            if (words.any { it !in hay }) return@mapNotNull null
            val score = when {
                title == q -> 100
                title.startsWith(q) -> 80
                words.all { it in title } -> 60
                else -> 40
            }
            Triple(t, score, title)
        }
            .sortedWith(compareByDescending<Triple<MediaItemEntity, Int, String>> { it.second }.thenBy { it.third })
            .take(limit)
            .map { it.first.id }
    }

    /** Bounded slice of [ids] around [at], so one tap never ships thousands of items over Binder. */
    fun window(ids: List<String>, at: Int): Pair<List<String>, Int> {
        val from = (at - CONTEXT_BEFORE).coerceAtLeast(0)
        val to = (at + CONTEXT_AFTER + 1).coerceAtMost(ids.size)
        return ids.subList(from, to) to (at - from)
    }

    fun <T> paged(items: List<T>, page: Int, pageSize: Int): List<T> {
        if (pageSize <= 0 || page < 0) return emptyList()
        val from = page.toLong() * pageSize
        if (from >= items.size) return emptyList()
        val to = (from + pageSize).coerceAtMost(items.size.toLong())
        return items.subList(from.toInt(), to.toInt())
    }

    private fun known(trackId: String, data: BrowseData) = data.tracks.any { it.id == trackId }

    private fun folder(id: String, data: BrowseData, always: Boolean = false): BrowseNode? {
        fun count(n: Int, noun: String) = "$n $noun" + if (n == 1) "" else "s"
        return when (id) {
            BrowseIds.RECENTS -> data.recents.size.takeIf { it > 0 || always }
                ?.let { BrowseNode(id, "Recently played", count(it, "track"), childStyle = ChildStyle.LIST) }
            BrowseIds.FAVORITES -> data.favorites.size.takeIf { it > 0 || always }
                ?.let { BrowseNode(id, "Favorites", count(it, "track"), childStyle = ChildStyle.LIST) }
            BrowseIds.PLAYLISTS -> data.playlists.size.takeIf { it > 0 || always }
                ?.let { BrowseNode(id, "Playlists", count(it, "playlist"), childStyle = ChildStyle.LIST) }
            BrowseIds.ALBUMS -> BrowseNode(id, "Albums", childStyle = ChildStyle.GRID)
            BrowseIds.ARTISTS -> BrowseNode(id, "Artists", childStyle = ChildStyle.LIST)
            BrowseIds.TRACKS -> BrowseNode(id, "All tracks", count(data.tracks.size, "track"), childStyle = ChildStyle.LIST)
            BrowseIds.QUEUE -> data.queue.size.takeIf { it > 0 || always }
                ?.let { BrowseNode(id, "Now playing queue", count(it, "track"), childStyle = ChildStyle.LIST) }
            else -> null
        }
    }

    private fun playlistNode(p: PlaylistInfo) = BrowseNode(
        id = BrowseIds.playlist(p.id),
        title = p.name,
        subtitle = "${p.trackIds.size} track" + if (p.trackIds.size == 1) "" else "s",
        childStyle = ChildStyle.LIST,
    )

    private fun queueNodes(data: BrowseData): List<BrowseNode> {
        val byId = data.tracks.associateBy { it.id }
        return data.queue.mapNotNull { entry ->
            byId[entry.trackId]?.let { trackNode(it, BrowseIds.QUEUE).copy(id = BrowseIds.queueItem(entry.entryId)) }
        }
    }

    private fun trackNodes(ids: List<String>, data: BrowseData, contextId: String): List<BrowseNode> {
        val byId = data.tracks.associateBy { it.id }
        return ids.mapNotNull { id -> byId[id]?.let { trackNode(it, contextId) } }
    }

    private fun allTrackIds(tracks: List<MediaItemEntity>): List<String> =
        tracks.sortedBy { it.title.lowercase() }.map { it.id }

    private fun albums(tracks: List<MediaItemEntity>): List<BrowseNode> {
        val map = LinkedHashMap<String, BrowseNode>()
        for (t in tracks) {
            val artist = t.albumArtist ?: t.artist
            val id = BrowseIds.album(artist, t.album)
            if (!map.containsKey(id)) {
                map[id] = BrowseNode(
                    id, t.album, artist,
                    albumId = t.albumId, imageTag = t.jellyfinImageTag, childStyle = ChildStyle.LIST,
                )
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
                map[id] = BrowseNode(id, artist, albumId = t.albumId, imageTag = t.jellyfinImageTag, childStyle = ChildStyle.LIST)
            }
        }
        return map.values.sortedBy { it.title.lowercase() }
    }

    private fun albumTrackIds(parentId: String, tracks: List<MediaItemEntity>): List<String> {
        val key = parentId.removePrefix("album::")
        return tracks
            .filter { BrowseIds.album(it.albumArtist ?: it.artist, it.album) == "album::$key" }
            .sortedWith(compareBy({ it.discNo ?: 0 }, { it.trackNo ?: 0 }, { it.title.lowercase() }))
            .map { it.id }
    }

    private fun artistTrackIds(parentId: String, tracks: List<MediaItemEntity>): List<String> {
        val artist = parentId.removePrefix("artist::")
        return tracks
            .filter { (it.albumArtist ?: it.artist) == artist }
            .sortedBy { it.title.lowercase() }
            .map { it.id }
    }

    private fun trackNode(t: MediaItemEntity, contextId: String?): BrowseNode = BrowseNode(
        id = BrowseIds.track(t.id, contextId),
        title = t.title,
        subtitle = t.artist,
        playable = true,
        trackNumber = t.trackNo,
        trackId = t.id,
        albumId = t.albumId,
        imageTag = t.jellyfinImageTag,
    )
}
