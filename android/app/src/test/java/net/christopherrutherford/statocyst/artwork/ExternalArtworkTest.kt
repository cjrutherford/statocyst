package net.christopherrutherford.statocyst.artwork

import net.christopherrutherford.statocyst.jellyfin.FakeHttpServer
import net.christopherrutherford.statocyst.jellyfin.FakeHttpServer.Response
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ExternalArtworkTest {
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9, 9, 9, 9, 9, 9)
    private val jpg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)

    private lateinit var dir: File
    private var clock = 1_000_000L
    private var releaseGroupScore = 100
    private var artistName = "Driftwood"
    private var coverBody: ByteArray = png
    private var mbStatus = 200
    private var imageHost = ""

    private lateinit var server: FakeHttpServer

    private fun handle(r: FakeHttpServer.Request): Response {
        val p = r.path
        return when {
            mbStatus != 200 && p.startsWith("/mb/") -> Response(mbStatus)
            p == "/mb/release-group/" -> json("""{"release-groups":[{"id":"rg1","score":$releaseGroupScore}]}""")
            p == "/mb/artist/" -> json("""{"artists":[{"id":"ar1","name":"$artistName","score":100}]}""")
            p == "/mb/artist/ar1" -> json(
                """{"relations":[{"type":"official homepage","url":{"resource":"https://x.example"}},""" +
                    """{"type":"wikidata","url":{"resource":"https://www.wikidata.org/wiki/Q42"}}]}""",
            )
            p == "/wd/w/api.php" -> json(
                """{"claims":{"P18":[{"mainsnak":{"datavalue":{"value":"Drift wood.jpg"}}}]}}""",
            )
            p == "/commons/wiki/Special:FilePath/Drift_wood.jpg" ->
                Response(302, headers = mapOf("Location" to "${server.url}/img/drift.jpg"))
            p == "/img/drift.jpg" -> Response(200, "image/jpeg", jpg)
            p == "/caa/release-group/rg1/front-250" ->
                Response(307, headers = mapOf("Location" to "${server.url}/img/cover.png"))
            p == "/img/cover.png" -> Response(200, "image/png", coverBody)
            else -> Response(404)
        }
    }

    private fun json(s: String) = Response(200, "application/json", s.toByteArray())

    private fun art(): ExternalArtwork {
        val endpoints = Endpoints(
            musicBrainz = server.url + "/mb", coverArt = server.url + "/caa",
            wikidata = server.url + "/wd", commons = server.url + "/commons",
            isAllowedImageUrl = { it.startsWith(server.url) && !it.contains(imageHost.ifEmpty { "\u0000" }) },
            retryDelayMs = 0,
        )
        return ExternalArtwork(dir, MusicBrainzClient("Statocyst/test", endpoints, RateGate(0)), { clock })
    }

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("ext-art").toFile()
        server = FakeHttpServer(::handle)
    }

    @After
    fun tearDown() {
        server.close()
        dir.deleteRecursively()
    }

    @Test
    fun findsACoverFollowsTheRedirectAndCachesIt() {
        val a = art()
        val file = a.cover("Driftwood", "High Tide")
        assertNotNull(file)
        assertArrayEquals(png, file!!.readBytes())
        val sent = server.requests.size
        assertEquals("Statocyst/test", server.requests.first().headers["user-agent"])

        assertEquals(file, art().cover("  driftwood ", "HIGH   tide"))
        assertEquals("cache hit makes no requests", sent, server.requests.size)
    }

    @Test
    fun aLowScoreIsAMissRememberedForAWeek() {
        releaseGroupScore = 40
        assertNull(art().cover("Driftwood", "High Tide"))
        val sent = server.requests.size
        assertNull(art().cover("Driftwood", "High Tide"))
        assertEquals(sent, server.requests.size)

        clock += ExternalArtwork.MISS_TTL_MS + 1
        releaseGroupScore = 100
        assertNotNull(art().cover("Driftwood", "High Tide"))
    }

    @Test
    fun aServiceErrorIsRetriedAfterFifteenMinutesNotAWeek() {
        mbStatus = 503
        assertNull(art().cover("Driftwood", "High Tide"))
        val sent = server.requests.size
        assertNull(art().cover("Driftwood", "High Tide"))
        assertEquals("backoff suppresses the retry", sent, server.requests.size)

        clock += ExternalArtwork.RETRY_TTL_MS + 1
        mbStatus = 200
        assertNotNull(art().cover("Driftwood", "High Tide"))
    }

    @Test
    fun aBriefServiceErrorIsRetriedWithinTheLookup() {
        mbStatus = 503
        val before = server.requests.size
        assertNull(art().cover("Driftwood", "High Tide"))
        assertEquals("three attempts before giving up", 3, server.requests.size - before)
    }

    @Test
    fun bytesThatAreNotAnImageAreRejected() {
        coverBody = "<html>nope</html>".toByteArray()
        assertNull(art().cover("Driftwood", "High Tide"))
        assertTrue(dir.listFiles()!!.none { it.length() > 0 && !it.name.endsWith(".miss") })
    }

    @Test
    fun anImageRedirectToADisallowedHostIsNotFetched() {
        imageHost = "/img/"
        assertNull(art().cover("Driftwood", "High Tide"))
        assertTrue(server.requests.none { it.path == "/img/cover.png" })
    }

    @Test
    fun artistPhotoComesFromWikidataThroughCommons() {
        val file = art().artist("Driftwood")
        assertNotNull(file)
        assertArrayEquals(jpg, file!!.readBytes())
        assertTrue(server.requests.any { it.path == "/commons/wiki/Special:FilePath/Drift_wood.jpg" })
    }

    @Test
    fun anArtistSearchHitWithADifferentNameIsNotUsed() {
        artistName = "Driftwood Revival"
        assertNull(art().artist("Driftwood"))
    }

    @Test
    fun placeholderAndBlankNamesAreNeverLookedUp() {
        val a = art()
        assertNull(a.cover("Unknown artist", "High Tide"))
        assertNull(a.cover("Driftwood", "Unknown album"))
        assertNull(a.artist("  "))
        assertNull(a.artist("x".repeat(201)))
        assertEquals(0, server.requests.size)
    }

    @Test
    fun cacheKeysIgnoreCaseAndWhitespace() {
        assertEquals(ExternalArtwork.key("cover", "A  B", "c"), ExternalArtwork.key("cover", " a b ", "C"))
        assertTrue(ExternalArtwork.key("cover", "a", "b") != ExternalArtwork.key("artist", "a", "b"))
    }
}
