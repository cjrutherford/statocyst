package net.christopherrutherford.statocyst.media

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One queue slot: [entryId] is the unique slot id, [trackId] the library track. */
data class QueueSlot(val entryId: String, val trackId: String)

data class SavedQueue(
    val slots: List<QueueSlot>,
    val index: Int,
    val positionMs: Long,
    val shuffle: Boolean,
    val repeatMode: Int,
    /** Playlist indices in shuffled play order, or null when none was saved. */
    val shuffleOrder: List<Int>? = null,
)

/**
 * Persists the native playback queue, position and shuffle/repeat modes so a
 * service restart (or a car reconnecting after the process died) resumes the
 * same state. The ExoPlayer instance is the source of truth while running.
 */
class QueueStore(private val context: Context) {
    private val prefs by lazy { context.getSharedPreferences("statocyst_queue", Context.MODE_PRIVATE) }

    fun save(queue: SavedQueue) {
        val arr = JSONArray()
        queue.slots.forEach { arr.put(JSONObject().put("e", it.entryId).put("t", it.trackId)) }
        prefs.edit()
            .putString("slots", arr.toString())
            .putInt("index", queue.index)
            .putLong("positionMs", queue.positionMs)
            .putBoolean("shuffle", queue.shuffle)
            .putInt("repeatMode", queue.repeatMode)
            .putString("order", queue.shuffleOrder?.let(ShuffleOrders::encode))
            .putLong("updatedAt", System.currentTimeMillis())
            .apply()
    }

    /** Cheap periodic update of where playback is, without rewriting the whole queue. */
    fun savePosition(index: Int, positionMs: Long) {
        if (!prefs.contains("slots")) return
        prefs.edit().putInt("index", index).putLong("positionMs", positionMs).apply()
    }

    fun load(): SavedQueue? {
        val json = prefs.getString("slots", null) ?: return null
        return try {
            val arr = JSONArray(json)
            val slots = (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                QueueSlot(o.getString("e"), o.getString("t"))
            }
            if (slots.isEmpty()) return null
            SavedQueue(
                slots = slots,
                index = prefs.getInt("index", 0).coerceIn(0, slots.size - 1),
                positionMs = prefs.getLong("positionMs", 0L).coerceAtLeast(0L),
                shuffle = prefs.getBoolean("shuffle", false),
                repeatMode = prefs.getInt("repeatMode", 0),
                shuffleOrder = ShuffleOrders.decode(prefs.getString("order", null))
                    ?.takeIf { ShuffleOrders.isPermutation(it, slots.size) },
            )
        } catch (e: Exception) {
            null
        }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
