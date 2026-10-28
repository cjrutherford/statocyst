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

    @Test
    fun rootHasStableId() {
        assertEquals(BrowseIds.ROOT, BrowseTree.root().id)
        assertEquals("Statocyst", BrowseTree.root().title)
    }

    @Test
    fun rootChildrenAreTheFourStableFolders() {
        val children = BrowseTree.children(BrowseIds.ROOT, catalog)
        assertEquals(
            listOf(BrowseIds.ALBUMS, BrowseIds.ARTISTS, BrowseIds.TRACKS, BrowseIds.QUEUE),
            children.map { it.id },
        )
    }

    @Test
    fun albumsAreDistinctSortedAndStable() {
        val albums = BrowseTree.children(BrowseIds.ALBUMS, catalog)
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
        val tracks = BrowseTree.children(id, catalog)
        assertEquals(listOf("track::t1", "track::t2"), tracks.map { it.id })
        assertEquals(listOf("Eat The Elephant", "Disillusioned"), tracks.map { it.title })
        assertTrue(tracks.all { it.playable })
    }

    @Test
    fun artistsAreDistinctSortedAndStable() {
        val artists = BrowseTree.children(BrowseIds.ARTISTS, catalog)
        assertEquals(
            listOf("artist::A Perfect Circle", "artist::Audioslave"),
            artists.map { it.id },
        )
    }

    @Test
    fun artistChildrenReturnThatArtistsTracks() {
        val tracks = BrowseTree.children(BrowseIds.artist("Audioslave"), catalog)
        assertEquals(listOf("track::t4"), tracks.map { it.id })
        assertEquals("Cochise", tracks.first().title)
    }

    @Test
    fun tracksFolderReturnsAllTracks() {
        val tracks = BrowseTree.children(BrowseIds.TRACKS, catalog)
        assertEquals(4, tracks.size)
        assertEquals(catalog.map { "track::${it.id}" }.toSet(), tracks.map { it.id }.toSet())
    }

    @Test
    fun queueIsEmptyUntilS021() {
        assertEquals(emptyList<BrowseNode>(), BrowseTree.children(BrowseIds.QUEUE, catalog))
    }

    @Test
    fun nodeResolvesTrackId() {
        val node = BrowseTree.node("track::t3", catalog)
        assertEquals("The Hollow", node?.title)
        assertEquals("track::t3", node?.id)
        assertEquals("t3", node?.trackId)
    }

    @Test
    fun nodeResolvesFolderId() {
        assertEquals("Albums", BrowseTree.node(BrowseIds.ALBUMS, catalog)?.title)
    }

    @Test
    fun nodeReturnsNullForUnknownId() {
        assertNull(BrowseTree.node("track::does-not-exist", catalog))
    }

    @Test
    fun treeIsDeterministicAcrossRepeatedCalls() {
        val first = BrowseTree.children(BrowseIds.ALBUMS, catalog).map { it.id }
        val second = BrowseTree.children(BrowseIds.ALBUMS, catalog).map { it.id }
        assertEquals(first, second)
    }
}
