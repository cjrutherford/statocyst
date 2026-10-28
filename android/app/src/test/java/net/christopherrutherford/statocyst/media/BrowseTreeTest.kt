package net.christopherrutherford.statocyst.media

import net.christopherrutherford.statocyst.db.MediaItemEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowseTreeTest {

    private fun entity(
        id: String,
        title: String,
        artist: String,
        album: String,
        albumArtist: String? = artist,
        trackNo: Int? = null,
        discNo: Int? = null,
    ): MediaItemEntity = MediaItemEntity(
        id = id,
        sourceId = "jellyfin",
        path = id,
        pathKey = "jellyfin:$id",
        fileName = title,
        ext = "flac",
        sizeBytes = 0,
        mtimeMs = 0,
        title = title,
        artist = artist,
        album = album,
        albumArtist = albumArtist,
        trackNo = trackNo,
        discNo = discNo,
        year = null,
        genre = null,
        durationMs = 200_000,
        bitrate = null,
        sampleRate = null,
        channels = null,
        codec = null,
        format = "flac",
        artworkPath = null,
        jellyfinImageTag = null,
        sourceKind = "jellyfin",
        sourceLabel = "Jellyfin",
        addedAt = "",
        updatedAt = "",
        missing = false,
        albumId = null,
    )

    private val catalog = listOf(
        entity("t1", "Eat The Elephant", "A Perfect Circle", "Eat The Elephant", trackNo = 1),
        entity("t2", "Disillusioned", "A Perfect Circle", "Eat The Elephant", trackNo = 2),
        entity("t3", "The Hollow", "A Perfect Circle", "Mer de Noms", trackNo = 3),
        entity("t4", "Cochise", "Audioslave", "Audioslave", trackNo = 1),
    )

    private val data = BrowseData(catalog)

    @Test
    fun rootHasStableId() {
        assertEquals(BrowseIds.ROOT, BrowseTree.root().id)
        assertEquals("Statocyst", BrowseTree.root().title)
    }

    @Test
    fun rootShowsOnlyFoldersThatHaveContent() {
        val bare = BrowseTree.children(BrowseIds.ROOT, data)
        assertEquals(listOf(BrowseIds.ALBUMS, BrowseIds.ARTISTS, BrowseIds.TRACKS), bare.map { it.id })

        val full = BrowseTree.children(
            BrowseIds.ROOT,
            data.copy(
                recents = listOf("t1"),
                favorites = listOf("t2"),
                playlists = listOf(PlaylistInfo("p1", "Mix", listOf("t1"))),
                queue = listOf(QueueEntry("q_1", "t1")),
            ),
        )
        assertEquals(BrowseIds.ROOT_FOLDERS, full.map { it.id })
    }

    @Test
    fun albumsAreDistinctSortedAndStable() {
        val albums = BrowseTree.children(BrowseIds.ALBUMS, data)
        assertEquals(
            listOf(
                "album::Audioslave::Audioslave",
                "album::A Perfect Circle::Eat The Elephant",
                "album::A Perfect Circle::Mer de Noms",
            ),
            albums.map { it.id },
        )
    }

    @Test
    fun albumChildrenReturnThatAlbumsTracksOrderedByTrackNumber() {
        val id = BrowseIds.album("A Perfect Circle", "Eat The Elephant")
        val tracks = BrowseTree.children(id, data)
        assertEquals(listOf("track::t1@@$id", "track::t2@@$id"), tracks.map { it.id })
        assertEquals(listOf("t1", "t2"), tracks.map { it.trackId })
        assertEquals(listOf("Eat The Elephant", "Disillusioned"), tracks.map { it.title })
        assertTrue(tracks.all { it.playable })
    }

    @Test
    fun artistsAreDistinctSortedAndStable() {
        val artists = BrowseTree.children(BrowseIds.ARTISTS, data)
        assertEquals(
            listOf("artist::A Perfect Circle", "artist::Audioslave"),
            artists.map { it.id },
        )
    }

    @Test
    fun artistChildrenReturnThatArtistsTracks() {
        val tracks = BrowseTree.children(BrowseIds.artist("Audioslave"), data)
        assertEquals(listOf("t4"), tracks.map { it.trackId })
        assertEquals("Cochise", tracks.first().title)
    }

    @Test
    fun tracksFolderReturnsAllTracks() {
        val tracks = BrowseTree.children(BrowseIds.TRACKS, data)
        assertEquals(4, tracks.size)
        assertEquals(catalog.map { it.id }.toSet(), tracks.map { it.trackId }.toSet())
        assertEquals(tracks.map { it.title.lowercase() }.sorted(), tracks.map { it.title.lowercase() })
    }

    @Test
    fun queueFolderMirrorsLiveQueueIncludingDuplicates() {
        val withQueue = data.copy(queue = listOf(QueueEntry("q_a", "t3"), QueueEntry("q_b", "t3"), QueueEntry("q_c", "gone")))
        val nodes = BrowseTree.children(BrowseIds.QUEUE, withQueue)
        assertEquals(listOf("queue::q_a", "queue::q_b"), nodes.map { it.id })
        assertTrue(nodes.all { it.playable && it.trackId == "t3" })
        assertEquals("The Hollow", BrowseTree.node("queue::q_b", withQueue)?.title)
        assertEquals("q_b", BrowseIds.queueEntryId("queue::q_b"))
    }

    @Test
    fun favoritesAndRecentsKeepGivenOrderAndSkipUnknownTracks() {
        val d = data.copy(favorites = listOf("t4", "missing", "t1"), recents = listOf("t2", "t3"))
        assertEquals(listOf("t4", "t1"), BrowseTree.children(BrowseIds.FAVORITES, d).map { it.trackId })
        assertEquals(listOf("t2", "t3"), BrowseTree.children(BrowseIds.RECENTS, d).map { it.trackId })
    }

    @Test
    fun playlistsListAndExpand() {
        val d = data.copy(playlists = listOf(PlaylistInfo("p1", "Road trip", listOf("t4", "t1")), PlaylistInfo("p2", "Empty", emptyList())))
        val lists = BrowseTree.children(BrowseIds.PLAYLISTS, d)
        assertEquals(listOf("playlist::p1", "playlist::p2"), lists.map { it.id })
        assertEquals("2 tracks", lists.first().subtitle)
        assertEquals(listOf("t4", "t1"), BrowseTree.children("playlist::p1", d).map { it.trackId })
        assertEquals("Road trip", BrowseTree.node("playlist::p1", d)?.title)
    }

    @Test
    fun trackIdsCarryTheirFolderSoPlayQueuesTheWholeList() {
        val albumId = BrowseIds.album("A Perfect Circle", "Eat The Elephant")
        val mediaId = BrowseTree.children(albumId, data).first().id
        assertEquals("t1", BrowseIds.trackEntityId(mediaId))
        assertEquals(albumId, BrowseIds.contextOf(mediaId))
        assertEquals(listOf("t1", "t2"), BrowseTree.contextTrackIds(albumId, data))
        assertEquals("Eat The Elephant", BrowseTree.node(mediaId, data)?.title)
        assertNull(BrowseIds.contextOf("track::t1"))
        assertNull(BrowseTree.contextTrackIds("nonsense", data))
    }

    @Test
    fun pagingSlicesWithoutOverlapAndHandlesEdges() {
        val many = BrowseData((1..25).map { entity("t$it", "Song %02d".format(it), "A", "B") })
        fun page(n: Int) = BrowseTree.children(BrowseIds.TRACKS, many, n, 10).map { it.trackId }
        assertEquals(10, page(0).size)
        assertEquals(10, page(1).size)
        assertEquals(5, page(2).size)
        assertEquals(emptyList<String>(), page(3))
        assertEquals(25, (page(0) + page(1) + page(2)).toSet().size)
        assertEquals(25, BrowseTree.children(BrowseIds.TRACKS, many).size)
        assertEquals(emptyList<String>(), BrowseTree.children(BrowseIds.TRACKS, many, 0, 0).map { it.id })
        assertEquals(10, BrowseTree.children(BrowseIds.TRACKS, many, 1, 10).size)
        assertEquals(25, BrowseTree.children(BrowseIds.TRACKS, many, 0, Int.MAX_VALUE).size)
    }

    @Test
    fun contextWindowIsBoundedAndKeepsTheTarget() {
        val ids = (0 until 1000).map { "t$it" }
        val (slice, at) = BrowseTree.window(ids, 500)
        assertEquals(BrowseTree.CONTEXT_BEFORE + BrowseTree.CONTEXT_AFTER + 1, slice.size)
        assertEquals("t500", slice[at])
        val (head, headAt) = BrowseTree.window(ids, 0)
        assertEquals(0, headAt)
        assertEquals(BrowseTree.CONTEXT_AFTER + 1, head.size)
        val (tail, tailAt) = BrowseTree.window(ids, 999)
        assertEquals("t999", tail[tailAt])
    }

    @Test
    fun foldersCarryGridOrListHints() {
        assertEquals(ChildStyle.GRID, BrowseTree.node(BrowseIds.ALBUMS, data)?.childStyle)
        assertEquals(ChildStyle.LIST, BrowseTree.node(BrowseIds.TRACKS, data)?.childStyle)
    }

    @Test
    fun nodeResolvesTrackId() {
        val node = BrowseTree.node("track::t3", data)
        assertEquals("The Hollow", node?.title)
        assertEquals("track::t3", node?.id)
        assertEquals("t3", node?.trackId)
    }

    @Test
    fun nodeResolvesFolderId() {
        assertEquals("Albums", BrowseTree.node(BrowseIds.ALBUMS, data)?.title)
    }

    @Test
    fun nodeReturnsNullForUnknownId() {
        assertNull(BrowseTree.node("track::does-not-exist", data))
    }

    @Test
    fun treeIsDeterministicAcrossRepeatedCalls() {
        val first = BrowseTree.children(BrowseIds.ALBUMS, data).map { it.id }
        val second = BrowseTree.children(BrowseIds.ALBUMS, data).map { it.id }
        assertEquals(first, second)
    }
}
