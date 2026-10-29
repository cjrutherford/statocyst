package net.christopherrutherford.statocyst.jellyfin

import android.content.Context
import net.christopherrutherford.statocyst.db.MediaItemEntity
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** One signed-in Jellyfin server. [serverId] is the Jellyfin server id, or the URL when unknown. */
data class JellyfinSession(
    val serverId: String,
    val url: String,
    val userId: String,
    val token: String,
)

/**
 * Every signed-in Jellyfin server, so several can feed one library at once.
 *
 * Sessions live in the app's private preferences as a JSON array. Installs that
 * predate multi-server hold a single session in the old `jellyfin_*` keys; it is
 * adopted on first read and those keys are removed.
 */
object JellyfinSessions {
    private const val PREFS = "statocyst"
    private const val KEY = "jellyfin_sessions"

    private val lock = Any()

    fun all(context: Context): List<JellyfinSession> = synchronized(lock) {
        val prefs = prefs(context)
        migrateLegacy(prefs)
        parse(prefs.getString(KEY, null))
    }

    fun any(context: Context): Boolean = all(context).isNotEmpty()

    fun get(context: Context, serverId: String?): JellyfinSession? {
        if (serverId.isNullOrEmpty()) return null
        return all(context).firstOrNull { it.serverId == serverId }
    }

    /**
     * The session a track streams with. Tracks synced before multi-server carry no
     * server id; they belong to the one session that existed then, so fall back to
     * the first.
     */
    fun forTrack(context: Context, track: MediaItemEntity): JellyfinSession? =
        get(context, track.serverId) ?: all(context).firstOrNull()

    /**
     * The session whose server owns [uri], or null for any other host. Servers on
     * one host under different paths (`/stable`, `/unstable`) resolve to the longest
     * matching path so a token is never sent to the wrong one.
     */
    fun forUri(context: Context, uri: String?): JellyfinSession? {
        if (uri.isNullOrEmpty()) return null
        val sessions = all(context).filter { JellyfinAuth.isServerUri(it.url, uri) }
        if (sessions.size <= 1) return sessions.firstOrNull()
        val path = runCatching { URI(uri).path.orEmpty() }.getOrDefault("")
        return sessions
            .filter { path.startsWith(basePath(it.url)) }
            .maxByOrNull { basePath(it.url).length }
            ?: sessions.first()
    }

    fun save(context: Context, session: JellyfinSession) = synchronized(lock) {
        val prefs = prefs(context)
        migrateLegacy(prefs)
        val next = parse(prefs.getString(KEY, null))
            .filterNot { it.serverId == session.serverId || it.url.trimEnd('/') == session.url.trimEnd('/') } + session
        write(prefs, next)
    }

    fun remove(context: Context, serverId: String) = synchronized(lock) {
        val prefs = prefs(context)
        migrateLegacy(prefs)
        write(prefs, parse(prefs.getString(KEY, null)).filterNot { it.serverId == serverId })
    }

    fun clear(context: Context) = synchronized(lock) {
        prefs(context).edit().remove(KEY).apply()
        removeLegacy(prefs(context))
    }

    private fun basePath(url: String): String =
        runCatching { URI(url.trim()).path.orEmpty().trimEnd('/') }.getOrDefault("")

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun write(prefs: android.content.SharedPreferences, sessions: List<JellyfinSession>) {
        val array = JSONArray()
        sessions.forEach {
            array.put(
                JSONObject()
                    .put("serverId", it.serverId)
                    .put("url", it.url)
                    .put("userId", it.userId)
                    .put("token", it.token),
            )
        }
        prefs.edit().putString(KEY, array.toString()).apply()
    }

    private fun parse(raw: String?): List<JellyfinSession> {
        if (raw.isNullOrEmpty()) return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val url = item.optString("url")
                val token = item.optString("token")
                if (url.isEmpty() || token.isEmpty()) return@mapNotNull null
                JellyfinSession(
                    serverId = item.optString("serverId").ifEmpty { url },
                    url = url,
                    userId = item.optString("userId"),
                    token = token,
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Adopts the pre-multi-server single session, once. */
    private fun migrateLegacy(prefs: android.content.SharedPreferences) {
        val token = prefs.getString("jellyfin_token", null)
        val url = prefs.getString("jellyfin_url", null)
        if (!token.isNullOrEmpty() && !url.isNullOrEmpty() && !prefs.contains(KEY)) {
            write(
                prefs,
                listOf(
                    JellyfinSession(
                        serverId = prefs.getString("jellyfin_server_id", null)?.takeIf { it.isNotEmpty() } ?: url,
                        url = url,
                        userId = prefs.getString("jellyfin_user_id", null).orEmpty(),
                        token = token,
                    ),
                ),
            )
        }
        removeLegacy(prefs)
    }

    private fun removeLegacy(prefs: android.content.SharedPreferences) {
        prefs.edit()
            .remove("jellyfin_url")
            .remove("jellyfin_user_id")
            .remove("jellyfin_token")
            .remove("jellyfin_server_id")
            .apply()
    }
}
