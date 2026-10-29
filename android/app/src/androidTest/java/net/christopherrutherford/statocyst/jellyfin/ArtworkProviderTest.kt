package net.christopherrutherford.statocyst.jellyfin

import android.content.Context
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException

class ArtworkProviderTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val server = "https://jf.invalid"
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8)
    private var savedSessions: List<JellyfinSession> = emptyList()
    private val cached = mutableListOf<File>()

    @Before
    fun setUp() {
        savedSessions = JellyfinSessions.all(context)
        JellyfinSessions.clear(context)
        JellyfinSessions.save(context, JellyfinSession("test-server", server, "user", "tok"))
    }

    @After
    fun tearDown() {
        JellyfinSessions.clear(context)
        savedSessions.forEach { JellyfinSessions.save(context, it) }
        cached.forEach { it.delete() }
    }

    @Test
    fun servesACachedImageThroughATokenFreeContentUri() {
        val u = ArtworkProvider.uri(context, "zz-album-1", "tag1")!!
        assertTrue(u, u.startsWith("content://${context.packageName}.artwork/art/zz-album-1"))
        assertTrue(u, !u.contains("tok") && !u.contains("api_key"))

        val dir = File(context.cacheDir, "jf-art").also { it.mkdirs() }
        File(dir, JellyfinArtwork.cacheKey(server, "zz-album-1", "tag1", 300))
            .also { it.writeBytes(png); cached.add(it) }

        assertEquals("image/png", context.contentResolver.getType(Uri.parse(u)))
        val bytes = context.contentResolver.openFileDescriptor(Uri.parse(u), "r")!!.use {
            FileInputStream(it.fileDescriptor).readBytes()
        }
        assertArrayEquals(png, bytes)
    }

    @Test
    fun refusesWritesBadIdsAndImagesItCannotGet() {
        assertNull(ArtworkProvider.uri(context, "../secret", null))
        val bad = Uri.parse("content://${context.packageName}.artwork/art/..%2Fsecret")
        try {
            context.contentResolver.openFileDescriptor(bad, "r")
            fail("expected FileNotFoundException")
        } catch (_: FileNotFoundException) {
        }
        val good = Uri.parse(ArtworkProvider.uri(context, "zz-album-1", "tag1")!!)
        try {
            context.contentResolver.openFileDescriptor(good, "w")
            fail("expected FileNotFoundException")
        } catch (_: FileNotFoundException) {
        }
    }
}
