package net.christopherrutherford.statocyst.media

/**
 * Pure helpers for persisting ExoPlayer's shuffle order. The order is the list of
 * playlist indices in shuffled play order, so it survives a process restart only
 * if it is saved with the queue and re-applied after the queue is rebuilt.
 */
object ShuffleOrders {
    /** True when [order] holds each index in `0 until size` exactly once. */
    fun isPermutation(order: List<Int>, size: Int): Boolean {
        if (order.size != size) return false
        val seen = BooleanArray(size)
        for (i in order) {
            if (i !in 0 until size || seen[i]) return false
            seen[i] = true
        }
        return true
    }

    /**
     * Maps a saved order onto a rebuilt queue in which some slots were dropped.
     * [keptOld] lists, in queue order, the old indices that survived; the result
     * keeps their relative shuffle order but with their new indices. Null when
     * the saved order is not a valid permutation of the old queue or nothing survived.
     */
    fun remap(order: List<Int>?, oldSize: Int, keptOld: List<Int>): List<Int>? {
        if (order == null || keptOld.isEmpty() || !isPermutation(order, oldSize)) return null
        val newIndex = IntArray(oldSize) { -1 }
        keptOld.forEachIndexed { newIdx, oldIdx -> if (oldIdx in 0 until oldSize) newIndex[oldIdx] = newIdx }
        return order.mapNotNull { newIndex[it].takeIf { n -> n >= 0 } }
            .takeIf { isPermutation(it, keptOld.size) }
    }

    fun encode(order: List<Int>): String = order.joinToString(",")

    fun decode(text: String?): List<Int>? {
        if (text.isNullOrEmpty()) return null
        return try {
            text.split(',').map { it.toInt() }
        } catch (_: NumberFormatException) {
            null
        }
    }
}
