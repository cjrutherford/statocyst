package net.christopherrutherford.statocyst.downloads

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure checks for the MVP-6 download variants; no Android or media codec needed. */
class VideoDownloadProfileTest {
    @Test
    fun mapsContractVariantNames() {
        assertEquals(DownloadProfile.ORIGINAL, DownloadProfile.from("original"))
        assertEquals(DownloadProfile.AUDIO_ONLY, DownloadProfile.from("audio-only"))
        assertEquals(DownloadProfile.VIDEO_480P, DownloadProfile.from("video-480p"))
        assertEquals(DownloadProfile.VIDEO_720P, DownloadProfile.from("video-720p"))
        assertEquals(DownloadProfile.ORIGINAL, DownloadProfile.from("not-a-variant"))
    }

    @Test
    fun onlyVideoPresetsCompressLocally() {
        assertFalse(DownloadProfile.ORIGINAL.compressed)
        assertFalse(DownloadProfile.BALANCED.compressed)
        assertTrue(DownloadProfile.AUDIO_ONLY.compressed)
        assertTrue(DownloadProfile.VIDEO_480P.compressed)
        assertTrue(DownloadProfile.VIDEO_720P.compressed)
        assertEquals(480, DownloadProfile.VIDEO_480P.targetHeight)
        assertEquals(720, DownloadProfile.VIDEO_720P.targetHeight)
        assertEquals("mp4", DownloadProfile.VIDEO_720P.extension)
        assertEquals("m4a", DownloadProfile.AUDIO_ONLY.extension)
    }

    @Test
    fun estimatesACompressedCopyFromItsTargetBitrate() {
        val oneHour = 3_600_000L
        val audioOnly = DownloadPolicy.estimateBytes(0, null, oneHour, DownloadProfile.AUDIO_ONLY)
        val video480 = DownloadPolicy.estimateBytes(0, null, oneHour, DownloadProfile.VIDEO_480P)
        val video720 = DownloadPolicy.estimateBytes(0, null, oneHour, DownloadProfile.VIDEO_720P)
        assertTrue(audioOnly < video480)
        assertTrue(video480 < video720)
        assertEquals((64_000L / 8) * 3_600, audioOnly)
    }
}
