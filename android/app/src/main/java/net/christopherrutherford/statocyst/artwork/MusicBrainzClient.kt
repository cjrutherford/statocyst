package net.christopherrutherford.statocyst.artwork

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder

/** Where to find each service, and which image hosts may be fetched. Overridden in tests. */
data class Endpoints(
    val musicBrainz: String = "https://musicbrainz.org/ws/2",
    val coverArt: String = "https://coverartarchive.org",
    val wikidata: String = "https://www.wikidata.org",
    val commons: String = "https://commons.wikimedia.org",
    val isAllowedImageUrl: (String) -> Boolean = ::defaultAllowedImageUrl,
) {
    companion object {
        private val HOSTS = listOf("coverartarchive.org", "archive.org", "wikimedia.org")

        /** https only, and only the hosts the Cover Art Archive and Wikimedia Commons serve images from. */
        fun defaultAllowedImageUrl(url: String): Boolean = try {
            val u = URI(url)
            u.scheme.equals("https", true) && u.host != null &&
                HOSTS.any { u.host.equals(it, true) || u.host.lowercase().endsWith(".$it") }
        } catch (_: Exception) {
            false
        }
    }
}

/** Spaces out calls to MusicBrainz, which allows one request per second per client. */
class RateGate(private val minIntervalMs: Long = 1_100L) {
    private var last = 0L

    @Synchronized
    fun await() {
        val wait = last + minIntervalMs - System.currentTimeMillis()
        if (wait > 0) Thread.sleep(wait)
        last = System.currentTimeMillis()
    }

    companion object {
        val SHARED = RateGate()
    }
}

/**
 * Looks up album covers (Cover Art Archive) and artist photos (MusicBrainz ->
 * Wikidata -> Wikimedia Commons). Methods return null when the service has no
 * answer and throw [IOException] when it could not be asked (offline, rate
 * limited, server error), so the caller can retry sooner in that case.
 */
