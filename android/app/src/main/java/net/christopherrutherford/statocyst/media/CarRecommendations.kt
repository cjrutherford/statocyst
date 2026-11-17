package net.christopherrutherford.statocyst.media

import org.json.JSONObject
import java.time.Instant

/** A phone-ranked mix, stored as the native bridge payload for the car surfaces. */
data class CarMix(
    val id: String,
    val title: String,
    val subtitle: String,
    val trackIds: List<String>,
    val reasons: Map<String, String>,
)

/** The published snapshot plus the time the phone ranked it. */
data class CarSnapshot(
    val generatedAt: String?,
    val mixes: List<CarMix>,
)

/** Parses the renderer's versioned recommendation snapshot. Bad data is a safe no-op. */
object CarRecommendations {
    /** SharedPreferences key in the existing `statocyst` store. */
    const val PREF_KEY = "car_recommendations"
    const val VERSION = 1
    const val MAX_MIXES = 4
    const val STALE_AFTER_MS = 24L * 60L * 60L * 1000L

    fun parse(json: String?): List<CarMix> = parseSnapshot(json).mixes

    fun parseSnapshot(json: String?): CarSnapshot {
        if (json.isNullOrBlank()) return CarSnapshot(generatedAt = null, mixes = emptyList())
        return try {
            val root = JSONObject(json)
            if (root.optInt("version", 0) != VERSION) {
                return CarSnapshot(generatedAt = null, mixes = emptyList())
            }
            val generatedAt = root.optString("generatedAt").takeIf { it.isNotBlank() }
            val mixes = root.optJSONArray("mixes") ?: return CarSnapshot(generatedAt, emptyList())
            val parsed = (0 until mixes.length()).mapNotNull { index ->
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
            CarSnapshot(generatedAt, parsed)
        } catch (_: Exception) {
            CarSnapshot(generatedAt = null, mixes = emptyList())
        }
    }

    /**
     * True when the snapshot is missing, malformed, or older than [maxAgeMs].
     * The car keeps playing the last mix but can tell the user to refresh from
     * the phone.
     */
    fun isStale(
        snapshot: CarSnapshot,
        nowMs: Long = System.currentTimeMillis(),
        maxAgeMs: Long = STALE_AFTER_MS,
    ): Boolean {
        val generated = snapshot.generatedAt ?: return true
        val at = try {
            Instant.parse(generated).toEpochMilli()
        } catch (_: Exception) {
            return true
        }
        return nowMs - at > maxAgeMs
    }
}
