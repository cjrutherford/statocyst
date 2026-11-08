package net.christopherrutherford.statocyst.podcast

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PodcastRepositoryTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "statocyst-podcast-repository-test.db"
    private val db = Room.databaseBuilder(context, StatocystDatabase::class.java, name)
        .allowMainThreadQueries()
        .build()
    private val repository = PodcastRepository(db)

    @After
    fun tearDown() {
        db.close()
        context.deleteDatabase(name)
    }

    @Test
    fun savesEpisodesAsPodcastMediaAndPreservesPlayedState() = runBlocking {
        val feed = JSONObject()
            .put("feedUrl", "https://feeds.example.com/show.xml")
            .put("title", "Native Show")
            .put("author", "Host")
            .put("feedType", "rss")
        val episodes = JSONArray().put(
            JSONObject()
                .put("guid", "ep-1")
                .put("pathKey", "podcast:test:ep-1")
                .put("title", "Native Episode")
                .put("enclosureUrl", "https://cdn.example.com/1.mp3")
                .put("enclosureType", "audio/mpeg")
                .put("enclosureLengthBytes", 1234)
                .put("durationMs", 60_000)
                .put("publishedAt", "2026-10-01T08:00:00.000Z")
                .put("seasonNo", 1)
                .put("episodeNo", 2),
        )
        val saved = repository.saveFeed(feed, episodes)
        assertEquals("Native Show", saved.feed.title)
        assertEquals(1, saved.unplayed)

        val records = repository.listEpisodes(saved.feed.id)
        assertEquals(1, records.size)
        val record = records.single()
        assertEquals("podcast", record.media.mediaKind)
        assertEquals("Native Show", record.feedTitle)
        assertEquals("Native Episode", record.media.title)
        assertEquals(60_000, record.media.durationMs)
        assertNotNull(db.mediaItemDao().getById(record.media.id))

        val played = repository.setPlayed(record.episode.id, true)
        assertNotNull(played)
        assertTrue(played!!.episode.played)
        assertTrue(played.episode.completed)

        val updated = repository.updateFeed(
            saved.feed.id,
            JSONObject().put("defaultSpeed", 1.5).put("episodeSort", "oldest"),
        )
        assertEquals(1.5, updated!!.feed.defaultSpeed, 0.001)
        assertEquals("oldest", updated.feed.episodeSort)

        assertTrue(repository.removeFeed(saved.feed.id))
        assertNull(db.mediaItemDao().getById(record.media.id))
        assertTrue(repository.listFeeds().isEmpty())
    }

    @Test
    fun storesPodcastIndexCredentialsEncrypted() {
        val store = PodcastCredentialsStore(context)
        store.clear()
        assertFalse(store.configured())
        store.save("key-1", "secret-1")
        assertTrue(store.configured())
        val loaded = store.load()
        assertEquals("key-1", loaded?.first)
        assertEquals("secret-1", loaded?.second)
        store.clear()
        assertFalse(store.configured())
    }
}
