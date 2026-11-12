package net.christopherrutherford.statocyst.podcast

import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL

/**
 * The single HTTP(S)/SSRF gate for podcast feeds, artwork and media enclosures.
 *
 * Enclosure downloads previously went straight to the URL stored on the media
 * item, which bypassed the feed policy. Every feed, image, alternate and download
 * now resolves through [validate] and [open]; redirects are revalidated hop by hop
 * so a public URL cannot bounce into the local network.
 */
object PodcastUrls {
    private const val MAX_REDIRECTS = 6

    /** Validates a user/publisher URL and resolves its host before any request. */
    fun validate(rawUrl: String, allowLocalNetwork: Boolean): URL {
        val url = URL(rawUrl)
        require(url.protocol == "http" || url.protocol == "https") { "Only HTTP(S) URLs are allowed" }
        require(url.userInfo == null) { "URLs with embedded credentials are not allowed" }
        val addresses = InetAddress.getAllByName(url.host)
        for (address in addresses) {
            val alwaysBlocked = address.isAnyLocalAddress || address.isLinkLocalAddress ||
                address.isMulticastAddress
            if (alwaysBlocked) throw IllegalStateException("Link-local or metadata addresses are not allowed")
            if (!allowLocalNetwork && (address.isLoopbackAddress || address.isSiteLocalAddress)) {
                throw IllegalStateException("Private or loopback addresses are not allowed")
            }
        }
        return url
    }

    /**
     * Opens a GET with redirect revalidation and optional Range resume. The caller
     * owns the returned connection and must disconnect it.
     */
    fun open(
        rawUrl: String,
        allowLocalNetwork: Boolean,
        rangeStart: Long = 0,
        userAgent: String = "Statocyst",
        timeoutMs: Int = 30_000,
    ): HttpURLConnection {
        var current = validate(rawUrl, allowLocalNetwork)
        repeat(MAX_REDIRECTS) {
            val connection = (current.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = timeoutMs
                requestMethod = "GET"
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "*/*")
                setRequestProperty("Accept-Encoding", "identity")
                if (rangeStart > 0) setRequestProperty("Range", "bytes=$rangeStart-")
            }
            val status = try {
                connection.responseCode
            } catch (error: Exception) {
                connection.disconnect()
                throw error
            }
            if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                status == HttpURLConnection.HTTP_MOVED_TEMP ||
                status == HttpURLConnection.HTTP_SEE_OTHER ||
                status == 307 ||
                status == 308
            ) {
                val location = connection.getHeaderField("Location")
                connection.disconnect()
                if (location.isNullOrEmpty()) {
                    throw IllegalStateException("The media URL redirected without a location")
                }
                current = validate(URL(current, location).toString(), allowLocalNetwork)
                return@repeat
            }
            return connection
        }
        throw IllegalStateException("The media URL redirected too many times")
    }
}
