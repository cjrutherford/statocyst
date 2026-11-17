package net.christopherrutherford.statocyst.media

import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.RecentEntity
import net.christopherrutherford.statocyst.radio.RadioScorer
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Native fallback for the four car mixes. Mirrors
 * libs/recommendation/src/lib/recommendation.ts and car-mixes.ts so Android
 * Auto and AAOS still have For you before the phone WebView has run.
 *
 * The shared golden fixture is libs/recommendation/fixtures/car-recommendation-golden.json.
 */
object CarRecommender {
    private const val FAVORITE = 25.0
    private const val ARTIST_AFFINITY = 30.0
    private const val GENRE_AFFINITY = 18.0
    private const val ALBUM_AFFINITY = 8.0
    private const val SEED_SIMILARITY = 20.0
    private const val DISCOVERY = 4.0
    private const val REDISCOVER = 6.0
    private const val RECENT_WINDOW_PENALTY = 22.0
    private const val RECENT_WEEK_PENALTY = 10.0
    private const val RECENT_EXCLUSION_DAYS = 0.5
    private const val MAX_PER_ARTIST = 2
    private const val DAY_MS = 86_400_000.0
    private const val CANDIDATE_LIMIT = 80
    private const val MIX_LIMIT = 12

    private const val FAVORITE_REASON = "In your favorites"
    private const val ARTIST_REASON = "More from your top artists"
    private const val GENRE_REASON = "Matches your listening"
    private const val ALBUM_REASON = "From an album you play"
    private const val SEED_REASON = "Similar to songs you played recently"
    private const val REDISCOVER_REASON = "Not played in a while"
    private const val DISCOVERY_REASON = "New to you"

