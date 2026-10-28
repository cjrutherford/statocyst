package net.christopherrutherford.statocyst.media

import android.content.ComponentName
import android.content.Context
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * Instrumented gate for S018: cold-start the MediaLibraryService via a
 * MediaBrowser (no WebView/Activity) and assert a deterministic tree.
 */
@RunWith(AndroidJUnit4::class)
class MediaLibraryServiceBrowseTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = StatocystDatabase.getInstance(context)
        db.clearAllTables()
        runBlocking {
            db.mediaItemDao().upsert(entity("t1", "Eat The Elephant", "A Perfect Circle", "Eat The Elephant", trackNo = 1))
            db.mediaItemDao().upsert(entity("t2", "Cochise", "Audioslave", "Audioslave", trackNo = 1))
        }
    }

    @Test
    fun coldStartBrowsesDeterministicTree() {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val browser = MediaBrowser.Builder(context, token).buildAsync().get(10, TimeUnit.SECONDS)
        try {
            val params = MediaLibraryService.LibraryParams.Builder().build()

            val root = browser.getLibraryRoot(params).get(10, TimeUnit.SECONDS)
            assertEquals(BrowseIds.ROOT, root.value!!.mediaId)

            val categories = browser.getChildren(BrowseIds.ROOT, 0, 100, params).get(10, TimeUnit.SECONDS)
            assertEquals(
                listOf(BrowseIds.ALBUMS, BrowseIds.ARTISTS, BrowseIds.TRACKS, BrowseIds.QUEUE),
                categories.value!!.map { it.mediaId },
            )

            val albums = browser.getChildren(BrowseIds.ALBUMS, 0, 100, params).get(10, TimeUnit.SECONDS)
            assertEquals(
                listOf(
                    BrowseIds.album("Audioslave", "Audioslave"),
                    BrowseIds.album("A Perfect Circle", "Eat The Elephant"),
                ),
                albums.value!!.map { it.mediaId },
            )

            val tracks = browser.getChildren(BrowseIds.album("A Perfect Circle", "Eat The Elephant"), 0, 100, params)
                .get(10, TimeUnit.SECONDS)
            assertEquals(listOf("track::t1"), tracks.value!!.map { it.mediaId })
        } finally {
            browser.release()
        }
    }

    private fun entity(
        id: String,
        title: String,
        artist: String,
        album: String,
        trackNo: Int? = null,
    ): MediaItemEntity = MediaItemEntity(
        id = id,
        sourceId = "jellyfin",
        path = id,
        pathKey = "jellyfin:$id",
        fileName = title,
        ext = "flac",
        sizeBytes = 0,
        mtimeMs = 0,
        title = title,
        artist = artist,
        album = album,
        albumArtist = artist,
        trackNo = trackNo,
        discNo = null,
        year = null,
        genre = null,
        durationMs = 200_000,
        bitrate = null,
        sampleRate = null,
        channels = null,
        codec = null,
        format = "flac",
        artworkPath = null,
        jellyfinImageTag = null,
        sourceKind = "jellyfin",
        sourceLabel = "Jellyfin",
        addedAt = "",
        updatedAt = "",
        missing = false,
        albumId = null,
    )
}
