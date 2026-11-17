package net.christopherrutherford.statocyst.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class CarRecommendationsTest {
    @Test
    fun parsesVersionedMixesAndReasons() {
        val mixes = CarRecommendations.parse(
            """
            {
              "version": 1,
              "generatedAt": "2026-11-16T12:00:00.000Z",
              "mixes": [
                {
                  "id": "daily-drift",
                  "title": "Daily drift",
                  "subtitle": "Favorites + today's plays",
                  "trackIds": ["t1", "t2", "t1"],
                  "reasons": {"t1": "More from your top artists"}
                }
              ]
            }
            """.trimIndent(),
        )
        assertEquals(1, mixes.size)
        assertEquals("daily-drift", mixes[0].id)
        assertEquals("Daily drift", mixes[0].title)
        assertEquals(listOf("t1", "t2"), mixes[0].trackIds)
        assertEquals("More from your top artists", mixes[0].reasons["t1"])
    }

    @Test
    fun distinguishesFreshAndStaleSnapshots() {
        val json = """
            {
              "version": 1,
              "generatedAt": "2026-11-16T12:00:00Z",
              "mixes": [
                {"id":"daily","title":"Daily","subtitle":"","trackIds":["t1"],"reasons":{}}
              ]
            }
        """.trimIndent()
        val snapshot = CarRecommendations.parseSnapshot(json)
        val generated = Instant.parse("2026-11-16T12:00:00Z").toEpochMilli()

        assertEquals("2026-11-16T12:00:00Z", snapshot.generatedAt)
        assertFalse(CarRecommendations.isStale(snapshot, nowMs = generated + 60_000))
        assertTrue(
            CarRecommendations.isStale(
                snapshot,
                nowMs = generated + CarRecommendations.STALE_AFTER_MS + 1,
            ),
        )
        assertTrue(CarRecommendations.isStale(CarRecommendations.parseSnapshot(null)))
    }

    @Test
    fun rejectsWrongVersionsAndEmptyMixes() {
        assertTrue(CarRecommendations.parse(null).isEmpty())
        assertTrue(CarRecommendations.parse("not json").isEmpty())
        assertTrue(
            CarRecommendations.parse(
                """{"version":2,"mixes":[{"id":"x","trackIds":["t1"]}]}""",
            ).isEmpty(),
        )
        assertTrue(
            CarRecommendations.parse(
                """{"version":1,"mixes":[{"id":"empty","trackIds":[]}]}""",
            ).isEmpty(),
        )
    }
}
