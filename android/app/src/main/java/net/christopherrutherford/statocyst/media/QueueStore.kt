package net.christopherrutherford.statocyst.media

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class QueuedTrack(
    val trackId: String,
    val position: Int,
)

class QueueStore(private val context: Context) {
    private val prefs by lazy { context.getSharedPreferences("statocyst_queue", Context.MODE_PRIVATE) }

    fun saveQueue(trackIds: List<String>, currentIndex: Int) {
        val arr = JSONArray()
        trackIds.forEach { arr.put(it) }
        prefs.edit()
            .putString("queue", arr.toString())
            .putInt("currentIndex", currentIndex)
            .putLong("updatedAt", System.currentTimeMillis())
            .apply()
    }

    fun loadQueue(): Pair<List<String>, Int> {
        val json = prefs.getString("queue", null) ?: return emptyList<String>() to -1
        return try {
            val arr = JSONArray(json)
            val list = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                list.add(arr.getString(i))
            }
            val idx = prefs.getInt("currentIndex", if (list.isEmpty()) -1 else 0)
            list to idx
        } catch (e: Exception) {
            emptyList<String>() to -1
        }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
