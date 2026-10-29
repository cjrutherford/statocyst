package net.christopherrutherford.statocyst.library

import net.christopherrutherford.statocyst.db.MediaItemEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class DuplicatesTest {
    private fun track(
        id: String,
        server: String,
        title: String = "Bend",
        artist: String = "Binaerpilot",
        album: String = "Bend EP",
        durationMs: Long = 200_000,
        kind: String = "jellyfin",
    ) = MediaItemEntity(
        id = id, sourceId = kind, path = id, pathKey = "$kind:$id", fileName = title, ext = "flac",
        sizeBytes = 0, mtimeMs = 0, title = title, artist = artist, album = album, albumArtist = artist,
        trackNo = null, discNo = null, year = null, genre = null, durationMs = durationMs,
        bitrate = null, sampleRate = null, channels = null, codec = null, format = "flac",
        artworkPath = null, jellyfinImageTag = null, sourceKind = kind, sourceLabel = server,
        addedAt = "", updatedAt = "", serverId = if (kind == "local") "" else server,
    )

    @Test
    fun sameRecordingOnTwoServersShowsOnce() {
        val all = listOf(track("jf-a", "s2"), track("jf-b", "s1"))
        assertEquals(listOf("jf-b"), Duplicates.collapse(all).map { it.id })
    }

    @Test
    fun matchingIgnoresCaseAndSpacing() {
        val all = listOf(track("a", "s1"), track("b", "s2", title = "  BEND ", album = "bend  ep"))
        assertEquals(1, Duplicates.collapse(all).size)
    }

    @Test
    fun differentLengthsAreDifferentRecordings() {
        val all = listOf(track("a", "s1"), track("b", "s2", durationMs = 260_000))
        assertEquals(2, Duplicates.collapse(all).size)
    }

    @Test
    fun twoCopiesOnOneServerStaySeparate() {
        val all = listOf(track("a", "s1"), track("b", "s1"))
        assertEquals(2, Duplicates.collapse(all).size)
    }

    @Test
    fun localFilesAreNeverMerged() {
        val all = listOf(track("a", "s1"), track("l1", "", kind = "local"), track("l2", "", kind = "local"))
        assertEquals(3, Duplicates.collapse(all).size)
    }

    @Test
    fun threeServersCollapseToOneAndKeepOrder() {
        val all = listOf(track("c", "s3"), track("x", "s1", title = "Other"), track("a", "s1"), track("b", "s2"))
        assertEquals(listOf("x", "a"), Duplicates.collapse(all).map { it.id })
    }

    @Test
    fun alternatesAreOnePerOtherServer() {
        val primary = track("a", "s1")
        val all = listOf(primary, track("b", "s2"), track("b2", "s2"), track("c", "s3"), track("d", "s1"))
        assertEquals(listOf("b", "c"), Duplicates.alternatesOf(primary, all).map { it.id })
    }

    @Test
    fun removingAServerRestoresTheOtherCopy() {
        val withBoth = listOf(track("a", "s1"), track("b", "s2"))
        assertEquals(listOf("a"), Duplicates.collapse(withBoth).map { it.id })
        assertEquals(listOf("b"), Duplicates.collapse(withBoth.filter { it.serverId != "s1" }).map { it.id })
    }
}
