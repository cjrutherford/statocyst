package net.christopherrutherford.statocyst.media

/**
 * The part of a browse context (album, playlist, all tracks...) that did not fit in the
 * initial window. The service appends [next] chunks as playback nears the end of what is
 * queued, so a 5,000-track library plays on without ever shipping it over Binder at once.
 *
 * [anchorEntryId] is the queue slot that was last when the tail was captured; if the queue
 * no longer ends there (something else replaced or edited it), the tail is stale and dropped.
 */
class ContextTail(private val ids: List<String>, private var anchorEntryId: String) {
    private var cursor = 0

    val remaining: Int get() = ids.size - cursor

    /** True while [lastEntryId] is still the end of the queue this tail continues. */
    fun continues(lastEntryId: String?) = lastEntryId == anchorEntryId

    /** Whether to append now: close to the end of the queue, or shuffle (any slot can come next). */
    fun due(itemsAhead: Int, shuffle: Boolean) = remaining > 0 && (shuffle || itemsAhead <= LOW_WATER)

    /** The next chunk of track ids to append. */
    fun next(): List<String> {
        val chunk = ids.subList(cursor, (cursor + CHUNK).coerceAtMost(ids.size))
        cursor += chunk.size
        return chunk
    }

    /** Records the slot that now ends the queue after a chunk was appended. */
    fun reanchor(entryId: String) {
        anchorEntryId = entryId
    }

    companion object {
        const val LOW_WATER = 25
        const val CHUNK = BrowseTree.CONTEXT_AFTER

        fun after(allIds: List<String>, windowEndExclusive: Int, anchorEntryId: String): ContextTail? =
            if (windowEndExclusive >= allIds.size) null
            else ContextTail(allIds.subList(windowEndExclusive, allIds.size), anchorEntryId)
    }
}
