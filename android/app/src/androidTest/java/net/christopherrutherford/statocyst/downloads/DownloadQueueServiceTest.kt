package net.christopherrutherford.statocyst.downloads

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** Runs the real queue and foreground service against local fixture files (no network). */
class DownloadQueueServiceTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val db by lazy { StatocystDatabase.getInstance(context) }
    private val dir = File(context.cacheDir, "zz-dl-fixtures")
    private val ids = (1..5).map { "zz-dl-$it" }

    @Before
    fun setUp() {
        dir.mkdirs()
        runBlocking {
            ids.forEachIndexed { i, id ->
                val file = File(dir, "$id.mp3").also { it.writeBytes(ByteArray(300_000 + i) { b -> b.toByte() }) }
                db.mediaItemDao().upsert(fixture(id, file))
            }
        }
        DownloadCenter.queue(context).let { it.cancelAll(); it.dismiss() }
    }

    @After
    fun tearDown() {
        val manager = DownloadManager(context)
        ids.forEach { manager.remove(it) }
        runBlocking { ids.forEach { db.mediaItemDao().deleteById(it) } }
        DownloadCenter.queue(context).let { it.cancelAll(); it.dismiss() }
        dir.deleteRecursively()
    }

    @Test
    fun aBatchRunsToCompletionUnderTheForegroundService() {
        val seen = java.util.Collections.synchronizedList(mutableListOf<QueueSnapshot>())
        val queue = DownloadCenter.queue(context)
        queue.addListener { seen.add(it) }
        assertEquals(5, DownloadCenter.enqueue(context, ids))

        val end = System.currentTimeMillis() + 20_000
        while (!queue.snapshot().finished && System.currentTimeMillis() < end) Thread.sleep(100)
        val s = queue.snapshot()
        assertTrue("batch did not finish: $s", s.finished)
        assertEquals(5, s.done)
        assertEquals(0, s.failed)
        assertTrue("byte totals should be known", s.sizesKnown && s.totalBytes == s.receivedBytes)

        val manager = DownloadManager(context)
        ids.forEach { assertNotNull("$it should be a verified download", manager.verifiedFile(it)) }
        assertTrue("progress should have been reported while running", seen.any { it.pending > 0 })

        // The service must stop itself once the queue drains.
        val stopEnd = System.currentTimeMillis() + 5_000
        while (serviceRunning() && System.currentTimeMillis() < stopEnd) Thread.sleep(100)
        assertTrue("DownloadService should have stopped", !serviceRunning())
    }

    @Test
    fun aMissingSourceFailsOneTrackWithoutStoppingTheRest() {
        File(dir, "${ids[2]}.mp3").delete()
        val queue = DownloadCenter.queue(context)
        DownloadCenter.enqueue(context, ids)
        val end = System.currentTimeMillis() + 20_000
        while (!queue.snapshot().finished && System.currentTimeMillis() < end) Thread.sleep(100)
        val s = queue.snapshot()
        assertEquals(4, s.done)
        assertEquals(1, s.failed)
        assertEquals("The source file is missing", s.entries.first { it.state == DownloadState.FAILED }.error)
    }

    @Suppress("DEPRECATION")
    private fun serviceRunning(): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        return am.getRunningServices(100).any { it.service.className == DownloadService::class.java.name }
    }

    private fun fixture(id: String, file: File) = MediaItemEntity(
        id = id, sourceId = "local", path = file.absolutePath, pathKey = "zz:$id", fileName = file.name,
        ext = "mp3", sizeBytes = file.length(), mtimeMs = 0, title = id, artist = "DLQ Artist", album = "DLQ Album",
        albumArtist = "DLQ Artist", trackNo = 1, discNo = null, year = null, genre = null, durationMs = 200_000,
        bitrate = null, sampleRate = null, channels = null, codec = null, format = "mp3", artworkPath = null,
        jellyfinImageTag = null, sourceKind = "local", sourceLabel = "Test", addedAt = "", updatedAt = "",
        missing = false, albumId = null,
    )
}
