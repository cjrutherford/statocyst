package net.christopherrutherford.statocyst.jellyfin

import android.content.Context
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/**
 * Session credentials for Jellyfin requests. The access token travels in the
 * Authorization header only, never in a URL, so it does not end up in proxy or
 * server access logs, player error reports or media metadata.
 */
object JellyfinAuth {
    private const val CLIENT = "Statocyst"
    private const val DEVICE = "Statocyst Android"
    private const val VERSION = "0.1.0"

    fun header(token: String? = null): String {
        val parts = mutableListOf(
            "Client=\"$CLIENT\"",
            "Device=\"$DEVICE\"",
            "DeviceId=\"statocyst-android\"",
            "Version=\"$VERSION\"",
        )
        if (token != null) parts.add("Token=\"$token\"")
        return "MediaBrowser ${parts.joinToString(", ")}"
    }

    fun streamUrl(serverUrl: String, itemId: String): String =
        "${serverUrl.trimEnd('/')}/Audio/$itemId/stream?static=true"

    fun imageUrl(serverUrl: String, itemId: String, tag: String?): String {
        val suffix = if (!tag.isNullOrEmpty()) "?tag=$tag" else ""
        return "${serverUrl.trimEnd('/')}/Items/$itemId/Images/Primary$suffix"
    }

    /** True when [uri] points at the same scheme, host and port as the signed-in server. */
    fun isServerUri(serverUrl: String?, uri: String?): Boolean {
        if (serverUrl.isNullOrEmpty() || uri.isNullOrEmpty()) return false
        return try {
            val a = URI(serverUrl.trim())
            val b = URI(uri)
            a.scheme.equals(b.scheme, true) && a.host.equals(b.host, true) &&
                port(a) == port(b)
        } catch (_: Exception) {
            false
        }
    }

    private fun port(u: URI): Int =
        if (u.port != -1) u.port else if (u.scheme.equals("https", true)) 443 else 80

    /** Opens an authenticated connection to a Jellyfin URL. */
    fun open(url: String, token: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).also {
            it.setRequestProperty("Authorization", header(token))
        }

    /**
     * Data source for ExoPlayer and the artwork loader: adds the session header to
     * requests for a signed-in server only, using that server's own token, so a
     * token is never sent to any other host (another server, redirect targets, CDN,
     * local media server).
     */
    fun dataSourceFactory(context: Context): DataSource.Factory {
        val app = context.applicationContext
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(false)
        return ResolvingDataSource.Factory(DefaultDataSource.Factory(app, http)) { spec ->
            val session = JellyfinSessions.forUri(app, spec.uri.toString())
            if (session != null) {
                spec.withAdditionalHeaders(mapOf("Authorization" to header(session.token)))
            } else {
                spec
            }
        }
    }
}
