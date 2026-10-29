package net.christopherrutherford.statocyst.media

import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import net.christopherrutherford.statocyst.media.AdaptiveQuality.Mode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdaptiveQualityTest {
    private val flac = 900_000L

    @Test
    fun losslessPreferenceNeverTranscodes() {
        assertEquals(Mode.DIRECT, AdaptiveQuality.decide(false, flac, 50_000L, stalled = true))
    }

    @Test
    fun healthyConnectionKeepsTheOriginal() {
        assertEquals(Mode.DIRECT, AdaptiveQuality.decide(true, flac, 5_000_000L))
    }

    @Test
    fun connectionWithoutHeadroomTranscodes() {
        assertEquals(Mode.TRANSCODE, AdaptiveQuality.decide(true, flac, 900_000L))
        assertEquals(Mode.TRANSCODE, AdaptiveQuality.decide(true, flac, 300_000L))
    }

    @Test
    fun unknownConnectionKeepsTheOriginalUnlessStalled() {
        assertEquals(Mode.DIRECT, AdaptiveQuality.decide(true, flac, null))
        assertEquals(Mode.TRANSCODE, AdaptiveQuality.decide(true, flac, null, stalled = true))
    }

    @Test
    fun smallSourceIsNeverTranscoded() {
        assertEquals(Mode.DIRECT, AdaptiveQuality.decide(true, 128_000L, 20_000L, stalled = true))
    }

    @Test
    fun transcodeUrlIsRecognised() {
        val url = JellyfinAuth.transcodeUrl("https://x.test/", "abc", 192_000)
        assertTrue(JellyfinAuth.isTranscodeUrl(url))
        assertFalse(JellyfinAuth.isTranscodeUrl(JellyfinAuth.streamUrl("https://x.test", "abc")))
    }
}
