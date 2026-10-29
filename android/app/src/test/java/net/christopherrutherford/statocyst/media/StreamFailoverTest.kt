package net.christopherrutherford.statocyst.media

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.jellyfin.JellyfinSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class StreamFailoverTest {
    @Before
    fun reset() = StreamFailover.resetHealth()

    private fun candidate(server: String) = StreamFailover.Candidate(
        MediaItemEntity(
            id = "jf-$server", sourceId = "jellyfin", path = server, pathKey = "jellyfin:$server", fileName = "t",
            ext = "flac", sizeBytes = 0, mtimeMs = 0, title = "t", artist = "a", album = "b", albumArtist = "a",
            trackNo = null, discNo = null, year = null, genre = null, durationMs = 1, bitrate = null,
            sampleRate = null, channels = null, codec = null, format = "flac", artworkPath = null,
            jellyfinImageTag = null, sourceKind = "jellyfin", sourceLabel = server, addedAt = "", updatedAt = "",
            serverId = server,
        ),
        JellyfinSession(server, "https://$server.example", "u", "t"),
    )

    @Test
    fun aSingleServerIsNeverProbed() = runBlocking {
        val chosen = StreamFailover.choose(listOf(candidate("s1")), { error("must not probe") })
        assertEquals("s1", chosen?.session?.serverId)
    }

    @Test
    fun theFirstServerToAnswerWins() = runBlocking {
        val probe: suspend (StreamFailover.Candidate) -> Boolean = {
            if (it.session.serverId == "slow") { delay(1_500); true } else true
        }
        val chosen = StreamFailover.choose(listOf(candidate("slow"), candidate("fast")), probe)
        assertEquals("fast", chosen?.session?.serverId)
    }

    @Test
    fun aDeadServerIsSkipped() = runBlocking {
        val chosen = StreamFailover.choose(listOf(candidate("down"), candidate("up")), { it.session.serverId == "up" })
        assertEquals("up", chosen?.session?.serverId)
    }

    @Test
    fun nothingWorkingGivesNull() = runBlocking {
        assertNull(StreamFailover.choose(listOf(candidate("a"), candidate("b")), { false }))
    }

    @Test
    fun aRecentlyWorkingServerIsTrustedWithoutProbing() = runBlocking {
        StreamFailover.choose(listOf(candidate("a"), candidate("b")), { true })
        val chosen = StreamFailover.choose(listOf(candidate("a"), candidate("b")), { error("must not probe") })
        assertNotNullServer(chosen)
    }

    private fun assertNotNullServer(c: StreamFailover.Candidate?) = assertEquals(true, c != null)
}
