package net.christopherrutherford.statocyst.media

import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.RecentEntity
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.Instant

class CarRecommenderTest {
    @Test
    fun matchesTheSharedGoldenFixture() {
        val root = JSONObject(fixtureFile().readText())
        val tracks = root.getJSONArray("tracks").mapObjects(::entity)
        val favorites = root.getJSONArray("favorites").toStringList().toSet()
        val recent = root.getJSONArray("recent").mapObjects { obj ->
            RecentEntity(
                trackId = obj.getString("trackId"),
                playedAt = Instant.parse(obj.getString("playedAt")).toEpochMilli(),
                playCount = obj.optInt("playCount", 0),
            )
        }
        val now = Instant.parse(root.getString("now")).toEpochMilli()

        val actual = CarRecommender.build(tracks, favorites, recent, now)
        val expected = root.getJSONObject("expected")

        assertEquals(expected.getString("generatedAt"), actual.generatedAt)
        val expectedMixes = expected.getJSONArray("mixes")
        assertEquals(expectedMixes.length(), actual.mixes.size)
        for (index in 0 until expectedMixes.length()) {
            val expectedMix = expectedMixes.getJSONObject(index)
            val actualMix = actual.mixes[index]
            assertEquals(expectedMix.getString("id"), actualMix.id)
            assertEquals(expectedMix.getString("title"), actualMix.title)
            assertEquals(expectedMix.getString("subtitle"), actualMix.subtitle)
            assertEquals(
                expectedMix.getJSONArray("trackIds").toStringList(),
                actualMix.trackIds,
            )
            val reasons = expectedMix.getJSONObject("reasons")
            for (key in reasons.keys()) {
                assertEquals(reasons.getString(key), actualMix.reasons[key])
            }
        }
    }

    private fun fixtureFile(): File {
        var directory = File(System.getProperty("user.dir") ?: ".")
        while (true) {
            val candidate = File(
                directory,
                "libs/recommendation/fixtures/car-recommendation-golden.json",
            )
            if (candidate.isFile) return candidate
            directory = directory.parentFile
                ?: error("Could not find libs/recommendation/fixtures/car-recommendation-golden.json")
        }
    }

    private fun entity(obj: JSONObject): MediaItemEntity = MediaItemEntity(
        id = obj.getString("id"),
        sourceId = "local",
        path = obj.getString("id"),
        pathKey = "test:${obj.getString("id")}",
        fileName = "${obj.getString("id")}.flac",
        ext = "flac",
        sizeBytes = 0,
        mtimeMs = 0,
        title = obj.getString("title"),
        artist = obj.getString("artist"),
        album = obj.getString("album"),
        albumArtist = if (obj.isNull("albumArtist")) null else obj.getString("albumArtist"),
        trackNo = null,
        discNo = null,
        year = obj.optInt("year").takeIf { it > 0 },
        genre = if (obj.isNull("genre")) null else obj.getString("genre"),
        durationMs = 200_000,
        bitrate = null,
        sampleRate = null,
        channels = null,
        codec = null,
        format = "flac",
        artworkPath = null,
        jellyfinImageTag = null,
        sourceKind = "local",
        sourceLabel = "Local",
        addedAt = "",
        updatedAt = "",
        missing = obj.optBoolean("missing", false),
        albumId = null,
    )

    private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
        (0 until length()).map { transform(getJSONObject(it)) }

    private fun JSONArray.toStringList(): List<String> =
        (0 until length()).map { getString(it) }
}
