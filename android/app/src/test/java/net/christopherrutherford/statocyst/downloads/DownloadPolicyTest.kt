package net.christopherrutherford.statocyst.downloads

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadPolicyTest {
    private val mb = 1024L * 1024
    private val gb = 1024L * mb

    @Test
    fun `estimate prefers the catalog size`() {
        assertEquals(30 * mb, DownloadPolicy.estimateBytes(30 * mb, 1_000_000, 240_000))
    }

    @Test
    fun `estimate falls back to bitrate and duration`() {
        // 192 kbps for four minutes is 5.76 MB.
        assertEquals(5_760_000L, DownloadPolicy.estimateBytes(0, 192_000, 240_000))
    }

    @Test
    fun `estimate uses a safe floor when nothing is known`() {
        assertEquals(DownloadPolicy.UNKNOWN_TRACK_BYTES, DownloadPolicy.estimateBytes(0, null, 0))
    }

    @Test
    fun `automatic quota is the smaller of ten gigabytes and a quarter of free space`() {
        assertEquals(10 * gb, DownloadPolicy.effectiveQuota(0, 100 * gb))
        assertEquals(2 * gb, DownloadPolicy.effectiveQuota(0, 8 * gb))
    }

    @Test
    fun `an explicit quota is still clamped by free space`() {
        assertEquals(5 * gb, DownloadPolicy.effectiveQuota(25 * gb, 20 * gb))
        assertEquals(25 * gb, DownloadPolicy.effectiveQuota(25 * gb, 400 * gb))
    }

    @Test
    fun `admits a transfer that fits quota and free space`() {
        val decision = DownloadPolicy.admit(
            requestedBytes = 2 * gb,
            pinnedBytes = 1 * gb,
            freeBytes = 20 * gb,
            requestedQuota = 10 * gb,
        )
        assertTrue(decision.allowed)
    }

    @Test
    fun `rejects a transfer over the quota`() {
        val decision = DownloadPolicy.admit(
            requestedBytes = 9 * gb,
            pinnedBytes = 2 * gb,
            freeBytes = 100 * gb,
            requestedQuota = 10 * gb,
        )
        assertFalse(decision.allowed)
        assertTrue(decision.reason!!.contains("offline limit"))
    }

    @Test
    fun `rejects a transfer that would consume the reserve`() {
        val decision = DownloadPolicy.admit(
            requestedBytes = 3 * gb,
            pinnedBytes = 0,
            freeBytes = 3 * gb,
            requestedQuota = 10 * gb,
        )
        assertFalse(decision.allowed)
        assertTrue(decision.reason!!.contains("free space"))
    }

    @Test
    fun `estimate uses the transcode bitrate for a saver pin`() {
        // 96 kbps for four minutes is 2.88 MB, not the 30 MB master.
        assertEquals(
            2_880_000L,
            DownloadPolicy.estimateBytes(30 * mb, 1_000_000, 240_000, DownloadProfile.SAVER),
        )
    }

    @Test
    fun `a zero-byte request is always admitted`() {
        assertTrue(DownloadPolicy.admit(0, 0, 0, 0).allowed)
    }
}
