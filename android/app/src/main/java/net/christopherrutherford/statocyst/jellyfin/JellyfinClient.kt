package net.christopherrutherford.statocyst.jellyfin

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

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
    private const val CLIENT = "Statocyst"
    private const val DEVICE = "Statocyst Android"
    private const val VERSION = "0.1.0"

    private fun authHeader(token: String? = null): String {
        val parts = mutableListOf(
            "Client=\"$CLIENT\"",
            "Device=\"$DEVICE\"",
            "DeviceId=\"statocyst-android\"",
            "Version=\"$VERSION\"",
        )
        if (token != null) parts.add("Token=\"$token\"")
        return "MediaBrowser ${parts.joinToString(", ")}"
    }

    private fun request(
        method: String,
        url: String,
        token: String? = null,
        body: String? = null,
    ): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Authorization", authHeader(token))
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray()) }
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
        val body = """{"Username":"$username","Pw":"$password"}"""
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
}
