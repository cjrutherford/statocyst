package net.christopherrutherford.statocyst.downloads

import net.christopherrutherford.statocyst.jellyfin.FakeHttpServer
import net.christopherrutherford.statocyst.jellyfin.FakeHttpServer.Request
import net.christopherrutherford.statocyst.jellyfin.FakeHttpServer.Response
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files

class ResumableDownloadTest {
    private val content = ByteArray(100) { it.toByte() }
    private lateinit var dir: File
    private lateinit var target: File
    private lateinit var server: FakeHttpServer
    private var handler: (Request) -> Response = { Response(404) }
    private val pauses = mutableListOf<Long>()

    private class Events : DownloadEvents {
        var cancelAfterProgress = false
        var offlineChecks = 0
        var waits = 0
        val retries = mutableListOf<Int>()
        val progress = mutableListOf<Pair<Long, Long?>>()
        override fun cancelled() = cancelAfterProgress && progress.isNotEmpty()
        override fun online() = offlineChecks-- <= 0
        override fun waiting() { waits++ }
        override fun retrying(attempt: Int, reason: String) { retries.add(attempt) }
        override fun progress(received: Long, total: Long?) { progress.add(received to total) }
    }

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("resume").toFile()
        target = File(dir, "t.part")
        server = FakeHttpServer { handler(it) }
    }

    @After
    fun tearDown() {
        server.close()
        dir.deleteRecursively()
    }

    private fun fetch(events: Events = Events(), maxAttempts: Int = 5) = ResumableDownload.fetch(
        open = { start ->
            (URL(server.url + "/f").openConnection() as HttpURLConnection).also {
                if (start > 0) it.setRequestProperty("Range", "bytes=$start-")
            }
        },
        target = target, events = events, maxAttempts = maxAttempts, pause = { pauses.add(it) }, clock = { pauses.size * 1000L + target.length() * 10 },
    )

    private fun rangeStart(r: Request) = r.headers["range"]?.substringAfter("bytes=")?.substringBefore('-')?.toLong() ?: 0L

    @Test
    fun aDroppedConnectionResumesFromTheBytesAlreadyOnDisk() {
        handler = { r ->
            if (rangeStart(r) == 0L) {
                Response(200, body = content.copyOfRange(0, 40), declaredLength = 100)
            } else {
                Response(206, body = content.copyOfRange(40, 100), headers = mapOf("Content-Range" to "bytes 40-99/100"))
            }
        }
        val events = Events()
        fetch(events)
        assertArrayEquals(content, target.readBytes())
        assertEquals(listOf("bytes=40-"), server.requests.mapNotNull { it.headers["range"] })
        assertEquals(listOf(1), events.retries)
        assertEquals(100L, events.progress.last().first)
    }

    @Test
    fun aServerErrorIsRetriedWithBackoffThenSucceeds() {
        var calls = 0
        handler = { if (++calls < 3) Response(503) else Response(200, body = content) }
        val events = Events()
        fetch(events)
        assertArrayEquals(content, target.readBytes())
        assertEquals(listOf(1, 2), events.retries)
        assertEquals(listOf(2_000L, 5_000L), pauses)
    }

    @Test
    fun itGivesUpAfterTheAttemptLimit() {
        handler = { Response(503) }
        try {
            fetch(maxAttempts = 3)
            fail("expected failure")
        } catch (e: IOException) {
            assertTrue(e.message, e.message!!.contains("503"))
        }
        assertEquals(3, server.requests.size)
    }

    @Test
    fun anAuthRejectionIsFatalAndNotRetried() {
        handler = { Response(401, headers = mapOf("WWW-Authenticate" to "MediaBrowser")) }
        try {
            fetch()
            fail("expected SecurityException")
        } catch (_: SecurityException) {
        }
        assertEquals(1, server.requests.size)
    }

    @Test
    fun aBare401WithoutAChallengeIsStillFatal() {
        handler = { Response(401) }
        try {
            fetch()
            fail("expected SecurityException")
        } catch (_: SecurityException) {
        }
        assertEquals(1, server.requests.size)
    }

    @Test
    fun aServerThatIgnoresRangeRestartsTheFile() {
        target.writeBytes(ByteArray(30) { 99 })
        handler = { Response(200, body = content) }
        fetch()
        assertArrayEquals(content, target.readBytes())
    }

    @Test
    fun aPartThatIsAlreadyTheWholeFileCompletesWithout416Retry() {
        target.writeBytes(content)
        handler = { Response(416, headers = mapOf("Content-Range" to "bytes */100")) }
        fetch()
        assertArrayEquals(content, target.readBytes())
        assertEquals(1, server.requests.size)
    }

    @Test
    fun aStalePartIsDiscardedAndDownloadedAgain() {
        target.writeBytes(ByteArray(500) { 7 })
        handler = { r -> if (rangeStart(r) > 0) Response(416, headers = mapOf("Content-Range" to "bytes */100")) else Response(200, body = content) }
        fetch()
        assertArrayEquals(content, target.readBytes())
    }

    @Test
    fun noNetworkWaitsInsteadOfSpendingAttempts() {
        handler = { Response(200, body = content) }
        val events = Events().apply { offlineChecks = 3 }
        fetch(events, maxAttempts = 1)
        assertEquals(3, events.waits)
        assertEquals(listOf(2_000L, 2_000L, 2_000L), pauses)
        assertArrayEquals(content, target.readBytes())
    }

    @Test
    fun attemptsOnlyCountWhenNoProgressWasMade() {
        var calls = 0
        // Every response delivers 10 more bytes then drops: it still finishes with maxAttempts = 2.
        handler = { r ->
            calls++
            val start = rangeStart(r).toInt()
            val end = minOf(start + 10, 100)
            if (end == 100) {
                Response(206, body = content.copyOfRange(start, 100), headers = mapOf("Content-Range" to "bytes $start-99/100"))
            } else {
                Response(if (start == 0) 200 else 206, body = content.copyOfRange(start, end), declaredLength = 100L - start,
                    headers = if (start == 0) emptyMap() else mapOf("Content-Range" to "bytes $start-99/100"))
            }
        }
        fetch(maxAttempts = 2)
        assertArrayEquals(content, target.readBytes())
        assertTrue(calls >= 10)
    }

    @Test
    fun cancellingStopsWithoutRetry() {
        handler = { Response(200, body = content) }
        val events = Events().apply { cancelAfterProgress = true }
        try {
            fetch(events)
            fail("expected cancel")
        } catch (_: DownloadCancelled) {
        }
        assertFalse(events.retries.isNotEmpty())
    }
}
