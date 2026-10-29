package net.christopherrutherford.statocyst.media

import android.content.Context
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import net.christopherrutherford.statocyst.db.MediaItemDao
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import net.christopherrutherford.statocyst.jellyfin.JellyfinSession
import net.christopherrutherford.statocyst.jellyfin.JellyfinSessions
import net.christopherrutherford.statocyst.library.Duplicates

/**
 * Picks which server streams a track that more than one server holds: whichever
 * answers first. Servers are probed together, and a server that answered (or
 * failed) recently is trusted for a short while, so a queue of tracks does not
 * pay for a probe each. A track on one server is never probed.
 */
object StreamFailover {
    data class Candidate(val track: MediaItemEntity, val session: JellyfinSession) {
        val itemId: String get() = track.path.ifEmpty { track.id.removePrefix("jf-") }
    }

    private const val PROBE_TIMEOUT_MS = 4_000L
    private const val OK_TTL_MS = 60_000L
    private const val FAIL_TTL_MS = 30_000L

    private val health = ConcurrentHashMap<String, Pair<Boolean, Long>>()

    /** Records that [serverId] just failed mid-stream, so the next pick looks at its alternates. */
    fun markFailed(serverId: String, now: Long = System.currentTimeMillis()) {
        health[serverId] = false to now
    }

    internal fun resetHealth() = health.clear()

    /** Copies of [track] on other servers. */
    suspend fun alternates(dao: MediaItemDao, track: MediaItemEntity): List<MediaItemEntity> {
        if (!track.sourceKind.startsWith("jellyfin") || track.title.isEmpty()) return emptyList()
        return Duplicates.alternatesOf(track, dao.jellyfinByTitle(track.title))
    }

    /** The stream URL for [track], from whichever server holding it answers first. */
    suspend fun remoteUrl(context: Context, dao: MediaItemDao, track: MediaItemEntity): String? {
        val candidates = buildList {
            JellyfinSessions.forTrack(context, track)?.let { add(Candidate(track, it)) }
            for (alt in alternates(dao, track)) {
                JellyfinSessions.get(context, alt.serverId)?.let { add(Candidate(alt, it)) }
            }
        }
        val chosen = choose(candidates, ::httpProbe) ?: candidates.firstOrNull() ?: return null
        // The session token is added by the player's data source, not put in the URL.
        return JellyfinAuth.streamUrl(chosen.session.url, chosen.itemId)
    }

    internal suspend fun choose(
        candidates: List<Candidate>,
        probe: suspend (Candidate) -> Boolean,
        now: () -> Long = System::currentTimeMillis,
    ): Candidate? {
        if (candidates.size <= 1) return candidates.firstOrNull()
        val time = now()
        candidates.firstOrNull { health[it.session.serverId]?.let { (ok, at) -> ok && time - at < OK_TTL_MS } == true }
            ?.let { return it }
        val untried = candidates.filterNot {
            health[it.session.serverId]?.let { (ok, at) -> !ok && time - at < FAIL_TTL_MS } == true
        }.ifEmpty { candidates }

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val winner = CompletableDeferred<Candidate?>()
        val probes = untried.map { candidate ->
            scope.launch {
                val ok = withTimeoutOrNull(PROBE_TIMEOUT_MS) { probe(candidate) } == true
                health[candidate.session.serverId] = ok to now()
                if (ok) winner.complete(candidate)
            }
        }
        scope.launch {
            probes.joinAll()
            winner.complete(null)
        }
        return winner.await().also { scope.cancel() }
    }

    private fun httpProbe(candidate: Candidate): Boolean {
        val connection = JellyfinAuth.open(
            JellyfinAuth.streamUrl(candidate.session.url, candidate.itemId),
            candidate.session.token,
        )
        return try {
            connection.connectTimeout = PROBE_TIMEOUT_MS.toInt()
            connection.readTimeout = PROBE_TIMEOUT_MS.toInt()
            connection.setRequestProperty("Range", "bytes=0-0")
            connection.responseCode in 200..299
        } catch (_: Exception) {
            false
        } finally {
            connection.disconnect()
        }
    }
}
