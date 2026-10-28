package net.christopherrutherford.statocyst.jellyfin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArtworkProviderTest {
    @Test
    fun parseAcceptsArtPathWithOptionalTag() {
        assertEquals("abc-123" to "t.1", ArtworkProvider.parse(listOf("art", "abc-123"), "t.1"))
        assertEquals("abc-123" to "", ArtworkProvider.parse(listOf("art", "abc-123"), null))
    }

    @Test
    fun parseDropsAnInvalidTagButRejectsBadPathsAndIds() {
        assertEquals("abc" to "", ArtworkProvider.parse(listOf("art", "abc"), "../x"))
        assertNull(ArtworkProvider.parse(listOf("art"), null))
        assertNull(ArtworkProvider.parse(listOf("other", "abc"), null))
        assertNull(ArtworkProvider.parse(listOf("art", "abc", "extra"), null))
        assertNull(ArtworkProvider.parse(listOf("art", "../etc/passwd"), null))
        assertNull(ArtworkProvider.parse(listOf("art", "a".repeat(65)), null))
    }
}
