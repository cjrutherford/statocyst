package net.christopherrutherford.statocyst.jellyfin

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JellyfinAuthTest {
    @Test
    fun streamAndImageUrlsNeverCarryTheToken() {
        val stream = JellyfinAuth.streamUrl("https://jf.example.com/", "abc")
        val image = JellyfinAuth.imageUrl("https://jf.example.com", "alb", "t1")
        assertTrue(stream == "https://jf.example.com/Audio/abc/stream?static=true")
        assertTrue(image == "https://jf.example.com/Items/alb/Images/Primary?tag=t1")
        assertFalse(stream.contains("api_key", true) || image.contains("api_key", true))
    }

    @Test
    fun headerCarriesTheTokenOnlyWhenGiven() {
        assertTrue(JellyfinAuth.header("secret").contains("Token=\"secret\""))
        assertFalse(JellyfinAuth.header().contains("Token="))
    }

    @Test
    fun tokenIsOnlyForTheSignedInServer() {
        val server = "https://jf.example.com"
        assertTrue(JellyfinAuth.isServerUri(server, "https://jf.example.com/Audio/1/stream"))
        assertTrue(JellyfinAuth.isServerUri(server, "https://JF.example.com:443/x"))
        assertFalse(JellyfinAuth.isServerUri(server, "http://jf.example.com/x"))
        assertFalse(JellyfinAuth.isServerUri(server, "https://cdn.example.com/x"))
        assertFalse(JellyfinAuth.isServerUri(server, "https://jf.example.com:8443/x"))
        assertFalse(JellyfinAuth.isServerUri(server, "http://127.0.0.1:5000/media/1/file"))
        assertFalse(JellyfinAuth.isServerUri(null, "https://jf.example.com/x"))
    }
}
