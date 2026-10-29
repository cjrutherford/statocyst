package net.christopherrutherford.statocyst.library

import net.christopherrutherford.statocyst.db.MediaItemEntity
import kotlin.math.abs

/**
 * The same recording held by more than one Jellyfin server.
 *
 * Two remote tracks are the same recording when title, artist and album match
 * (ignoring case and spacing), they sit on different servers, and their lengths
 * agree to within a few seconds. Local files and tracks from one server are never
 * merged, so two genuine copies on one server stay separate.
 */
object Duplicates {
    const val DURATION_TOLERANCE_MS = 3_000L

    fun key(track: MediaItemEntity): String? {
        if (!track.sourceKind.startsWith("jellyfin") || track.serverId.isEmpty()) return null
        val title = normalize(track.title)
        if (title.isEmpty()) return null
        return "$title|${normalize(track.artist)}|${normalize(track.album)}"
    }

    /**
     * The library with each duplicated recording shown once. The row kept is the
     * one on the lowest server id, so which server's metadata shows is stable;
     * playback still tries every server that holds the track. Hidden rows stay in
     * the catalog and keep playing by id.
     */
    fun collapse(tracks: List<MediaItemEntity>): List<MediaItemEntity> {
        val hidden = hiddenToKeeper(tracks)
        return if (hidden.isEmpty()) tracks else tracks.filterNot { it.id in hidden }
    }

    /** Each hidden duplicate's id mapped to the id of the row shown in its place. */
    fun hiddenToKeeper(tracks: List<MediaItemEntity>): Map<String, String> {
        val hidden = HashMap<String, String>()
        for ((key, group) in tracks.groupBy { key(it) }) {
            if (key == null || group.mapTo(HashSet()) { it.serverId }.size < 2) continue
            val ordered = group.sortedWith(compareBy({ it.serverId }, { it.id }))
            for (keeper in ordered) {
                if (keeper.id in hidden) continue
                val claimed = hashSetOf(keeper.serverId)
                for (other in ordered) {
                    if (other.id == keeper.id || other.id in hidden || other.serverId in claimed) continue
                    if (!sameLength(keeper, other)) continue
                    hidden[other.id] = keeper.id
                    claimed += other.serverId
                }
            }
        }
        return hidden
    }

    /** Copies of [track] on other servers, at most one per server, in a stable order. */
    fun alternatesOf(track: MediaItemEntity, candidates: List<MediaItemEntity>): List<MediaItemEntity> {
        val key = key(track) ?: return emptyList()
        val seen = hashSetOf(track.serverId)
        return candidates
            .filter { it.id != track.id && key(it) == key && sameLength(track, it) }
            .sortedWith(compareBy({ it.serverId }, { it.id }))
            .filter { seen.add(it.serverId) }
    }

    private fun sameLength(a: MediaItemEntity, b: MediaItemEntity): Boolean =
        a.durationMs <= 0 || b.durationMs <= 0 || abs(a.durationMs - b.durationMs) <= DURATION_TOLERANCE_MS

    private fun normalize(value: String): String =
        value.trim().lowercase().replace(Regex("\\s+"), " ")
}
