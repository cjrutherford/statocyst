package net.christopherrutherford.statocyst.downloads

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class DownloadQueueTest {
    private val persisted = mutableListOf<List<String>>()
    private val snapshots = java.util.Collections.synchronizedList(mutableListOf<QueueSnapshot>())
    private var queue: DownloadQueue? = null

    @After
    fun tearDown() {
        queue?.cancelAll()
    }

    private fun queue(
        concurrency: Int = 1,
        clock: () -> Long = System::currentTimeMillis,
        runner: (String, DownloadEvents) -> Unit,
    ): DownloadQueue = DownloadQueue(runner, persist = { persisted.add(it) }, concurrency = concurrency, clock = clock, emitIntervalMs = 0).also {
        it.addListener { s -> snapshots.add(s) }
        queue = it
    }

    private fun await(timeoutMs: Long = 3_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!cond()) {
            if (System.currentTimeMillis() > end) throw AssertionError("timed out; last=${queue?.snapshot()}")
            Thread.sleep(5)
        }
    }

    @Test
    fun runsEveryTrackAndReportsAFinishedBatch() {
        val q = queue { _, e -> e.progress(50, 100); e.progress(100, 100) }
        assertEquals(3, q.enqueue(listOf("a", "b", "c", "a")))
        await { q.snapshot().finished }
        val s = q.snapshot()
        assertEquals(3, s.total); assertEquals(3, s.done); assertEquals(0, s.failed)
        assertEquals(300L, s.receivedBytes); assertEquals(300L, s.totalBytes)
        assertEquals(emptyList<String>(), persisted.last())
    }

    @Test
    fun aFailureIsKeptWithItsMessageAndRetryFailedRunsItAgain() {
        var failB = true
        val q = queue { id, _ -> if (id == "b" && failB) throw IllegalStateException("The server returned HTTP 404") }
        q.enqueue(listOf("a", "b", "c"))
        await { q.snapshot().finished }
        var s = q.snapshot()
        assertEquals(2, s.done); assertEquals(1, s.failed)
        assertEquals("The server returned HTTP 404", s.entries.first { it.trackId == "b" }.error)

        failB = false
        assertEquals(1, q.retryFailed())
        await { q.snapshot().let { it.finished && it.failed == 0 } }
        s = q.snapshot()
        assertEquals(3, s.done)
    }

    @Test
    fun stateTransitionsAreVisible() {
        val gate = CountDownLatch(1)
        val q = queue { _, e ->
            e.waiting(); e.retrying(2, "HTTP 503"); e.progress(10, 100); gate.await(3, TimeUnit.SECONDS)
        }
        q.enqueue(listOf("a"))
        await { snapshots.any { it.entries.any { e -> e.state == DownloadState.ACTIVE && e.receivedBytes == 10L } } }
        gate.countDown()
        await { q.snapshot().finished }
        val states = snapshots.flatMap { it.entries.map { e -> e.state } }
        assertTrue(states.contains(DownloadState.WAITING))
        assertTrue(states.contains(DownloadState.RETRYING))
        assertEquals(2, snapshots.flatMap { it.entries }.first { it.state == DownloadState.RETRYING }.attempt)
    }

    @Test
    fun cancelAllDropsQueuedTracksAndStopsTheRunningOne() {
        val started = CountDownLatch(1)
        val q = queue { _, e ->
            started.countDown()
            while (!e.cancelled()) Thread.sleep(5)
            throw DownloadCancelled()
        }
        q.enqueue(listOf("a", "b", "c"))
        assertTrue(started.await(3, TimeUnit.SECONDS))
        q.cancelAll()
        await { q.snapshot().entries.isEmpty() }
        assertEquals(emptyList<String>(), persisted.last())
        assertFalse(q.snapshot().finished)
    }

    @Test
    fun aNewBatchReplacesAFinishedOneButKeepsTheCountsHonest() {
        val q = queue { _, _ -> }
        q.enqueue(listOf("a", "b"))
        await { q.snapshot().finished }
        q.enqueue(listOf("c"))
        await { q.snapshot().finished }
        assertEquals(1, q.snapshot().total)
    }

    @Test
    fun enqueueingARunningTrackAgainDoesNotDuplicateIt() {
        val gate = CountDownLatch(1)
        val runs = ConcurrentHashMap<String, Int>()
        val q = queue { id, _ -> runs.merge(id, 1, Int::plus); gate.await(3, TimeUnit.SECONDS) }
        q.enqueue(listOf("a"))
        await { runs["a"] == 1 }
        assertEquals(0, q.enqueue(listOf("a")))
        gate.countDown()
        await { q.snapshot().finished }
        assertEquals(1, runs["a"])
    }

    @Test
    fun dismissClearsFinishedEntriesOnly() {
        val gate = CountDownLatch(1)
        val q = queue { id, _ -> if (id == "slow") gate.await(3, TimeUnit.SECONDS) else Unit }
        q.enqueue(listOf("slow"))
        q.dismiss()
        assertEquals(1, q.snapshot().total)
        gate.countDown()
        await { q.snapshot().finished }
        q.dismiss()
        assertEquals(0, q.snapshot().total)
    }

    @Test
    fun progressUpdatesAreThrottledButStateChangesAreNot() {
        var now = 1_000_000L
        val q = DownloadQueue(
            { _, e -> repeat(50) { e.progress(it.toLong(), 100) } },
            clock = { now }, emitIntervalMs = 250, concurrency = 1,
        )
        queue = q
        val seen = java.util.Collections.synchronizedList(mutableListOf<QueueSnapshot>())
        q.addListener { seen.add(it) }
        q.enqueue(listOf("a"))
        await { q.snapshot().finished }
        // queued, active, done: no per-chunk progress while the clock stands still.
        assertTrue(seen.size.toString(), seen.size <= 4)
    }

    @Test
    fun byteTotalsAreUnknownUntilEverySizeIsKnown() {
        val gate = CountDownLatch(1)
        val q = queue(concurrency = 2) { id, e -> if (id == "a") e.progress(10, 100) else Unit; gate.await(3, TimeUnit.SECONDS) }
        q.enqueue(listOf("a", "b"))
        await { q.snapshot().entries.firstOrNull { it.trackId == "a" }?.totalBytes == 100L }
        assertFalse(q.snapshot().sizesKnown)
        assertEquals(100L, q.snapshot().totalBytes)
        gate.countDown()
        await { q.snapshot().finished }
        assertNull(null)
    }
}
