package net.christopherrutherford.statocyst.media

import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkLossTest {
    @Test
    fun droppedAndTimedOutConnectionsAreRecoverable() {
        assertTrue(PlaybackFailures.isNetworkLoss(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED))
        assertTrue(PlaybackFailures.isNetworkLoss(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT))
        assertTrue(PlaybackFailures.isNetworkLoss(PlaybackException.ERROR_CODE_IO_UNSPECIFIED))
    }

    @Test
    fun serverErrorsAreRecoverableButClientErrorsAreNot() {
        val badStatus = PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
        assertTrue(PlaybackFailures.isNetworkLoss(badStatus, 503))
        assertFalse(PlaybackFailures.isNetworkLoss(badStatus, 401))
        assertFalse(PlaybackFailures.isNetworkLoss(badStatus, 404))
    }

    @Test
    fun missingFilesAndDecodeFailuresAreNotNetworkLoss() {
        assertFalse(PlaybackFailures.isNetworkLoss(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND))
        assertFalse(PlaybackFailures.isNetworkLoss(PlaybackException.ERROR_CODE_DECODING_FAILED))
    }

    @Test
    fun recoveryBacksOffAndIsBounded() {
        val steps = PlaybackFailures.RECOVERY_BACKOFF_MS.toList()
        assertEquals(steps.sorted(), steps)
        assertTrue(steps.size in 5..12)
        assertTrue(steps.sum() in 60_000..600_000)
    }

    @Test
    fun aFailedServerIsSkippedOnTheNextPick() = kotlinx.coroutines.runBlocking {
        StreamFailover.resetHealth()
        val make = { id: String ->
            StreamFailover.Candidate(
                net.christopherrutherford.statocyst.db.MediaItemEntity(
                    id = "jf-$id", sourceId = "jellyfin", path = id, pathKey = "jellyfin:$id", fileName = "t", ext = "flac",
                    sizeBytes = 0, mtimeMs = 0, title = "t", artist = "a", album = "b", albumArtist = "a", trackNo = null,
                    discNo = null, year = null, genre = null, durationMs = 1, bitrate = null, sampleRate = null,
                    channels = null, codec = null, format = "flac", artworkPath = null, jellyfinImageTag = null,
                    sourceKind = "jellyfin", sourceLabel = id, addedAt = "", updatedAt = "", serverId = id,
                ),
                net.christopherrutherford.statocyst.jellyfin.JellyfinSession(id, "https://$id.example", "u", "t"),
            )
        }
        val candidates = listOf(make("a"), make("b"))
        // "a" was trusted a moment ago, then died mid-stream.
        StreamFailover.choose(candidates, { true })
        StreamFailover.markFailed("a")
        val probed = mutableListOf<String>()
        val chosen = StreamFailover.choose(candidates, { probed.add(it.session.serverId); true })
        assertEquals("b", chosen?.session?.serverId)
        assertFalse("a" in probed)
    }
}
