package net.christopherrutherford.statocyst.jellyfin

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class JellyfinServerInfo(
    val baseUrl: String,
    val id: String,
    val name: String,
    val version: String,
)

data class JellyfinAuthResult(
    val serverId: String,
    val accessToken: String,
    val userId: String,
    val userName: String,
)

object JellyfinClient {
    private fun authHeader(token: String? = null): String = JellyfinAuth.header(token)

    private fun request(
        method: String,
        url: String,
        token: String? = null,
        body: String? = null,
    ): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Authorization", authHeader(token))
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray()) }
        } else if (method == "POST") {
            // Some endpoints expect a POST with an empty body.
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(0)
            conn.outputStream.use { }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
        conn.disconnect()
        return code to text
    }

    fun discover(baseUrl: String): JellyfinServerInfo {
        val url = baseUrl.trimEnd('/')
        val (code, body) = request("GET", "$url/System/Info/Public")
        if (code != 200) throw Exception("Server unreachable (HTTP $code)")
        val json = JSONObject(body)
        if (json.optString("ProductName") != "Jellyfin Server") {
            throw Exception("Not a Jellyfin server")
        }
        return JellyfinServerInfo(
            baseUrl = url,
            id = json.getString("Id"),
            name = json.optString("ServerName", "Jellyfin"),
            version = json.getString("Version"),
        )
    }

    fun authenticate(baseUrl: String, username: String, password: String): JellyfinAuthResult {
        val url = baseUrl.trimEnd('/')
        val body = JSONObject().put("Username", username).put("Pw", password).toString()
        val (code, text) = request("POST", "$url/Users/AuthenticateByName", body = body)
        if (code != 200) throw Exception("Authentication failed (HTTP $code)")
        val json = JSONObject(text)
        val user = json.getJSONObject("User")
        val accessToken = json.getString("AccessToken")
        val serverId = json.getString("ServerId")
        if (serverId != discover(url).id) {
            throw Exception("Server identity mismatch")
        }
        return JellyfinAuthResult(
            serverId = serverId,
            accessToken = accessToken,
            userId = user.getString("Id"),
            userName = user.getString("Name"),
        )
    }

    /**
     * Checks whether a stored token can still play audio.
     *
     * Probes the media endpoint the player uses (HEAD on a real track) instead of
     * the user/library API. Reverse proxies in front of Jellyfin (Authentik,
     * Authelia) can reject the user and item endpoints while letting media
     * through, so only the media path answers the question the UI asks: "will
     * this session play?".
     */
    fun probeStream(baseUrl: String, itemId: String, token: String): Boolean {
        val url = baseUrl.trimEnd('/')
        val conn = JellyfinAuth.open(JellyfinAuth.streamUrl(url, itemId), token)
        conn.requestMethod = "HEAD"
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 8_000
        conn.readTimeout = 8_000
        conn.setRequestProperty("Accept", "*/*")
        return try {
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    /** Jellyfin's "instant mix" for a song: item ids of similar songs, best first. */
    fun instantMix(baseUrl: String, userId: String, token: String, itemId: String, limit: Int): List<String> {
        val url = baseUrl.trimEnd('/')
        val (code, body) = request(
            "GET",
            "$url/Items/$itemId/InstantMix?userId=$userId&limit=$limit",
            token = token,
        )
        if (code != 200) throw Exception("Instant mix failed (HTTP $code)")
        val items = JSONObject(body).optJSONArray("Items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { items.getJSONObject(it).optString("Id").takeIf { id -> id.isNotEmpty() } }
    }

    fun listAudioItems(
        baseUrl: String,
        userId: String,
        token: String,
        startIndex: Int = 0,
        limit: Int = 200,
    ): Pair<List<JSONObject>, Int> {
        val url = baseUrl.trimEnd('/')
        val (code, body) = request(
            "GET",
            "$url/Users/$userId/Items?Recursive=true&IncludeItemTypes=Audio&Fields=MediaSources,Genres&EnableImages=true&SortBy=SortName&SortOrder=Ascending&StartIndex=$startIndex&Limit=$limit",
            token = token,
        )
        if (code != 200) throw Exception("Browse failed (HTTP $code)")
        val json = JSONObject(body)
        val items = json.getJSONArray("Items")
        val result = mutableListOf<JSONObject>()
        for (i in 0 until items.length()) {
            result.add(items.getJSONObject(i))
        }
        return result to json.getInt("TotalRecordCount")
    }

    data class QuickConnectInit(val secret: String, val code: String)

    fun initiateQuickConnect(baseUrl: String): QuickConnectInit {
        val url = baseUrl.trimEnd('/')
        val (code, body) = request("POST", "$url/QuickConnect/Initiate")
        if (code != 200) throw Exception("Quick Connect unavailable (HTTP $code)")
        val json = JSONObject(body)
        return QuickConnectInit(
            secret = json.getString("Secret"),
            code = json.getString("Code"),
        )
    }

    fun quickConnectStatus(baseUrl: String, secret: String): Boolean {
        val url = baseUrl.trimEnd('/')
        val (code, body) = request("GET", "$url/QuickConnect/Connect?secret=$secret")
        if (code != 200) return false
        val json = JSONObject(body)
        return json.optBoolean("Authenticated", false)
    }

    fun authenticateWithQuickConnect(baseUrl: String, secret: String): JellyfinAuthResult {
        val url = baseUrl.trimEnd('/')
        val (code, body) = request("POST", "$url/Users/AuthenticateWithQuickConnect", body = """{"Secret":"$secret"}""")
        if (code != 200) throw Exception("Quick Connect authentication failed (HTTP $code)")
        val json = JSONObject(body)
        val user = json.getJSONObject("User")
        val accessToken = json.getString("AccessToken")
        val serverId = json.getString("ServerId")
        return JellyfinAuthResult(
            serverId = serverId,
            accessToken = accessToken,
            userId = user.getString("Id"),
            userName = user.getString("Name"),
        )
    }
}
