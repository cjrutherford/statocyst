package net.christopherrutherford.statocyst.radio

import net.christopherrutherford.statocyst.db.MediaItemEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RadioScorerTest {
    private fun t(
        id: String,
        artist: String,
        album: String = "x$id",
        genre: String? = null,
        year: Int? = null,
        missing: Boolean = false,
    ) = MediaItemEntity(
        id = id, sourceId = "local", path = id, pathKey = id, fileName = id, ext = "mp3", sizeBytes = 0, mtimeMs = 0,
        title = "T$id", artist = artist, album = album, albumArtist = artist, trackNo = null, discNo = null,
        year = year, genre = genre, durationMs = 1000, bitrate = null, sampleRate = null, channels = null,
        codec = null, format = null, artworkPath = null, jellyfinImageTag = null, sourceKind = "local",
        sourceLabel = "Local", addedAt = "", updatedAt = "", missing = missing, albumId = null,
    )

    @Test
    fun similarGenreAndArtistRankAboveStrangers() {
        val seed = t("seed", "Tool", genre = "Metal", year = 2001)
        val lib = listOf(
            seed,
            t("same-artist", "Tool", genre = "Metal", year = 2006),
            t("same-genre", "Mastodon", genre = "Metal, Prog", year = 2009),
            t("other", "Abba", genre = "Pop", year = 1976),
        )
        val ids = RadioScorer.build(seed, lib)
        assertEquals(listOf("same-artist", "same-genre", "other"), ids)
        assertFalse("seed" in ids)
    }

    @Test
    fun missingAndExcludedTracksAreSkippedAndLimitApplies() {
        val seed = t("s", "A", genre = "Rock")
        val lib = listOf(seed) + (1..10).map { t("c$it", "B$it", genre = "Rock") } + t("gone", "A", missing = true)
        val ids = RadioScorer.build(seed, lib, limit = 4, exclude = setOf("c1"))
        assertEquals(4, ids.size)
        assertFalse("gone" in ids || "c1" in ids)
    }

    @Test
    fun anUntaggedLibraryStillYieldsARadio() {
        val seed = t("s", "")
        val lib = listOf(seed) + (1..5).map { t("c$it", "Artist$it") }
        assertEquals(5, RadioScorer.build(seed, lib).size)
    }

    @Test
    fun oneArtistDoesNotFillThreeSlotsInARowWhenOthersExist() {
        val seed = t("s", "Tool", genre = "Metal")
        val lib = listOf(seed) + (1..5).map { t("a$it", "Tool", genre = "Metal") } + (1..3).map { t("b$it", "Mastodon", genre = "Metal") }
        val artists = RadioScorer.build(seed, lib).map { id -> lib.first { it.id == id }.artist }
        for (i in 0..artists.size - 3) {
            assertFalse(artists[i] == artists[i + 1] && artists[i + 1] == artists[i + 2] && lib.count { it.artist != artists[i] } > 0 && i < 6)
        }
    }

    @Test
    fun resultIsDeterministic() {
        val seed = t("s", "A", genre = "Rock")
        val lib = listOf(seed) + (1..20).map { t("c$it", "B$it", genre = "Rock") }
        assertEquals(RadioScorer.build(seed, lib), RadioScorer.build(seed, lib))
    }

    @Test
    fun voicePhrasesNameTheSeed() {
        assertEquals("Cochise", RadioScorer.seedQueryOf("songs like Cochise"))
        assertEquals("Cochise", RadioScorer.seedQueryOf("play music similar to Cochise"))
        assertEquals("Audioslave", RadioScorer.seedQueryOf("Audioslave radio"))
        assertEquals("Cochise", RadioScorer.seedQueryOf("start radio for Cochise"))
        assertNull(RadioScorer.seedQueryOf("Cochise"))
        assertNull(RadioScorer.seedQueryOf("play radio"))
    }

    @Test
    fun hugeLibraryByOneArtistStaysFastAndRespectsTheLimit() {
        val seed = t("seed", "Solo", genre = "Rock")
        val lib = listOf(seed) + (1..20_000).map { t("s$it", "Solo", genre = "Rock") } +
            (1..30).map { t("o$it", "Other$it", genre = "Rock") }
        val started = System.nanoTime()
        val ids = RadioScorer.build(seed, lib, limit = 50)
        val ms = (System.nanoTime() - started) / 1_000_000
        assertEquals(50, ids.size)
        assertEquals(50, ids.toSet().size)
        assertTrue("took ${ms}ms", ms < 5_000)
        // Never more than two of the same artist back to back while others remain.
        val byId = lib.associateBy { it.id }
        ids.take(30).windowed(3).forEach { w -> assertTrue(w.map { byId[it]!!.artist }.toSet().size > 1) }
    }
}
