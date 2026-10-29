package net.christopherrutherford.statocyst.widget

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.HandlerThread
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.R
import net.christopherrutherford.statocyst.db.FavoriteEntity
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.PlaylistEntity
import net.christopherrutherford.statocyst.db.PlaylistTrackEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.media.PlaybackService
import net.christopherrutherford.statocyst.media.TestAudio
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/**
 * The widget renders the current song and the top of the favorites list, and tapping a
 * favorite plays it (with the favorites queued around it) through the real service.
 */
@RunWith(AndroidJUnit4::class)
class NowPlayingWidgetTest {

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val db by lazy { StatocystDatabase.getInstance(context) }
    private val ids = (1..6).map { "zz-widget-$it" }
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private var browser: MediaBrowser? = null
    private var savedFavorites = emptyList<FavoriteEntity>()
    private var savedPlaylists = emptyList<PlaylistEntity>()
    private var savedPlaylistTracks = emptyList<PlaylistTrackEntity>()
    private var savedWidget = WidgetState()

    @Before
    fun setUp() {
        thread = HandlerThread("widget-test").also { it.start() }
        handler = Handler(thread.looper)
        savedWidget = WidgetStateStore(context).load()
        val wav = TestAudio.writeSilence(File(context.filesDir, "library/zz-widget.wav"), seconds = 30)
        runBlocking {
            savedFavorites = db.userDao().favorites()
            savedPlaylists = db.userDao().playlists()
            savedPlaylistTracks = db.userDao().playlistTracks()
            ids.forEachIndexed { i, id -> db.mediaItemDao().upsert(entity(id, "Widget Song ${i + 1}", wav)) }
            db.userDao().replaceUserState(ids.mapIndexed { i, id -> FavoriteEntity(id, i) }, emptyList(), emptyList())
        }
        PlaybackService.onUserStateChanged()
        PlaybackService.onCatalogChanged()
    }

    @After
    fun tearDown() {
        browser?.let { b -> app { b.pause(); b.clearMediaItems(); b.release() } }
        runBlocking {
            ids.forEach { db.mediaItemDao().deleteById(it) }
            db.userDao().replaceUserState(savedFavorites, savedPlaylists, savedPlaylistTracks)
        }
        File(context.filesDir, "library/zz-widget.wav").delete()
        WidgetStateStore(context).save(savedWidget)
        PlaybackService.onUserStateChanged()
        PlaybackService.onCatalogChanged()
        thread.quitSafely()
    }

    @Test
    fun rendersTheCurrentSongAndOnlyTheTopFavorites() {
        val rows = (1..6).map { NowPlayingWidget.Companion.FavoriteRow(ids[it - 1], "Widget Song $it – ZZ Artist") }
            .take(NowPlayingWidget.FAVORITE_ROWS)
        val state = WidgetState(trackId = ids[0], title = "Widget Song 1", artist = "ZZ Artist", playing = true)
        val root = inflate(NowPlayingWidget.render(context, state, rows))

        assertEquals("Widget Song 1", root.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals("ZZ Artist", root.findViewById<TextView>(R.id.widget_artist).text.toString())
        assertEquals("Pause", root.findViewById<View>(R.id.widget_play_pause).contentDescription.toString())
        assertEquals(View.VISIBLE, root.findViewById<View>(R.id.widget_fav_4).visibility)
        assertEquals("Widget Song 4 – ZZ Artist", root.findViewById<TextView>(R.id.widget_fav_4).text.toString())
        assertEquals(View.GONE, root.findViewById<View>(R.id.widget_fav_empty).visibility)
        snapshot(root, "widget-playing.png")

        val idle = inflate(NowPlayingWidget.render(context, WidgetState(), emptyList()))
        assertEquals(context.getString(R.string.widget_nothing_playing), idle.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals("Play", idle.findViewById<View>(R.id.widget_play_pause).contentDescription.toString())
        assertEquals(View.GONE, idle.findViewById<View>(R.id.widget_fav_1).visibility)
        assertEquals(View.VISIBLE, idle.findViewById<View>(R.id.widget_fav_empty).visibility)
        snapshot(idle, "widget-idle.png")
    }

    @Test
    fun tappingAFavoritePlaysItAndQueuesTheFavoritesAroundIt() {
        context.stopService(Intent(context, PlaybackService::class.java))
        Thread.sleep(1_500)
        context.sendBroadcast(
            Intent(WidgetActionReceiver.ACTION_PLAY_FAVORITE)
                .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
                .putExtra(WidgetActionReceiver.EXTRA_TRACK_ID, ids[2]),
        )

        val b = MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
            .setApplicationLooper(thread.looper).buildAsync().get(15, TimeUnit.SECONDS)
        browser = b
        waitFor("favorite playing") { app { b.isPlaying } }
        assertEquals("Widget Song 3", app { b.mediaMetadata.title?.toString() })
        assertTrue("favorites should be queued around it", app { b.mediaItemCount } >= ids.size)

        // The service mirrors what plays into the state the widget renders.
        waitFor("widget state published") {
            WidgetStateStore(context).load().let { it.title == "Widget Song 3" && it.playing }
        }
    }

    private fun entity(id: String, title: String, file: File) = MediaItemEntity(
        id = id, sourceId = "local", path = file.absolutePath, pathKey = "zz:$id", fileName = file.name,
        ext = "wav", sizeBytes = file.length(), mtimeMs = 0, title = title, artist = "ZZ Artist", album = "ZZ Album",
        albumArtist = "ZZ Artist", trackNo = 1, discNo = null, year = null, genre = null, durationMs = 30_000,
        bitrate = null, sampleRate = null, channels = null, codec = null, format = "wav", artworkPath = null,
        jellyfinImageTag = null, sourceKind = "local", sourceLabel = "Test", addedAt = "", updatedAt = "",
        missing = false, albumId = null,
    )

    private fun inflate(views: android.widget.RemoteViews): View {
        var out: View? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            out = views.apply(context, FrameLayout(context))
        }
        return out!!
    }

    /** Draws the inflated widget at a 4x3-cell size so the layout can be looked at. */
    private fun snapshot(view: View, name: String) {
        val d = context.resources.displayMetrics.density
        val w = (300 * d).toInt()
        val h = (190 * d).toInt()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            view.layout(0, 0, w, h)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val dir = context.getExternalFilesDir(null) ?: context.cacheDir
            File(dir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

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
}
