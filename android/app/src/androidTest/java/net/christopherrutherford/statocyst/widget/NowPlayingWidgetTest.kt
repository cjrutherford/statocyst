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
import net.christopherrutherford.statocyst.media.BrowseIds
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

    private fun tiles(contextId: String) =
        (1..6).map { Tile(ids[it - 1], "Widget Song $it", "ZZ Artist", null, contextId) }

    @Test
    fun rendersTheCurrentSongAndOnlyTheTopFavorites() {
        val state = WidgetState(trackId = ids[0], title = "Widget Song 1", artist = "ZZ Artist", playing = true)
        val root = inflate(NowPlayingWidget.render(context, WidgetData(state, true, tiles(BrowseIds.FAVORITES))))

        assertEquals("Widget Song 1", root.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals("ZZ Artist", root.findViewById<TextView>(R.id.widget_artist).text.toString())
        assertEquals("Pause", root.findViewById<View>(R.id.widget_play_pause).contentDescription.toString())
        assertEquals(View.VISIBLE, root.findViewById<View>(R.id.widget_fav_4).visibility)
        assertEquals("4  Widget Song 4 \u2013 ZZ Artist", root.findViewById<TextView>(R.id.widget_fav_4).text.toString())
        assertEquals(View.GONE, root.findViewById<View>(R.id.widget_fav_empty).visibility)
        snapshot(root, "widget-playing.png", 300, 200)

        val idle = inflate(NowPlayingWidget.render(context, WidgetData(WidgetState())))
        assertEquals(context.getString(R.string.widget_nothing_playing), idle.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals("Play", idle.findViewById<View>(R.id.widget_play_pause).contentDescription.toString())
        assertEquals(View.GONE, idle.findViewById<View>(R.id.widget_fav_1).visibility)
        assertEquals(View.VISIBLE, idle.findViewById<View>(R.id.widget_fav_empty).visibility)
        snapshot(idle, "widget-idle.png", 300, 200)
    }

    @Test
    fun largeAndCompactPlayersShowTheSongAndFavoriteState() {
        val state = WidgetState(trackId = ids[0], title = "Widget Song 1", artist = "ZZ Artist", playing = true)
        val large = inflate(NowPlayingLargeWidget.render(context, WidgetData(state, currentIsFavorite = true)))
        assertEquals("Widget Song 1", large.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals(View.VISIBLE, large.findViewById<View>(R.id.widget_favorite).visibility)
        snapshot(large, "widget-large.png", 300, 130)
        val idleLarge = inflate(NowPlayingLargeWidget.render(context, WidgetData(WidgetState())))
        assertEquals(View.INVISIBLE, idleLarge.findViewById<View>(R.id.widget_favorite).visibility)

        val compact = inflate(NowPlayingCompactWidget.render(context, WidgetData(state)))
        assertEquals("Widget Song 1", compact.findViewById<TextView>(R.id.widget_title).text.toString())
        assertEquals("Pause", compact.findViewById<View>(R.id.widget_play_pause).contentDescription.toString())
        snapshot(compact, "widget-compact.png", 300, 64)
    }

    @Test
    fun quickPicksShowRecentsThenFavoritesWithoutDuplicates() {
        val recents = tiles(BrowseIds.RECENTS).take(3)
        val data = WidgetData(WidgetState(), favorites = tiles(BrowseIds.FAVORITES), recents = recents)
        val picks = QuickPicksWidget.picks(data)
        assertEquals(6, picks.size)
        assertEquals(ids.take(3), picks.take(3).map { it.trackId })
        assertEquals(BrowseIds.FAVORITES, picks[3].contextId)
        assertEquals(picks.size, picks.map { it.trackId }.toSet().size)

        val root = inflate(QuickPicksWidget.render(context, data))
        assertEquals("Widget Song 1", root.findViewById<TextView>(R.id.pick_1_title).text.toString())
        assertEquals(View.VISIBLE, root.findViewById<View>(R.id.pick_6).visibility)
        assertEquals(View.INVISIBLE, root.findViewById<View>(R.id.pick_7).visibility)
        assertEquals(View.GONE, root.findViewById<View>(R.id.picks_empty).visibility)
        snapshot(root, "widget-picks.png", 300, 190)

        val empty = inflate(QuickPicksWidget.render(context, WidgetData(WidgetState())))
        assertEquals(View.VISIBLE, empty.findViewById<View>(R.id.picks_empty).visibility)
        assertEquals(View.GONE, empty.findViewById<View>(R.id.picks_row_2).visibility)
    }

    @Test
    fun speedDialMixesHistoryAndFavoritesOrShowsWhicheverExists() {
        val history = tiles(BrowseIds.RECENTS).take(3)
        val favorites = tiles(BrowseIds.FAVORITES).drop(2) // overlaps history on song 3

        val both = SpeedDialWidget.mix(WidgetData(WidgetState(), favorites = favorites, history = history))
        assertEquals(ids.toSet(), both.map { it.trackId }.toSet())
        assertEquals(both.size, both.map { it.trackId }.toSet().size)
        assertEquals(BrowseIds.RECENTS, both[0].contextId)
        assertEquals(BrowseIds.FAVORITES, both[1].contextId)
        assertEquals("History & favorites", SpeedDialWidget.label(context, WidgetData(WidgetState(), favorites = favorites, history = history)))

        val onlyFavorites = WidgetData(WidgetState(), favorites = favorites)
        assertTrue(SpeedDialWidget.mix(onlyFavorites).all { it.contextId == BrowseIds.FAVORITES })
        assertEquals("Favorites", SpeedDialWidget.label(context, onlyFavorites))
        val onlyHistory = WidgetData(WidgetState(), history = history)
        assertTrue(SpeedDialWidget.mix(onlyHistory).all { it.contextId == BrowseIds.RECENTS })
        assertEquals("History", SpeedDialWidget.label(context, onlyHistory))
        assertTrue(SpeedDialWidget.mix(WidgetData(WidgetState())).isEmpty())

        // The playing song is shown in the player strip, not repeated in the grid.
        val playing = WidgetState(trackId = ids[0], title = "Widget Song 1", playing = true)
        assertTrue(SpeedDialWidget.mix(WidgetData(playing, favorites = favorites, history = history)).none { it.trackId == ids[0] })
    }

    @Test
    fun speedDialGridItemsRenderAndCarryTheirTrack() {
        val tile = tiles(BrowseIds.FAVORITES)[1]
        val item = inflate(SpeedDialService.Factory.item(context, tile))
        assertEquals("Widget Song 2", item.findViewById<TextView>(R.id.dial_item_title).text.toString())

        // The factory reads the real library: favorites exist (set up above), so they are listed.
        val factory = SpeedDialService.Factory(context)
        factory.onDataSetChanged()
        assertTrue(factory.count >= ids.size)
    }

    @Test
    fun speedDialPopulatesThroughARealWidgetHost() {
        val inst = InstrumentationRegistry.getInstrumentation()
        inst.uiAutomation.adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET")
        val host = android.appwidget.AppWidgetHost(context, 4242)
        val manager = android.appwidget.AppWidgetManager.getInstance(context)
        val id = host.allocateAppWidgetId()
        try {
            host.startListening()
            val provider = ComponentName(context, SpeedDialWidget::class.java)
            assertTrue("bind", manager.bindAppWidgetIdIfAllowed(id, provider))
            val info = manager.getAppWidgetInfo(id)
            var hostView: View? = null
            inst.runOnMainSync { hostView = host.createView(context, id, info) }
            val view = hostView!!
            Widgets.refresh(context)

            val d = context.resources.displayMetrics.density
            val w = (300 * d).toInt()
            val h = (260 * d).toInt()
            fun grid(): android.widget.GridView? = view.findViewById(R.id.dial_grid)
            waitFor("grid populated through the service") {
                inst.runOnMainSync {
                    view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
                    view.layout(0, 0, w, h)
                }
                (grid()?.childCount ?: 0) >= 4
            }
            assertTrue(view.findViewById<TextView>(R.id.dial_header).text.toString() in setOf("Favorites", "History & favorites"))
            assertTrue("player controls present", view.findViewById<View>(R.id.widget_play_pause) != null)
            snapshot(view, "widget-dial-host.png", 300, 260)
        } finally {
            host.stopListening()
            host.deleteAppWidgetId(id)
            inst.uiAutomation.dropShellPermissionIdentity()
        }
    }

    @Test
    fun tappingATilePlaysItAndQueuesItsListAroundIt() {
        context.stopService(Intent(context, PlaybackService::class.java))
        Thread.sleep(1_500)
        context.sendBroadcast(
            Intent(WidgetActionReceiver.ACTION_PLAY_TRACK)
                .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
                .putExtra(WidgetActionReceiver.EXTRA_TRACK_ID, ids[2])
                .putExtra(WidgetActionReceiver.EXTRA_CONTEXT, BrowseIds.FAVORITES),
        )

        val b = MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
            .setApplicationLooper(thread.looper).buildAsync().get(15, TimeUnit.SECONDS)
        browser = b
        waitFor("tile playing") { app { b.isPlaying } }
        assertEquals("Widget Song 3", app { b.mediaMetadata.title?.toString() })
        assertTrue("favorites should be queued around it", app { b.mediaItemCount } >= ids.size)

        // The service mirrors what plays into the state the widget renders.
        waitFor("widget state published") {
            WidgetStateStore(context).load().let { it.title == "Widget Song 3" && it.playing }
        }
    }

    @Test
    fun theHeartTogglesTheCurrentSongAsAFavorite() {
        context.stopService(Intent(context, PlaybackService::class.java))
        Thread.sleep(1_500)
        context.sendBroadcast(
            Intent(WidgetActionReceiver.ACTION_PLAY_TRACK)
                .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
                .putExtra(WidgetActionReceiver.EXTRA_TRACK_ID, ids[1])
                .putExtra(WidgetActionReceiver.EXTRA_CONTEXT, BrowseIds.FAVORITES),
        )
        val b = MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
            .setApplicationLooper(thread.looper).buildAsync().get(15, TimeUnit.SECONDS)
        browser = b
        waitFor("song playing") { app { b.isPlaying } }
        assertTrue(runBlocking { db.userDao().favorites() }.any { it.trackId == ids[1] })

        context.sendBroadcast(
            Intent(WidgetActionReceiver.ACTION_TOGGLE_FAVORITE)
                .setComponent(ComponentName(context, WidgetActionReceiver::class.java)),
        )
        waitFor("unfavorited") { runBlocking { db.userDao().favorites() }.none { it.trackId == ids[1] } }
        assertTrue(!Widgets.load(context).currentIsFavorite)
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
    private fun snapshot(view: View, name: String, widthDp: Int, heightDp: Int) {
        val d = context.resources.displayMetrics.density
        val w = (widthDp * d).toInt()
        val h = (heightDp * d).toInt()
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
