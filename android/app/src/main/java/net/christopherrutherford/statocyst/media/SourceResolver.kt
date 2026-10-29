package net.christopherrutherford.statocyst.media

import android.content.Context
import android.net.Uri
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.christopherrutherford.statocyst.cache.MediaCache
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.downloads.DownloadManager
import net.christopherrutherford.statocyst.artwork.ExternalArt
import net.christopherrutherford.statocyst.jellyfin.ArtworkProvider
import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import net.christopherrutherford.statocyst.jellyfin.JellyfinSessions

data class StreamResolution(
    val uri: String,
    val expiresInSeconds: Long? = null,
)

/** A track ready for the player: its catalog row and the URI to play. */
data class PreparedTrack(val entity: MediaItemEntity, val uri: String, val remote: Boolean)

/**
 * Headless source resolver. Turns a track id into a playable URI using the local
 * catalog, pinned downloads, the rolling cache and the stored Jellyfin session,
 * in that order. Never touches UI/WebView, so it works with the app closed.
 */
class SourceResolver(private val context: Context) {
    private val dao by lazy { StatocystDatabase.getInstance(context).mediaItemDao() }
    private val downloads by lazy { DownloadManager(context) }
    private val cache by lazy { MediaCache(context) }
    private val prefs by lazy { context.getSharedPreferences("statocyst", Context.MODE_PRIVATE) }

    suspend fun prepare(trackId: String): PreparedTrack? = withContext(Dispatchers.IO) {
        val entity = dao.getById(trackId) ?: return@withContext null
        val local = downloads.verifiedFile(trackId) ?: cache.lookup(trackId)
        if (local != null) {
            return@withContext localUri(local)?.let { PreparedTrack(entity, it, remote = false) }
        }
        if (entity.sourceKind.startsWith("jellyfin")) {
            return@withContext remoteStreamUrl(entity)?.let { PreparedTrack(entity, it, remote = true) }
        }
        File(entity.path).takeIf { it.isFile }
            ?.let { file -> localUri(file)?.let { PreparedTrack(entity, it, remote = false) } }
    }

    suspend fun resolve(trackId: String): StreamResolution? =
        prepare(trackId)?.let { StreamResolution(it.uri) }

    /** Starts the rolling-cache prefetch for a remote track on a worker thread. */
    fun prefetch(trackId: String) {
        val budget = prefs.getLong("cache_budget_bytes", 0L)
        if (budget <= 0) return
        Thread { runCatching { cache.prefetch(trackId, budget) } }.start()
    }

    private fun localUri(file: File): String? =
        LocalMediaServer.localUri(context.applicationContext, file)

    private fun remoteStreamUrl(track: MediaItemEntity): String? {
        val session = JellyfinSessions.forTrack(context, track) ?: return null
        val itemId = track.path.ifEmpty { track.id.removePrefix("jf-") }
        // The session token is added by the player's data source, not put in the URL.
        return JellyfinAuth.streamUrl(session.url, itemId)
    }

    /**
     * Artwork URI for a given album + image tag: a token-free content:// URI served
     * by [ArtworkProvider], so the head unit and system UI can load it without
     * Jellyfin credentials. Null when there is no session or no album id.
     */
    fun artworkUrl(albumId: String?, imageTag: String?, serverId: String? = null): String? {
        if (albumId.isNullOrEmpty()) return null
        if (!JellyfinSessions.any(context)) return null
        return ArtworkProvider.uri(context, albumId, imageTag, serverId)
    }

    /**
     * Opt-in MusicBrainz artwork overrides the server's; the Jellyfin image is the fallback
     * when nothing is found online or the setting is off.
     */
    fun artwork(albumId: String?, imageTag: String?, art: ArtKey?, serverId: String? = null): String? {
        val jellyfin = artworkUrl(albumId, imageTag, serverId)
        val fallback = albumId?.takeIf { jellyfin != null }?.let { it to imageTag }
        val external = art?.let {
            if (it.album != null) ExternalArt.coverUri(context, it.artist, it.album, fallback)
            else ExternalArt.artistUri(context, it.artist, fallback)
        }
        return external ?: jellyfin
    }
}
