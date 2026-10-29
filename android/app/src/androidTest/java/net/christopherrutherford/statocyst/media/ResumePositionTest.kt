package net.christopherrutherford.statocyst.media

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.Player
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/**
 * Resume contract: a song that was stopped part-way restores paused at that position
 * when the service comes back, and pressing play continues from there rather than from 0.
 */
@RunWith(AndroidJUnit4::class)
class ResumePositionTest {

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val thread = HandlerThread("resume-test").also { it.start() }
    private val handler = Handler(thread.looper)
    private val db by lazy { StatocystDatabase.getInstance(context) }
    private val trackId = "zz-resume-1"
    private var browser: MediaBrowser? = null
    private var savedQueue: SavedQueue? = null

    @After
    fun tearDown() {
        browser?.let { app { it.pause(); it.clearMediaItems(); it.release() } }
        runBlocking { db.mediaItemDao().deleteById(trackId) }
        File(context.filesDir, "library/zz-resume.wav").delete()
        val store = QueueStore(context)
        store.clear()
        savedQueue?.let(store::save)
        PlaybackService.onCatalogChanged()
        thread.quitSafely()
    }

    @Test
    fun aRestoredSongWaitsPausedAtTheSavedPositionAndPlayContinuesFromIt() {
        val wav = TestAudio.writeSilence(File(context.filesDir, "library/zz-resume.wav").apply { parentFile?.mkdirs() }, seconds = 120)
        runBlocking { db.mediaItemDao().upsert(entity(wav)) }
        PlaybackService.onCatalogChanged()

        savedQueue = QueueStore(context).load()
        context.stopService(android.content.Intent(context, PlaybackService::class.java))
        Thread.sleep(2_000)
        QueueStore(context).save(
            SavedQueue(
                slots = listOf(QueueSlot("q_zzr0", trackId)),
                index = 0, positionMs = START_MS, shuffle = false, repeatMode = 0, shuffleOrder = null,
            ),
        )

        val b = MediaBrowser.Builder(
            context, SessionToken(context, ComponentName(context, PlaybackService::class.java)),
        ).setApplicationLooper(thread.looper).buildAsync().get(15, TimeUnit.SECONDS)
        browser = b

        waitFor("queue restored") { app { b.mediaItemCount } == 1 }
        waitFor("restored item ready (state ${app { b.playbackState }}, error ${app { b.playerError }})") {
            app { b.playbackState } == Player.STATE_READY
        }
        val restored = app { b.currentPosition }
        assertTrue("restored at $restored, expected near $START_MS", restored in START_MS..(START_MS + 3_000))
        assertFalse("restore must not start playback", app { b.isPlaying })

        app { b.play() }
        waitFor("playing") { app { b.isPlaying } }
        Thread.sleep(1_000)
        val resumed = app { b.currentPosition }
        assertTrue("play restarted the song: $resumed", resumed >= START_MS)
        assertEquals(1, app { b.mediaItemCount })
    }

    private fun entity(file: File) = MediaItemEntity(
        id = trackId, sourceId = "local", path = file.absolutePath, pathKey = "zz:$trackId", fileName = file.name,
        ext = "wav", sizeBytes = file.length(), mtimeMs = 0, title = "ZZ Resume", artist = "ZZ Artist", album = "ZZ Album",
        albumArtist = "ZZ Artist", trackNo = 1, discNo = null, year = null, genre = null, durationMs = 120_000,
        bitrate = null, sampleRate = null, channels = null, codec = null, format = "wav", artworkPath = null,
        jellyfinImageTag = null, sourceKind = "local", sourceLabel = "Test", addedAt = "", updatedAt = "",
        missing = false, albumId = null,
    )

    private fun <T> app(block: () -> T): T {
        val task = FutureTask(Callable { block() })
        handler.post(task)
        return task.get(10, TimeUnit.SECONDS)
    }

    private fun waitFor(what: String, timeoutMs: Long = 15_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (condition()) return
            Thread.sleep(100)
        }
        assertTrue("$what: not met in ${timeoutMs}ms", condition())
    }

    private companion object {
        const val START_MS = 42_000L
    }
}
