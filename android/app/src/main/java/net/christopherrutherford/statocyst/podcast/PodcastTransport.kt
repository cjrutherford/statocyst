package net.christopherrutherford.statocyst.podcast

import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

data class PodcastFetchResult(
    val status: Int,
    val finalUrl: String,
    val body: String?,
    val contentType: String?,
    val etag: String?,
    val lastModified: String?,
)

class PodcastTransport(
    private val userAgent: String,
    private val timeoutMs: Int = 30_000,
    private val maxBytes: Int = 15 * 1024 * 1024,
) {
    fun fetchText(
        rawUrl: String,
        allowLocalNetwork: Boolean,
        etag: String? = null,
        lastModified: String? = null,
        allowHtml: Boolean = true,
    ): PodcastFetchResult {
        var current = validate(rawUrl, allowLocalNetwork)
        repeat(6) { hop ->
            val connection = (current.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = timeoutMs
                requestMethod = "GET"
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty(
                    "Accept",
                    "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, application/octet-stream;q=0.1",
                )
                setRequestProperty("Accept-Encoding", "identity")
                if (!etag.isNullOrEmpty()) setRequestProperty("If-None-Match", etag)
                if (!lastModified.isNullOrEmpty()) setRequestProperty("If-Modified-Since", lastModified)
            }
            try {
                val status = connection.responseCode
                if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                    status == HttpURLConnection.HTTP_MOVED_TEMP ||
                    status == HttpURLConnection.HTTP_SEE_OTHER ||
                    status == 307 ||
                    status == 308
                ) {
                    val location = connection.getHeaderField("Location")
                        ?: throw IllegalStateException("The feed redirected without a location")
                    current = validate(URL(current, location).toString(), allowLocalNetwork)
                    return@repeat
                }
                if (status == 304) {
                    return PodcastFetchResult(304, current.toString(), null, connection.contentType, etag, lastModified)
                }
                if (status !in 200..299) {
                    throw IllegalStateException("The feed returned HTTP $status")
                }
                val type = connection.contentType?.substringBefore(';')?.trim()?.lowercase()
                if (type != null && type != "text/html" && !type.contains("xml") &&
                    type != "application/json" && type != "application/octet-stream" &&
                    type != "text/javascript" && type != "application/javascript" &&
                    type != "text/plain" && type.isNotEmpty()
                ) {
                    throw IllegalStateException("Unsupported feed content type: $type")
                }
                if (!allowHtml && type == "text/html") {
                    throw IllegalStateException("The feed URL returned HTML")
                }
                val body = readLimited(connection.inputStream, maxBytes)
                return PodcastFetchResult(
                    status = status,
                    finalUrl = current.toString(),
                    body = body.toString(Charsets.UTF_8),
                    contentType = type,
                    etag = connection.getHeaderField("ETag"),
                    lastModified = connection.getHeaderField("Last-Modified"),
                )
            } finally {
                connection.disconnect()
            }
        }
        throw IllegalStateException("The feed redirected too many times")
    }

    fun fetchImage(rawUrl: String, allowLocalNetwork: Boolean, maxBytes: Int = 8 * 1024 * 1024): ByteArray? {
        val current = validate(rawUrl, allowLocalNetwork)
        val connection = (current.openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 15_000
            readTimeout = timeoutMs
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "image/*")
        }
        return try {
            if (connection.responseCode !in 200..299) return null
            val type = connection.contentType?.substringBefore(';')?.trim()?.lowercase()
            if (type == null || !type.startsWith("image/")) return null
            readLimited(connection.inputStream, maxBytes)
        } finally {
            connection.disconnect()
        }
    }

    fun searchIndex(
        apiKey: String,
        secret: String,
        query: String,
    ): JSONArray {
        val date = (System.currentTimeMillis() / 1000).toString()
        val authorization = sha1(apiKey + secret + date)
        val url = URL("https://api.podcastindex.org/api/1.0/search/byterm?q=" + java.net.URLEncoder.encode(query, "UTF-8"))
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("X-Auth-Key", apiKey)
            setRequestProperty("X-Auth-Date", date)
            setRequestProperty("Authorization", authorization)
            setRequestProperty("Accept", "application/json")
        }
        return try {
            val status = connection.responseCode
            if (status == 401 || status == 403) throw IllegalStateException("Podcast Index rejected the credentials")
            if (status !in 200..299) throw IllegalStateException("Podcast Index returned HTTP $status")
            val text = readLimited(connection.inputStream, 2 * 1024 * 1024).toString(Charsets.UTF_8)
            val root = JSONObject(text)
            if (!root.optBoolean("status") && root.optString("status") != "true") {
                throw IllegalStateException(root.optString("description", "Podcast Index returned an error"))
            }
            root.optJSONArray("feeds") ?: JSONArray()
        } finally {
            connection.disconnect()
        }
    }

    private fun validate(rawUrl: String, allowLocalNetwork: Boolean): URL {
        val url = URL(rawUrl)
        require(url.protocol == "http" || url.protocol == "https") { "Only HTTP(S) feed URLs are allowed" }
        require(url.userInfo == null) { "URLs with embedded credentials are not allowed" }
        val addresses = InetAddress.getAllByName(url.host)
        for (address in addresses) {
            val alwaysBlocked = address.isAnyLocalAddress || address.isLinkLocalAddress ||
                address.isMulticastAddress
            if (alwaysBlocked) throw IllegalStateException("Link-local or metadata addresses are not allowed")
            if (!allowLocalNetwork && (address.isLoopbackAddress || address.isSiteLocalAddress)) {
                throw IllegalStateException("Private or loopback feed addresses are not allowed")
            }
        }
        return url
    }

    private fun readLimited(stream: java.io.InputStream, limit: Int): ByteArray {
        BufferedInputStream(stream).use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                if (output.size() + read > limit) {
                    throw IllegalStateException("The response is larger than $limit bytes")
                }
                output.write(buffer, 0, read)
            }
            return output.toByteArray()
        }
    }

    private fun sha1(value: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-1").digest(value.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }
}
