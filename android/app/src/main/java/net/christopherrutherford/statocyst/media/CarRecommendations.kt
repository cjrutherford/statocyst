package net.christopherrutherford.statocyst.media

import org.json.JSONObject

/** A phone-ranked mix, stored as the native bridge payload for the car surfaces. */
data class CarMix(
    val id: String,
    val title: String,
    val subtitle: String,
    val trackIds: List<String>,
    val reasons: Map<String, String>,
)

/** Parses the renderer's versioned recommendation snapshot. Bad data is a safe no-op. */
object CarRecommendations {
    /** SharedPreferences key in the existing `statocyst` store. */
    const val PREF_KEY = "car_recommendations"
    const val VERSION = 1
    const val MAX_MIXES = 4

    fun parse(json: String?): List<CarMix> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val root = JSONObject(json)
            if (root.optInt("version", 0) != VERSION) return emptyList()
            val mixes = root.optJSONArray("mixes") ?: return emptyList()
            (0 until mixes.length()).mapNotNull { index ->
                val obj = mixes.optJSONObject(index) ?: return@mapNotNull null
                val id = obj.optString("id")
                if (id.isEmpty()) return@mapNotNull null
                val trackIds = mutableListOf<String>()
                val ids = obj.optJSONArray("trackIds")
                for (j in 0 until (ids?.length() ?: 0)) {
                    ids?.optString(j)?.takeIf { it.isNotEmpty() }?.let(trackIds::add)
                }
                if (trackIds.isEmpty()) return@mapNotNull null
                val reasonsObj = obj.optJSONObject("reasons")
                val reasons = mutableMapOf<String, String>()
                if (reasonsObj != null) {
                    for (key in reasonsObj.keys()) {
                        reasons[key] = reasonsObj.optString(key)
                    }
                }
                CarMix(
                    id = id,
                    title = obj.optString("title", "For you"),
                    subtitle = obj.optString("subtitle", ""),
                    trackIds = trackIds.distinct(),
                    reasons = reasons,
                )
            }.take(MAX_MIXES)
        } catch (_: Exception) {
            emptyList()
        }
    }
}