class MusicBrainzClient(
    private val userAgent: String,
    private val endpoints: Endpoints = Endpoints(),
    private val gate: RateGate = RateGate.SHARED,
) {
    /** MusicBrainz release-group id for an album, or null when no confident match exists. */
    fun releaseGroupId(artist: String, album: String): String? {
        val query = "releasegroup:\"${lucene(album)}\" AND artist:\"${lucene(artist)}\""
        val json = mbJson("release-group/?query=${enc(query)}&limit=5&fmt=json") ?: return null
        val groups = json.optJSONArray("release-groups") ?: return null
        for (i in 0 until groups.length()) {
            val g = groups.getJSONObject(i)
            if (g.optInt("score", 0) >= MIN_ALBUM_SCORE) return g.optString("id").takeIf { it.isNotEmpty() }
        }
        return null
    }

    /** MusicBrainz artist id when a result matches [name] exactly (ignoring case) with a high score. */
    fun artistId(name: String): String? {
        val json = mbJson("artist/?query=${enc("artist:\"${lucene(name)}\"")}&limit=5&fmt=json") ?: return null
        val artists = json.optJSONArray("artists") ?: return null
        for (i in 0 until artists.length()) {
            val a = artists.getJSONObject(i)
            if (a.optInt("score", 0) >= MIN_ARTIST_SCORE && a.optString("name").equals(name.trim(), true)) {
                return a.optString("id").takeIf { it.isNotEmpty() }
            }
        }
        return null
    }

    /** Front cover image bytes for a release group, or null when the archive has none. */
    fun coverBytes(releaseGroupId: String): ByteArray? =
        image("${endpoints.coverArt}/release-group/${enc(releaseGroupId)}/front-250")

    /** Photo bytes for an artist, found through the Commons image MusicBrainz links to via Wikidata. */
    fun artistImageBytes(artistId: String): ByteArray? {
        val json = mbJson("artist/${enc(artistId)}?inc=url-rels&fmt=json") ?: return null
        val relations = json.optJSONArray("relations") ?: return null
        var qid: String? = null
        for (i in 0 until relations.length()) {
            val r = relations.getJSONObject(i)
            val resource = r.optJSONObject("url")?.optString("resource").orEmpty()
            when (r.optString("type")) {
                "image" -> commonsFileName(resource)?.let { return image(filePath(it)) }
                "wikidata" -> if (qid == null) qid = resource.substringAfterLast('/').takeIf { QID.matches(it) }
            }
        }
        val id = qid ?: return null
        val entity = getJson("${endpoints.wikidata}/wiki/Special:EntityData/$id.json") ?: return null
        val file = entity.optJSONObject("entities")?.optJSONObject(id)?.optJSONObject("claims")
            ?.optJSONArray("P18")?.optJSONObject(0)?.optJSONObject("mainsnak")
            ?.optJSONObject("datavalue")?.optString("value")?.takeIf { it.isNotEmpty() } ?: return null
        return image(filePath(file))
    }

    private fun filePath(fileName: String): String =
        "${endpoints.commons}/wiki/Special:FilePath/${enc(fileName.replace(' ', '_'))}?width=300"

    private fun commonsFileName(resource: String): String? {
        val marker = "/wiki/File:"
        val at = resource.indexOf(marker)
        if (at < 0 || !resource.contains("commons.wikimedia.org")) return null
        return java.net.URLDecoder.decode(resource.substring(at + marker.length), "UTF-8").takeIf { it.isNotBlank() }
    }

    private fun mbJson(path: String): JSONObject? {
        gate.await()
        return getJson("${endpoints.musicBrainz}/$path")
    }

    private fun getJson(url: String): JSONObject? {
        val conn = open(url, "application/json")
        try {
            return when (val code = conn.responseCode) {
                200 -> JSONObject(conn.inputStream.use { String(it.readBytes(), Charsets.UTF_8) })
                400, 404 -> null
                else -> throw IOException("HTTP $code for ${URI(url).host}")
            }
        } catch (e: org.json.JSONException) {
            throw IOException("bad JSON", e)
        } finally {
            conn.disconnect()
        }
    }

    /** Follows a few redirects, but only to image hosts we allow; null for 404, an error for anything else. */
    private fun image(start: String): ByteArray? {
        var url = start
        repeat(MAX_REDIRECTS + 1) {
            if (!endpoints.isAllowedImageUrl(url)) return null
            val conn = open(url, "image/*")
            conn.instanceFollowRedirects = false
            try {
                when (val code = conn.responseCode) {
                    200 -> return readCapped(conn)
                    301, 302, 303, 307, 308 -> url = URL(URL(url), conn.getHeaderField("Location") ?: return null).toString()
                    404 -> return null
                    else -> throw IOException("HTTP $code for image")
                }
            } finally {
                conn.disconnect()
            }
        }
        return null
    }

    private fun readCapped(conn: HttpURLConnection): ByteArray {
        val out = ByteArrayOutputStream()
        conn.inputStream.use { input ->
            val buf = ByteArray(16 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                if (out.size() > MAX_IMAGE_BYTES) throw IOException("image too large")
            }
        }
        return out.toByteArray()
    }

    private fun open(url: String, accept: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).also {
            it.connectTimeout = 8_000
            it.readTimeout = 15_000
            it.setRequestProperty("User-Agent", userAgent)
            it.setRequestProperty("Accept", accept)
        }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    /** Quotes and backslashes would change the Lucene query's meaning; drop them. */
    private fun lucene(s: String) = s.replace("\"", " ").replace("\\", " ").trim()

    companion object {
        const val MAX_IMAGE_BYTES = 6L * 1024 * 1024
        private const val MAX_REDIRECTS = 4
        private const val MIN_ALBUM_SCORE = 90
        private const val MIN_ARTIST_SCORE = 95
        private val QID = Regex("Q[0-9]{1,12}")
    }
}
