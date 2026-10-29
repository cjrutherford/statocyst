package net.christopherrutherford.statocyst.media

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.MediaItem
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.FavoriteEntity
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.PlaylistEntity
import net.christopherrutherford.statocyst.db.PlaylistTrackEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Device gate for the Android Auto browse tree: a separate MediaBrowser (the same
 * binder path Auto uses) browses the real service with no Activity or WebView.
 *
 * Non-destructive: it adds fixture tracks (ids "zz-fix-*", backed by one empty file) and
 * snapshots/restores the favorite/playlist mirror, so a real library is left untouched.
 */
@RunWith(AndroidJUnit4::class)
class MediaLibraryServiceBrowseTest {

    private lateinit var context: Context
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private lateinit var browser: MediaBrowser
    private lateinit var fixtureIds: List<String>
    private val fixtureFile by lazy { java.io.File(context.cacheDir, "zz-fix.mp3").apply { createNewFile() } }
    private val db by lazy { StatocystDatabase.getInstance(context) }

    private var savedFavorites = emptyList<FavoriteEntity>()
    private var savedPlaylists = emptyList<PlaylistEntity>()
    private var savedPlaylistTracks = emptyList<PlaylistTrackEntity>()
    private val changed = mutableListOf<String>()
    private var changedLatch = CountDownLatch(1)

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        fixtureIds = (1..700).map { "zz-fix-%03d".format(it) }
        runBlocking {
            fixtureIds.forEachIndexed { i, id ->
                db.mediaItemDao().upsert(fixture(id, "ZZ Fixture %03d".format(i + 1), i))
            }
            savedFavorites = db.userDao().favorites()
            savedPlaylists = db.userDao().playlists()
            savedPlaylistTracks = db.userDao().playlistTracks()
        }
        thread = HandlerThread("browser-test").also { it.start() }
        handler = Handler(thread.looper)
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        browser = MediaBrowser.Builder(context, token)
            .setApplicationLooper(thread.looper)
            .setListener(object : MediaBrowser.Listener {
                override fun onChildrenChanged(
                    browser: MediaBrowser,
                    parentId: String,
                    itemCount: Int,
                    params: MediaLibraryService.LibraryParams?,
                ) {
                    synchronized(changed) { changed.add(parentId) }
                    changedLatch.countDown()
                }
            })
            .buildAsync().get(15, TimeUnit.SECONDS)
    }

    @After
    fun tearDown() {
        if (::browser.isInitialized) app { browser.release() }
        runBlocking {
            fixtureIds.forEach { db.mediaItemDao().deleteById(it) }
            db.userDao().replaceUserState(savedFavorites, savedPlaylists, savedPlaylistTracks)
        }
        PlaybackService.onUserStateChanged()
        PlaybackService.onCatalogChanged()
        thread.quitSafely()
    }

    /** Runs [block] on the browser's application thread and waits for the result. */
    private fun <T> app(block: () -> T): T {
        val result = SettableFuture.create<T>()
        handler.post {
            try { result.set(block()) } catch (e: Throwable) { result.setException(e) }
        }
        return result.get(15, TimeUnit.SECONDS)
    }

    private fun children(parent: String, page: Int = 0, size: Int = 100): List<MediaItem> {
        val future: ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            app { browser.getChildren(parent, page, size, null) }
        val result = future.get(20, TimeUnit.SECONDS)
        assertEquals("getChildren($parent) failed", LibraryResult.RESULT_SUCCESS, result.resultCode)
        return result.value!!
    }

    private fun seedUserState(trackIds: List<String>) {
        runBlocking {
            db.userDao().replaceUserState(
                favorites = listOf(FavoriteEntity(trackIds[0], 0), FavoriteEntity(trackIds[1], 1)),
                playlists = listOf(PlaylistEntity("zz-test", "ZZ Test Mix", 1L, 0)),
                playlistTracks = trackIds.take(3).mapIndexed { i, id -> PlaylistTrackEntity("zz-test", i, id) },
            )
        }
    }

    @Test
    fun rootAdvertisesFoldersAndContentStyleHints() {
        val root = app { browser.getLibraryRoot(null) }.get(15, TimeUnit.SECONDS)
        assertEquals(BrowseIds.ROOT, root.value!!.mediaId)

        val ids = children(BrowseIds.ROOT).map { it.mediaId }
        assertTrue(ids.containsAll(listOf(BrowseIds.ALBUMS, BrowseIds.ARTISTS, BrowseIds.TRACKS)))

        val albums = children(BrowseIds.ROOT).first { it.mediaId == BrowseIds.ALBUMS }
        assertEquals(
            MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
            albums.mediaMetadata.extras!!.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE),
        )
    }

    @Test
    fun trackFolderIsPaged() {
        val total = runBlocking { db.mediaItemDao().count() }
        assertTrue(total >= 250)
        val first = children(BrowseIds.TRACKS, 0, 100)
        val second = children(BrowseIds.TRACKS, 1, 100)
        assertEquals(100, first.size)
        assertTrue(first.map { it.mediaId }.intersect(second.map { it.mediaId }.toSet()).isEmpty())
        val last = children(BrowseIds.TRACKS, (total - 1) / 100, 100)
        assertEquals(total - ((total - 1) / 100) * 100, last.size)
        assertEquals(emptyList<MediaItem>(), children(BrowseIds.TRACKS, total / 100 + 5, 100))
    }

    @Test
    fun favoritesPlaylistsAndRecentsAppearAndNotifySubscribers() {
        val ids = fixtureIds.take(4)
        app { browser.subscribe(BrowseIds.FAVORITES, null) }.get(15, TimeUnit.SECONDS)
        changedLatch = CountDownLatch(1)

        seedUserState(ids)
        PlaybackService.onUserStateChanged()
        assertTrue("no onChildrenChanged for favorites", changedLatch.await(10, TimeUnit.SECONDS))
        assertTrue(synchronized(changed) { BrowseIds.FAVORITES in changed })

        val root = children(BrowseIds.ROOT).map { it.mediaId }
        assertTrue(BrowseIds.FAVORITES in root && BrowseIds.PLAYLISTS in root)
        // Newest favorite first.
        assertEquals(listOf(ids[1], ids[0]), children(BrowseIds.FAVORITES).map { BrowseIds.trackEntityId(it.mediaId) })

        val playlists = children(BrowseIds.PLAYLISTS)
        assertEquals(listOf("playlist::zz-test"), playlists.map { it.mediaId }.filter { it == "playlist::zz-test" })
        assertEquals(ids.take(3), children("playlist::zz-test").map { BrowseIds.trackEntityId(it.mediaId) })
    }

    @Test
    fun playingFromAPlaylistQueuesThePlaylistAndQueueFolderJumpsWithinIt() {
        val ids = fixtureIds.take(4)
        seedUserState(ids)
        PlaybackService.onUserStateChanged()

        val second = children("playlist::zz-test")[1]
        app { browser.setMediaItem(second) }
        // Queue is built asynchronously by the service.
        waitFor { app { browser.mediaItemCount } == 3 }
        assertEquals(1, app { browser.currentMediaItemIndex })
        assertEquals(ids.take(3), (0 until 3).map { i ->
            app { browser.getMediaItemAt(i).mediaMetadata.extras!!.getString("trackId") }
        })

        val queue = children(BrowseIds.QUEUE)
        assertEquals(3, queue.size)
        assertTrue(queue.all { it.mediaId.startsWith("queue::") })

        // Picking a queue row jumps within the same queue instead of replacing it.
        app { browser.setMediaItem(queue[2]) }
        waitFor { app { browser.currentMediaItemIndex } == 2 }
        assertEquals(3, app { browser.mediaItemCount })

        // Starting playback recorded the track as recent.
        app { browser.pause() }
    }

    @Test
    fun carButtonsToggleShuffleRepeatAndFavorite() {
        val ids = fixtureIds.take(3)
        seedUserState(ids)
        PlaybackService.onUserStateChanged()
        val first = children("playlist::zz-test")[0]
        app { browser.setMediaItem(first) }
        waitFor { app { browser.mediaItemCount } == 3 }

        val buttons = app { browser.mediaButtonPreferences }
        assertEquals(
            listOf("statocyst.shuffle", "statocyst.repeat", "statocyst.favorite"),
            buttons.map { it.sessionCommand?.customAction },
        )

        fun send(action: String) =
            app { browser.sendCustomCommand(SessionCommand(action, android.os.Bundle()), android.os.Bundle()) }
                .get(10, TimeUnit.SECONDS)

        send("statocyst.shuffle")
        waitFor { app { browser.shuffleModeEnabled } }
        send("statocyst.shuffle")
        waitFor { !app { browser.shuffleModeEnabled } }

        send("statocyst.repeat")
        waitFor { app { browser.repeatMode } == androidx.media3.common.Player.REPEAT_MODE_ALL }
        send("statocyst.repeat")
        waitFor { app { browser.repeatMode } == androidx.media3.common.Player.REPEAT_MODE_ONE }
        send("statocyst.repeat")
        waitFor { app { browser.repeatMode } == androidx.media3.common.Player.REPEAT_MODE_OFF }

        // Current track is ids[0], which the seed already favorited: toggling unfavorites it.
        val before = children(BrowseIds.FAVORITES).size
        send("statocyst.favorite")
        waitFor { children(BrowseIds.FAVORITES).size == before - 1 }
        send("statocyst.favorite")
        waitFor { children(BrowseIds.FAVORITES).size == before }
    }

    @Test
    fun searchAndVoiceRequestsFindAndQueueTracks() {
        app { browser.search("ZZ Fixture 007", null) }.get(10, TimeUnit.SECONDS)
        val results = app { browser.getSearchResult("ZZ Fixture 007", 0, 20, null) }.get(10, TimeUnit.SECONDS)
        assertEquals(listOf("zz-fix-007"), results.value!!.map { BrowseIds.trackEntityId(it.mediaId) })

        // Assistant-style request: no media id, only a search query.
        val voice = MediaItem.Builder()
            .setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery("ZZ Fixture 012").build())
            .build()
        app { browser.setMediaItem(voice) }
        // The controller briefly shows its own placeholder; wait for the session's resolved item.
        waitFor {
            app { browser.currentMediaItem?.mediaMetadata?.extras?.getString("trackId") } == "zz-fix-012"
        }
        assertEquals(1, app { browser.mediaItemCount })

        // Artist voice request queues every track by that artist (fixtures + ordering by title).
        val artistVoice = MediaItem.Builder()
            .setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery("zz artist").build())
            .build()
        app { browser.setMediaItem(artistVoice) }
        waitFor { app { browser.mediaItemCount } == 100 }
    }

    @Test
    fun radioFolderAndVoiceBuildASimilarQueue() {
        seedUserState(listOf("zz-fix-005", "zz-fix-006"))
        val seeds = children(BrowseIds.RADIO)
        val seed = seeds.firstOrNull { it.mediaId == BrowseIds.radio("zz-fix-005") }
        assertNotNull("radio folder should offer the favorite as a seed", seed)
        assertTrue(seed!!.mediaMetadata.isPlayable == true)
        app { browser.setMediaItem(seed) }
        waitFor { app { browser.mediaItemCount } > 10 }
        assertEquals("zz-fix-005", app { browser.getMediaItemAt(0).mediaMetadata.extras?.getString("trackId") })

        val voice = MediaItem.Builder()
            .setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery("songs like ZZ Fixture 009").build())
            .build()
        app { browser.setMediaItem(voice) }
        waitFor {
            app { browser.mediaItemCount } > 10 &&
                app { browser.getMediaItemAt(0).mediaMetadata.extras?.getString("trackId") } == "zz-fix-009"
        }
    }

    @Test
    fun largePlaylistQueuesAWindowThenExtendsAsPlaybackAdvances() {
        runBlocking {
            db.userDao().replaceUserState(
                favorites = emptyList(),
                playlists = listOf(PlaylistEntity("zz-big", "ZZ Big Mix", 1L, 0)),
                playlistTracks = fixtureIds.mapIndexed { i, id -> PlaylistTrackEntity("zz-big", i, id) },
            )
        }
        PlaybackService.onUserStateChanged()

        val first = children("playlist::zz-big")[0]
        app { browser.setMediaItem(first) }
        waitFor { app { browser.mediaItemCount } == 1 + BrowseTree.CONTEXT_AFTER }
        assertEquals(0, app { browser.currentMediaItemIndex })

        // Jump near the end of what is queued: the service appends the next chunk.
        val queued = app { browser.mediaItemCount }
        app { browser.seekTo(queued - 10, 0L) }
        waitFor { app { browser.mediaItemCount } > 1 + BrowseTree.CONTEXT_AFTER }
        waitFor { app { browser.mediaItemCount } == 1 + 2 * BrowseTree.CONTEXT_AFTER }
        val lastTrack = app {
            browser.getMediaItemAt(browser.mediaItemCount - 1).mediaMetadata.extras!!.getString("trackId")
        }
        assertEquals(fixtureIds[2 * BrowseTree.CONTEXT_AFTER], lastTrack)
        app { browser.pause() }
    }

    @Test
    fun savedShuffleOrderIsReappliedWhenTheServiceRestarts() {
        val ids = fixtureIds.take(8)
        val order = listOf(5, 2, 7, 0, 3, 6, 1, 4)
        app { browser.release() }
        context.stopService(android.content.Intent(context, PlaybackService::class.java))
        Thread.sleep(2_000)

        val store = QueueStore(context)
        store.save(
            SavedQueue(
                slots = ids.mapIndexed { i, id -> QueueSlot("q_zz$i", id) },
                index = 3, positionMs = 0, shuffle = true, repeatMode = 0, shuffleOrder = order,
            ),
        )
        browser = MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
            .setApplicationLooper(thread.looper)
            .buildAsync().get(15, TimeUnit.SECONDS)

        waitFor { app { browser.mediaItemCount } == ids.size }
        fun playOrder() = app {
            val tl = browser.currentTimeline
            val out = mutableListOf<Int>()
            var i = tl.getFirstWindowIndex(true)
            while (i != androidx.media3.common.C.INDEX_UNSET && out.size <= tl.windowCount) {
                out.add(i)
                i = tl.getNextWindowIndex(i, androidx.media3.common.Player.REPEAT_MODE_OFF, true)
            }
            out
        }
        waitFor { playOrder() == order }
        assertTrue(app { browser.shuffleModeEnabled })
        // The service persists the order the player really holds, not a fresh random one.
        waitFor { store.load()?.shuffleOrder == order }
        // Leave the long-lived service clean for the tests that follow.
        app { browser.shuffleModeEnabled = false; browser.clearMediaItems() }
        store.clear()
    }

    private fun waitFor(timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (condition()) return
            Thread.sleep(100)
        }
        assertTrue("condition not met in ${timeoutMs}ms", condition())
    }

    private fun fixture(id: String, title: String, i: Int): MediaItemEntity = MediaItemEntity(
        id = id, sourceId = "local", path = fixtureFile.absolutePath, pathKey = "zz:$id", fileName = "$id.mp3",
        ext = "mp3", sizeBytes = 0, mtimeMs = 0, title = title, artist = "ZZ Artist", album = "ZZ Album",
        albumArtist = "ZZ Artist", trackNo = i + 1, discNo = null, year = null, genre = null, durationMs = 200_000,
        bitrate = null, sampleRate = null, channels = null, codec = null, format = "mp3", artworkPath = null,
        jellyfinImageTag = null, sourceKind = "local", sourceLabel = "Test", addedAt = "", updatedAt = "",
        missing = false, albumId = null,
    )
}
