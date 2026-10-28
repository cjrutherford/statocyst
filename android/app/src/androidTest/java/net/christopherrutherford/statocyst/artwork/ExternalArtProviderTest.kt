package net.christopherrutherford.statocyst.artwork

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

class ExternalArtProviderTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 4, 3, 2, 1, 4, 3, 2, 1)
    private val seeded = mutableListOf<File>()
    private var wasEnabled = false

    @Before
    fun setUp() {
        wasEnabled = ExternalArt.enabled(context)
    }

    @After
    fun tearDown() {
        ExternalArt.setEnabled(context, wasEnabled)
        seeded.forEach { it.delete() }
    }

    private fun seedCover(artist: String, album: String) {
        val dir = File(context.cacheDir, "ext-art").also { it.mkdirs() }
        File(dir, ExternalArtwork.key("cover", artist, album)).also { it.writeBytes(png); seeded.add(it) }
    }

    private fun read(uri: String): ByteArray =
        context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")!!.use { FileInputStream(it.fileDescriptor).readBytes() }

    @Test
    fun noUrisAreIssuedWhileTheSettingIsOff() {
        ExternalArt.setEnabled(context, false)
        assertNull(ExternalArt.coverUri(context, "Zz Test Artist", "Zz Test Album"))
        assertNull(ExternalArt.artistUri(context, "Zz Test Artist"))
    }

    @Test
    fun theProviderRefusesToServeOrLookUpAnythingWhileOff() {
        seedCover("Zz Test Artist", "Zz Test Album")
        ExternalArt.setEnabled(context, true)
        val uri = ExternalArt.coverUri(context, "Zz Test Artist", "Zz Test Album")!!
        ExternalArt.setEnabled(context, false)
        try {
            read(uri)
            fail("served art while disabled")
        } catch (_: FileNotFoundException) {
        }
    }

    @Test
    fun aCachedCoverIsServedThroughATokenFreeContentUri() {
        seedCover("Zz Test Artist", "Zz Test Album")
        ExternalArt.setEnabled(context, true)
        val uri = ExternalArt.coverUri(context, "Zz Test Artist", "Zz Test Album")!!
        assertTrue(uri, uri.startsWith("content://${context.packageName}.artwork/cover?"))
        assertEquals("image/png", context.contentResolver.getType(Uri.parse(uri)))
        assertArrayEquals(png, read(uri))
    }

    @Test
    fun placeholderNamesGetNoUri() {
        ExternalArt.setEnabled(context, true)
        assertNull(ExternalArt.coverUri(context, "Unknown artist", "Zz Test Album"))
        assertNull(ExternalArt.coverUri(context, "Zz Test Artist", null))
        assertNull(ExternalArt.artistUri(context, " "))
    }

    @Test
    fun pulledArtworkWinsOverTheJellyfinImageItCarriesAsFallback() {
        seedCover("Zz Test Artist", "Zz Test Album")
        ExternalArt.setEnabled(context, true)
        val uri = ExternalArt.coverUri(context, "Zz Test Artist", "Zz Test Album", "abc123" to "tag.1")!!
        assertEquals("abc123", Uri.parse(uri).getQueryParameter("id"))
        assertEquals("tag.1", Uri.parse(uri).getQueryParameter("tag"))
        assertArrayEquals(png, read(uri))
    }

    @Test
    fun anInvalidFallbackIdIsNotCarriedInTheUri() {
        ExternalArt.setEnabled(context, true)
        val uri = ExternalArt.coverUri(context, "Zz Test Artist", "Zz Test Album", "../etc/passwd" to "x")!!
        assertNull(Uri.parse(uri).getQueryParameter("id"))
        assertNull(Uri.parse(uri).getQueryParameter("tag"))
    }
}