    private val nonWord = Regex("[^\\p{L}\\p{N}]+")
    private val generatedAtFormatter = DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)

    private fun norm(value: String?): String =
        (value ?: "").lowercase().replace(nonWord, " ").trim()

    private fun genresOf(track: MediaItemEntity): List<Pair<String, String>> =
        (track.genre ?: "")
            .split(',', ';', '/', '|')
            .map { it.trim() to norm(it) }
            .filter { it.second.isNotEmpty() }

    private fun add(map: MutableMap<String, Double>, key: String, amount: Double) {
        if (key.isEmpty()) return
        map[key] = (map[key] ?: 0.0) + amount
    }

    private fun normalized(map: Map<String, Double>): Map<String, Double> {
        val max = map.values.maxOrNull() ?: 0.0
        if (max <= 0.0) return emptyMap()
        return map.mapValues { it.value / max }
    }

    private fun recencyWeight(playedAt: Long, now: Long): Double {
        val days = max(0.0, (now - playedAt) / DAY_MS)
        return when {
            days <= 7 -> 1.0
            days <= 30 -> 0.65
            days <= 90 -> 0.35
            else -> 0.15
        }
    }

    private fun daysSince(playedAt: Long, now: Long): Double =
        max(0.0, (now - playedAt) / DAY_MS)

    /** Matches the JS UTF-16 hash and `Math.abs(hash) % 4`. */
    private fun jitter(signature: String, id: String): Int {
        var hash = 0
        for (char in "$signature|$id") hash = hash * 31 + char.code
        return (abs(hash.toLong()) % 4).toInt()
    }

    private data class Candidate(
        val entity: MediaItemEntity,
        val lastPlayedAt: Long?,
        val playCount: Int,
    )

    private data class Reason(
        val code: String,
        val label: String,
        val weight: Double,
    )

    private data class Scored(
        val entity: MediaItemEntity,
        val score: Double,
        val reasons: List<Reason>,
    )

    private data class Profile(
        val artist: Map<String, Double>,
        val genre: Map<String, Double>,
        val album: Map<String, Double>,
    )

    fun build(
        tracks: List<MediaItemEntity>,
        favorites: Set<String>,
        recent: List<RecentEntity>,
        now: Long = System.currentTimeMillis(),
    ): CarSnapshot {
        val byId = tracks.filter { !it.missing }.associateBy { it.id }
        val recentById = recent
            .filter { it.trackId in byId }
            .groupBy { it.trackId }
            .mapValues { (_, rows) ->
                rows.maxByOrNull { it.playedAt } ?: rows.first()
            }
        val candidates = tracks
            .filter { !it.missing }
            .map { Candidate(it, recentById[it.id]?.playedAt, recentById[it.id]?.playCount ?: 0) }

        val ranked = rank(candidates, byId, favorites, recent, now)
            .take(CANDIDATE_LIMIT)

        val rediscoverIds = tracks
            .filter { track ->
                if (track.missing) return@filter false
                if (favorites.contains(track.id) && recentById[track.id] == null) return@filter true
                val playedAt = recentById[track.id]?.playedAt ?: return@filter false
                now - playedAt > 30L * 86_400_000L
            }
            .map { it.id }
            .toSet()

        val rediscover = ranked.filter { it.entity.id in rediscoverIds }.take(MIX_LIMIT)
        val deepCuts = ranked.filter { entry ->
            entry.reasons.any { it.code == "artist-affinity" || it.code == "album-affinity" }
        }.take(MIX_LIMIT)

        val rankedIndex = ranked.mapIndexed { index, entry -> entry.entity.id to index }.toMap()
        val favoriteTracks = favorites
            .mapNotNull { byId[it] }
            .sortedWith(
                compareBy<MediaItemEntity>(
                    { rankedIndex[it.id] ?: Int.MAX_VALUE },
                    { it.title },
                    { it.id },
                ),
            )
            .take(MIX_LIMIT)

        val mixes = listOfNotNull(
            mix(
                "daily-drift",
                "Daily drift",
                "Favorites + today's plays",
                ranked.take(MIX_LIMIT).map { it.entity.id },
                ranked.take(MIX_LIMIT).associate { it.entity.id to (it.reasons.firstOrNull()?.label ?: "Picked for you") },
            ),
            mix(
                "rediscover",
                "Rediscover",
                "Not played in 30+ days",
                rediscover.map { it.entity.id },
                rediscover.associate { it.entity.id to REDISCOVER_REASON },
            ),
            mix(
                "deep-cuts",
                "Deep cuts",
                "More from your top artists",
                deepCuts.map { it.entity.id },
                deepCuts.associate { it.entity.id to ARTIST_REASON },
            ),
            mix(
                "favorites-radio",
                "Favorites radio",
                "One tap, already familiar",
                favoriteTracks.map { it.id },
                favoriteTracks.associate { it.id to FAVORITE_REASON },
            ),
        )
        return CarSnapshot(
            generatedAt = generatedAtFormatter.format(Instant.ofEpochMilli(now)),
            mixes = mixes,
        )
    }

    private fun rank(
        candidates: List<Candidate>,
        byId: Map<String, MediaItemEntity>,
        favorites: Set<String>,
        recent: List<RecentEntity>,
        now: Long,
    ): List<Scored> {
        val seeds = recent
            .mapNotNull { byId[it.trackId] }
            .distinctBy { it.id }
            .take(3)
        val signature = if (seeds.isEmpty()) "library" else seeds.map { it.id }.sorted().joinToString("|")

        val profile = buildProfile(byId, favorites, recent, now)
        val artistAffinity = normalized(profile.artist)
        val genreAffinity = normalized(profile.genre)
        val albumAffinity = normalized(profile.album)

        val scored = candidates.mapNotNull { candidate ->
            val track = candidate.entity
            val days = candidate.lastPlayedAt?.let { daysSince(it, now) }
            if (days != null && days < RECENT_EXCLUSION_DAYS) return@mapNotNull null

            var score = 0.0
            val reasons = mutableListOf<Reason>()
            val favorite = track.id in favorites

            if (favorite) {
                score += FAVORITE
                reasons += Reason("favorite", FAVORITE_REASON, FAVORITE)
            }

            val artistWeight = artistAffinity[norm(track.artist)] ?: 0.0
            if (artistWeight > 0.0) {
                val weight = artistWeight * ARTIST_AFFINITY
                score += weight
                reasons += Reason(
                    "artist-affinity",
                    "More from ${track.artist.ifBlank { "an artist you play" }}",
                    weight,
                )
            }

            val genre = genresOf(track)
                .map { it to (genreAffinity[it.second] ?: 0.0) }
                .filter { it.second > 0.0 }
                .maxByOrNull { it.second }
            if (genre != null) {
                val weight = genre.second * GENRE_AFFINITY
                score += weight
                reasons += Reason(
                    "genre-affinity",
                    "Matches your ${genre.first.first} listening",
                    weight,
                )
            }

            val albumWeight = albumAffinity[norm(track.album)] ?: 0.0
            if (albumWeight > 0.0) {
                val weight = albumWeight * ALBUM_AFFINITY
                score += weight
                reasons += Reason(
                    "album-affinity",
                    "From ${track.album.ifBlank { "an album you play" }}",
                    weight,
                )
            }

            val similar = seeds
                .filter { it.id != track.id }
                .map { seed -> seed to RadioScorer.score(seed, track, false) / 80.0 }
                .filter { it.second > 0.0 }
                .maxByOrNull { it.second }
            if (similar != null) {
                val weight = min(1.0, similar.second) * SEED_SIMILARITY
                score += weight
                reasons += Reason("seed-similarity", SEED_REASON, weight)
            }

            if (days != null) {
                when {
                    days <= 2 -> score -= RECENT_WINDOW_PENALTY
                    days <= 7 -> score -= RECENT_WEEK_PENALTY
                    days > 30 -> {
                        score += REDISCOVER
                        reasons += Reason(
                            "rediscover",
                            if (favorite) "A favorite you have not played lately" else REDISCOVER_REASON,
                            REDISCOVER,
                        )
                    }
                }
            } else if (favorite) {
                score += REDISCOVER
                reasons += Reason("rediscover", "A favorite you have not played yet", REDISCOVER)
            } else {
                score += DISCOVERY
                reasons += Reason("discovery", DISCOVERY_REASON, DISCOVERY)
            }

            score += jitter(signature, track.id)
            val ordered = reasons.sortedByDescending { it.weight }.take(2).toMutableList()
            if (ordered.isEmpty()) {
                ordered += Reason("discovery", "A fresh pick from your library", 0.0)
            }
            Scored(track, (score * 10).roundToInt() / 10.0, ordered)
        }

        val sorted = scored.sortedWith(
            compareByDescending<Scored> { it.score }.thenBy { it.entity.id },
        )

        val picked = mutableListOf<Scored>()
        val deferred = mutableListOf<Scored>()
        val perArtist = mutableMapOf<String, Int>()
        for (entry in sorted) {
            val artist = norm(entry.entity.artist)
            val count = perArtist[artist] ?: 0
            if (artist.isNotEmpty() && count >= MAX_PER_ARTIST) {
                deferred += entry
                continue
            }
            picked += entry
            if (artist.isNotEmpty()) perArtist[artist] = count + 1
            if (picked.size == CANDIDATE_LIMIT) break
        }
        if (picked.size < CANDIDATE_LIMIT) {
            for (entry in deferred) {
                picked += entry
                if (picked.size == CANDIDATE_LIMIT) break
            }
        }
        return picked
    }

    private fun buildProfile(
        byId: Map<String, MediaItemEntity>,
        favorites: Set<String>,
        recent: List<RecentEntity>,
        now: Long,
    ): Profile {
        val artist = mutableMapOf<String, Double>()
        val genre = mutableMapOf<String, Double>()
        val album = mutableMapOf<String, Double>()

        for (id in favorites) {
            val track = byId[id] ?: continue
            if (track.missing) continue
            add(artist, norm(track.artist), 2.5)
            for (entry in genresOf(track)) add(genre, entry.second, 1.5)
            add(album, norm(track.album), 0.3)
        }

        for (entry in recent) {
            val track = byId[entry.trackId] ?: continue
            if (track.missing) continue
            val weight = recencyWeight(entry.playedAt, now) *
                (1.0 + min(1.0, ln(1.0 + entry.playCount) / 4.0))
            add(artist, norm(track.artist), weight)
            for (genreEntry in genresOf(track)) add(genre, genreEntry.second, weight * 0.8)
            add(album, norm(track.album), weight * 0.4)
        }

        return Profile(artist, genre, album)
    }

    private fun mix(
        id: String,
        title: String,
        subtitle: String,
        trackIds: List<String>,
        reasons: Map<String, String>,
    ): CarMix? {
        val unique = trackIds.distinct().take(MIX_LIMIT)
        if (unique.isEmpty()) return null
        return CarMix(
            id = id,
            title = title,
            subtitle = subtitle,
            trackIds = unique,
            reasons = unique.associateWith { reasons[it] ?: "For you" },
        )
    }
}
