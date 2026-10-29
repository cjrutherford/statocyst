package net.christopherrutherford.statocyst.jellyfin

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class JellyfinArtworkTest {
    private lateinit var server: FakeHttpServer
    private lateinit var dir: File
    private var status = 200
    private var body = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)

    private val url get() = server.url
    private val hits get() = server.requests.size

    @Before
    fun setUp() {
        dir = Files.createTempDirectory("jf-art").toFile()
        server = FakeHttpServer { FakeHttpServer.Response(status, "image/jpeg", if (status == 200) body else ByteArray(0)) }
    }

    @After
    fun tearDown() {
        server.close()
        dir.deleteRecursively()
    }

    @Test
    fun downloadsWithTheAuthorizationHeaderAndNeverPutsTheTokenInTheUrl() {
        val file = JellyfinArtwork.download(url, "s3cret", "alb-1", "tag1", 300, dir)
        assertNotNull(file)
        assertEquals(body.size.toLong(), file!!.length())
        assertTrue(server.requests.single().headers["authorization"]!!.contains("Token=\"s3cret\""))
        assertFalse(server.requests.single().query!!.contains("s3cret"))
        assertFalse(server.requests.single().query!!.contains("api_key", true))
        assertEquals("maxHeight=300&tag=tag1", server.requests.single().query)
    }

    @Test
    fun secondRequestIsServedFromDiskCache() {
        val first = JellyfinArtwork.download(url, "t", "alb-1", "tag1", 300, dir)
        val second = JellyfinArtwork.download(url, "t", "alb-1", "tag1", 300, dir)
        assertEquals(first, second)
        assertEquals(1, hits)
        JellyfinArtwork.download(url, "t", "alb-1", "tag2", 300, dir)
        assertEquals(2, hits)
    }

    @Test
    fun failuresAndNonImagesAreNotCached() {
        status = 401
        assertNull(JellyfinArtwork.download(url, "bad", "alb-1", "", 300, dir))
        status = 200
        body = "<html>login</html>".toByteArray()
        assertNull(JellyfinArtwork.download(url, "t", "alb-2", "", 300, dir))
        assertEquals(0, dir.listFiles()!!.size)
    }

    @Test
    fun rejectsIdsAndTagsThatCouldEscapeTheRequest() {
        assertNull(JellyfinArtwork.download(url, "t", "../etc/passwd", "", 300, dir))
        assertNull(JellyfinArtwork.download(url, "t", "a b", "", 300, dir))
        assertNull(JellyfinArtwork.download(url, "t", "alb", "x&api_key=1", 300, dir))
        assertEquals(0, hits)
    }

    @Test
    fun sniffsCommonImageTypes() {
        assertEquals("image/png", JellyfinArtwork.sniffMime(byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10, 0, 0, 0, 0)))
        assertEquals("image/webp", JellyfinArtwork.sniffMime("RIFF....WEBPVP8 ".toByteArray()))
        assertNull(JellyfinArtwork.sniffMime("hello".toByteArray()))
    }
}
