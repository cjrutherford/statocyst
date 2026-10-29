package net.christopherrutherford.statocyst.radio

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.jellyfin.JellyfinClient
import net.christopherrutherford.statocyst.jellyfin.JellyfinSessions
import net.christopherrutherford.statocyst.db.MediaItemEntity

/** A built radio: the seed first, then similar tracks, and where they came from. */
data class RadioResult(val trackIds: List<String>, val source: String)

/**
 * Builds a song radio. For a Jellyfin seed it asks the server's instant mix
 * (it knows genres, moods and listening data we do not), keeps what is in the
 * local catalog and tops up from the local metadata scorer. Local seeds, offline
 * use and any server failure use the scorer alone, so radio always works.
 */
class RadioBuilder(private val context: Context) {
    private val db by lazy { StatocystDatabase.getInstance(context) }

    suspend fun build(seedId: String, limit: Int = RadioScorer.DEFAULT_LIMIT): RadioResult? = withContext(Dispatchers.IO) {
        val library = db.mediaItemDao().getAll()
        val seed = library.firstOrNull { it.id == seedId } ?: return@withContext null
        val favorites = db.userDao().favorites().map { it.trackId }.toSet()
        val remote = if (seed.sourceKind.startsWith("jellyfin")) instantMix(seed, library.map { it.id }.toSet(), limit) else emptyList()
        val local = if (remote.size >= limit) emptyList()
        else RadioScorer.build(seed, library, favorites, limit - remote.size, exclude = remote.toSet())
        val source = when {
            remote.isEmpty() -> "local"
            local.isEmpty() -> "jellyfin"
            else -> "mixed"
        }
        RadioResult(listOf(seedId) + (remote - seedId) + local, source)
    }

    private fun instantMix(seed: MediaItemEntity, known: Set<String>, limit: Int): List<String> {
        val itemId = seed.path.ifEmpty { seed.id.removePrefix("jf-") }
        val session = JellyfinSessions.forTrack(context, seed)?.takeIf { it.userId.isNotEmpty() } ?: return emptyList()
        return try {
            JellyfinClient.instantMix(session.url, session.userId, session.token, itemId, limit * 2)
                .map { "jf-$it" }.filter { it in known && it != "jf-$itemId" }.distinct().take(limit)
        } catch (e: Exception) {
            android.util.Log.w("RadioBuilder", "instant mix unavailable, using local scorer", e)
            emptyList()
        }
    }
}
