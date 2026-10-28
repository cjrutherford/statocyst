package net.christopherrutherford.statocyst.jellyfin

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** JellyfinClient against an in-process fake Jellyfin: no network, no real server. */
class JellyfinClientTest {
    private val goodToken = "tok-good"
    private var serverId = "srv-1"
    private var productName = "Jellyfin Server"
    private lateinit var server: FakeHttpServer

    private fun json(obj: Any, status: Int = 200) =
        FakeHttpServer.Response(status, "application/json", obj.toString().toByteArray())

    private fun authed(req: FakeHttpServer.Request) =
        req.headers["authorization"]?.contains("Token=\"$goodToken\"") == true

    @Before
    fun setUp() {
        server = FakeHttpServer { req ->
            when {
                req.path == "/System/Info/Public" -> json(
                    JSONObject().put("ProductName", productName).put("Id", serverId)
                        .put("ServerName", "Home").put("Version", "10.9.0"),
                )
                req.path == "/Users/AuthenticateByName" && req.method == "POST" -> {
                    val body = JSONObject(req.body)
                    if (body.optString("Username") == "chris" && body.optString("Pw") == "pw") {
                        json(
                            JSONObject().put("AccessToken", goodToken).put("ServerId", "srv-1")
                                .put("User", JSONObject().put("Id", "u1").put("Name", "chris")),
                        )
                    } else {
                        FakeHttpServer.Response(401)
                    }
                }
                req.path == "/QuickConnect/Initiate" && req.method == "POST" ->
                    json(JSONObject().put("Secret", "sec").put("Code", "123456"))
                req.path == "/QuickConnect/Connect" ->
                    json(JSONObject().put("Authenticated", req.query == "secret=sec"))
                req.path == "/Users/AuthenticateWithQuickConnect" && req.method == "POST" ->
                    json(
                        JSONObject().put("AccessToken", goodToken).put("ServerId", "srv-1")
                            .put("User", JSONObject().put("Id", "u1").put("Name", "chris")),
                    )
                req.path.startsWith("/Items/") && req.path.endsWith("/InstantMix") ->
                    if (!authed(req)) FakeHttpServer.Response(401)
                    else json(
                        JSONObject().put(
                            "Items",
                            JSONArray().put(JSONObject().put("Id", "m1")).put(JSONObject().put("Id", "m2"))
                                .put(JSONObject()),
                        ),
                    )
                req.path == "/Users/u1/Items" ->
                    if (!authed(req)) FakeHttpServer.Response(401)
                    else {
                        val start = Regex("StartIndex=(\\d+)").find(req.query!!)!!.groupValues[1].toInt()
                        val page = JSONArray().apply { (start until minOf(start + 2, 5)).forEach { put(JSONObject().put("Id", "a$it")) } }
                        json(JSONObject().put("Items", page).put("TotalRecordCount", 5))
                    }
                req.path.startsWith("/Audio/") && req.path.endsWith("/stream") ->
                    if (authed(req)) FakeHttpServer.Response(200, "audio/mpeg", ByteArray(4)) else FakeHttpServer.Response(401)
                else -> FakeHttpServer.Response(404)
            }
        }
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun discoverReadsPublicInfoAndRejectsOtherProducts() {
        val info = JellyfinClient.discover(server.url + "/")
        assertEquals("srv-1", info.id)
        assertEquals("10.9.0", info.version)
        productName = "Something Else"
        try {
            JellyfinClient.discover(server.url)
            fail("expected a non-Jellyfin server to be rejected")
        } catch (e: Exception) {
            assertTrue(e.message!!.contains("Not a Jellyfin server"))
        }
    }

    @Test
    fun authenticateReturnsSessionAndSendsCredentialsOnlyInTheBody() {
        val result = JellyfinClient.authenticate(server.url, "chris", "pw")
        assertEquals(goodToken, result.accessToken)
        assertEquals("u1", result.userId)
        val login = server.requests.first { it.path == "/Users/AuthenticateByName" }
        assertFalse(login.target.contains("pw") || login.target.contains("chris"))
        assertTrue(login.headers["authorization"]!!.startsWith("MediaBrowser "))
        assertFalse(login.headers["authorization"]!!.contains("Token="))
    }

    @Test
    fun wrongPasswordAndServerIdentityMismatchFail() {
        try {
            JellyfinClient.authenticate(server.url, "chris", "nope")
            fail("expected failure")
        } catch (e: Exception) {
            assertTrue(e.message!!.contains("401"))
        }
        serverId = "someone-else"
        try {
            JellyfinClient.authenticate(server.url, "chris", "pw")
            fail("expected identity mismatch")
        } catch (e: Exception) {
            assertTrue(e.message!!.contains("identity mismatch"))
        }
    }

    @Test
    fun instantMixSendsTokenInHeaderAndSkipsItemsWithoutIds() {
        val ids = JellyfinClient.instantMix(server.url, "u1", goodToken, "seed", 10)
        assertEquals(listOf("m1", "m2"), ids)
        val req = server.requests.last()
        assertEquals("userId=u1&limit=10", req.query)
        assertTrue(req.headers["authorization"]!!.contains("Token=\"$goodToken\""))
        assertFalse(req.target.contains(goodToken))
        try {
            JellyfinClient.instantMix(server.url, "u1", "expired", "seed", 10)
            fail("expected failure")
        } catch (e: Exception) {
            assertTrue(e.message!!.contains("401"))
        }
    }

    @Test
    fun listAudioItemsPagesUntilTheTotalIsReached() {
        val all = mutableListOf<String>()
        var start = 0
        while (true) {
            val (items, total) = JellyfinClient.listAudioItems(server.url, "u1", goodToken, start, 2)
            all += items.map { it.getString("Id") }
            start += items.size
            assertEquals(5, total)
            if (start >= total) break
        }
        assertEquals(listOf("a0", "a1", "a2", "a3", "a4"), all)
        assertTrue(server.requests.filter { it.path == "/Users/u1/Items" }.none { it.target.contains(goodToken) })
    }

    @Test
    fun probeStreamIsTrueOnlyForAnAuthorizedSession() {
        assertTrue(JellyfinClient.probeStream(server.url, "item1", goodToken))
        assertFalse(JellyfinClient.probeStream(server.url, "item1", "expired"))
        val probe = server.requests.first()
        assertEquals("HEAD", probe.method)
        assertEquals("/Audio/item1/stream", probe.path)
        assertEquals("static=true", probe.query)
    }

    @Test
    fun quickConnectFlowYieldsASession() {
        val init = JellyfinClient.initiateQuickConnect(server.url)
        assertEquals("123456", init.code)
        assertTrue(JellyfinClient.quickConnectStatus(server.url, init.secret))
        assertFalse(JellyfinClient.quickConnectStatus(server.url, "wrong"))
        assertEquals(goodToken, JellyfinClient.authenticateWithQuickConnect(server.url, init.secret).accessToken)
    }

    @Test
    fun artworkAndStreamUrlsToAForeignHostNeverGetTheSessionHeader() {
        // The player's data source only adds the header for the signed-in server (scheme+host+port).
        assertTrue(JellyfinAuth.isServerUri(server.url, server.url + "/Audio/x/stream"))
        assertFalse(JellyfinAuth.isServerUri(server.url, "http://127.0.0.1:1/Audio/x/stream"))
        assertNull(JellyfinArtwork.download(server.url, goodToken, "bad id", "", 300, java.io.File(System.getProperty("java.io.tmpdir"), "jf-none")))
    }
}
