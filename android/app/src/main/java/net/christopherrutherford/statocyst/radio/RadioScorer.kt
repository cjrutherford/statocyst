package net.christopherrutherford.statocyst.radio

import net.christopherrutherford.statocyst.db.MediaItemEntity
import kotlin.math.abs

/**
 * Local "song radio": ranks the library by how alike each track is to a seed, from
 * metadata only (no network, no audio analysis). Mirrors the TypeScript scorer in
 * apps/desktop/src/app/core/radio.ts; keep the weights in sync.
 */
object RadioScorer {
    const val DEFAULT_LIMIT = 50
    private const val SAME_ARTIST = 40
    private const val SAME_ALBUM_ARTIST = 10
    private const val SAME_ALBUM = 25
    private const val SHARED_GENRE = 30
    private const val YEAR_CLOSE = 10
    private const val YEAR_NEAR = 5
    private const val FAVORITE = 5
    private const val MAX_RUN_BY_ARTIST = 2

    /** "radio for X", "songs like X", "similar to X" (group 1) and "X radio" (group 2). */
    private val PHRASE = Regex(
        "^(?:(?:play|start|put on)\\s+)?(?:(?:a\\s+)?radio\\s+(?:for|from|based on|of)|(?:songs?|music|something|tracks?)\\s+(?:like|similar to)|similar to)\\s+(.+)$" +
            "|^(?:(?:play|start|put on)\\s+)?(.+?)\\s+radio$",
        RegexOption.IGNORE_CASE,
    )

    /** The song/artist named in a voice request for a radio ("songs like X"), or null if it is not one. */
    fun seedQueryOf(query: String): String? =
        PHRASE.find(query.trim())?.let { m -> m.groupValues[1].ifBlank { m.groupValues[2] } }?.trim()?.takeIf { it.isNotEmpty() && !it.equals("play", true) && !it.equals("start", true) }

    private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")

    private fun norm(text: String?): String =
        (text ?: "").lowercase().replace(NON_WORD, " ").trim()

    private fun genres(text: String?): Set<String> =
        (text ?: "").split(',', ';', '/', '|').map(::norm).filter { it.isNotEmpty() }.toSet()

    /** Stable pseudo-random 0..4, so equal scores come out in a varied but repeatable order. */
    private fun jitter(seedId: String, id: String): Int = abs((seedId + "|" + id).hashCode()) % 5

    fun score(seed: MediaItemEntity, c: MediaItemEntity, favorite: Boolean): Int {
        var s = 0
        val artist = norm(seed.artist)
        if (artist.isNotEmpty() && artist == norm(c.artist)) s += SAME_ARTIST
        val albumArtist = norm(seed.albumArtist)
        if (albumArtist.isNotEmpty() && albumArtist == norm(c.albumArtist) && artist != norm(c.artist)) s += SAME_ALBUM_ARTIST
        val album = norm(seed.album)
        if (album.isNotEmpty() && album == norm(c.album)) s += SAME_ALBUM
        if (genres(seed.genre).intersect(genres(c.genre)).isNotEmpty()) s += SHARED_GENRE
        val sy = seed.year
        val cy = c.year
        if (sy != null && cy != null && sy > 0 && cy > 0) {
            val d = abs(sy - cy)
            s += if (d <= 3) YEAR_CLOSE else if (d <= 10) YEAR_NEAR else 0
        }
        if (favorite) s += FAVORITE
        return s
    }

    /**
     * Up to [limit] track ids similar to [seed], best first, never the seed itself.
     * Falls back to a stable shuffle of the rest of the library so a small or
     * untagged library still yields a radio.
     */
    fun build(
        seed: MediaItemEntity,
        library: List<MediaItemEntity>,
        favorites: Set<String> = emptySet(),
        limit: Int = DEFAULT_LIMIT,
        exclude: Set<String> = emptySet(),
    ): List<String> {
        val ranked = library
            .filter { it.id != seed.id && !it.missing && it.id !in exclude }
            .map { it to (score(seed, it, it.id in favorites) * 10 + jitter(seed.id, it.id)) }
            .sortedWith(compareByDescending<Pair<MediaItemEntity, Int>> { it.second }.thenBy { it.first.id })
            .map { it.first }
        return diversify(ranked, limit).map { it.id }
    }

    /**
     * Keeps one artist from filling several slots in a row when others are available.
     * Stops after [limit] picks and normalizes each artist once, so a 10,000-track library
     * (or one artist with thousands of tracks) stays fast.
     */
    private fun diversify(ranked: List<MediaItemEntity>, limit: Int): List<MediaItemEntity> {
        val rest = ArrayList(ranked)
        val artists = HashMap<String, String>(rest.size)
        fun artistOf(item: MediaItemEntity) = artists.getOrPut(item.id) { norm(item.artist) }
        val out = ArrayList<MediaItemEntity>(minOf(limit, rest.size))
        var lastArtist: String? = null
        var run = 0
        var head = 0
        val taken = BooleanArray(rest.size)
        while (out.size < limit && head < rest.size) {
            while (head < rest.size && taken[head]) head++
            if (head >= rest.size) break
            var pick = head
            if (lastArtist != null && run >= MAX_RUN_BY_ARTIST) {
                var i = head
                while (i < rest.size && (taken[i] || artistOf(rest[i]) == lastArtist)) i++
                if (i < rest.size) pick = i
            }
            taken[pick] = true
            val item = rest[pick]
            val artist = artistOf(item)
            run = if (artist == lastArtist) run + 1 else 1
            lastArtist = artist
            out.add(item)
        }
        return out
    }
}
