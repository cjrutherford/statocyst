package net.christopherrutherford.statocyst.media

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.jellyfin.JellyfinClient
import org.json.JSONObject

data class StreamResolution(
    val uri: String,
    val expiresInSeconds: Long? = null,
)

/**
 * Headless source resolver. Turns a browse track id into a playable stream URI
 * using the local catalog + stored Jellyfin session. Never touches UI/WebView.
 */
class SourceResolver(private val context: Context) {
    private val dao by lazy { StatocystDatabase.getInstance(context).mediaItemDao() }
    private val prefs by lazy { context.getSharedPreferences("statocyst", Context.MODE_PRIVATE) }

    suspend fun resolve(trackId: String): StreamResolution? = withContext(Dispatchers.IO) {
        val entity = dao.getById(trackId) ?: return@withContext null
        if (entity.sourceKind == "jellyfin" || entity.sourceKind == "jellyfin-library") {
            val url = prefs.getString("jellyfin_url", null) ?: return@withContext null
            val token = prefs.getString("jellyfin_token", null) ?: return@withContext null
            if (url.isEmpty() || token.isEmpty()) return@withContext null
            try {
                // Catalog ids carry a local "jf-" prefix; the Jellyfin API id does not.
                val itemId = trackId.removePrefix("jf-")
                val streamUrl = "${url.trimEnd('/')}/Audio/$itemId/stream?static=true&api_key=$token"
                return@withContext StreamResolution(streamUrl)
            } catch (e: Exception) {
                return@withContext null
            }
        } else {
            // Local file path
            if (entity.path.isNotEmpty()) {
                return@withContext StreamResolution(entity.path)
            }
        }
        null
    }

    /**
     * Direct Jellyfin primary-image URL for a given album + image tag. Uses the
     * stored session token. Returns null when no session or no album id.
     */
    fun artworkUrl(albumId: String?, imageTag: String?): String? {
        if (albumId.isNullOrEmpty()) return null
        val url = prefs.getString("jellyfin_url", null) ?: return null
        val token = prefs.getString("jellyfin_token", null) ?: return null
        if (url.isEmpty() || token.isEmpty()) return null
        val tag = if (!imageTag.isNullOrEmpty()) "&tag=$imageTag" else ""
        return "${url.trimEnd('/')}/Items/$albumId/Images/Primary?api_key=$token$tag"
    }
}
