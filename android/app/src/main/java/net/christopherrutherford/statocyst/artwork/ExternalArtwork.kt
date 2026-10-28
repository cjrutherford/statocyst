package net.christopherrutherford.statocyst.artwork

import net.christopherrutherford.statocyst.jellyfin.JellyfinArtwork
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Disk-cached cover and artist images from MusicBrainz and friends. A lookup
 * that finds nothing is remembered for a week and one that failed to reach the
 * service for fifteen minutes, so a big library does not hammer the API.
 */
class ExternalArtwork(
    private val dir: File,
    private val client: MusicBrainzClient,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val locks = ConcurrentHashMap<String, Any>()
    private val waiting = AtomicInteger()

    fun cover(artist: String, album: String): File? {
        if (!worthLooking(artist) || !worthLooking(album)) return null
        return cached(key("cover", artist, album)) {
            client.releaseGroupId(artist, album)?.let(client::coverBytes)
        }
    }

    fun artist(name: String): File? {
        if (!worthLooking(name)) return null
        return cached(key("artist", name, "")) {
            client.artistId(name)?.let(client::artistImageBytes)
        }
    }

    private fun cached(key: String, lookup: () -> ByteArray?): File? {
        dir.mkdirs()
        val target = File(dir, key)
        hit(target)?.let { return it }
        if (missActive(key)) return null
        // Too many callers already queued behind the rate limit: skip without remembering a miss.
        if (waiting.incrementAndGet() > MAX_WAITING) {
            waiting.decrementAndGet()
            return null
        }
        try {
            synchronized(locks.computeIfAbsent(key) { Any() }) {
                hit(target)?.let { return it }
                if (missActive(key)) return null
                return try {
                    val bytes = lookup()
                    if (bytes == null || bytes.isEmpty() || JellyfinArtwork.sniffMime(bytes.copyOf(16)) == null) {
                        remember(key, MISS_TTL_MS)
                        null
                    } else {
                        val tmp = File(dir, "$key.part")
                        tmp.writeBytes(bytes)
                        if (!tmp.renameTo(target)) {
                            tmp.delete()
                            null
                        } else {
                            prune()
                            target
                        }
                    }
                } catch (_: IOException) {
                    remember(key, RETRY_TTL_MS)
                    null
                }
            }
        } finally {
            waiting.decrementAndGet()
            locks.remove(key)
        }
    }

    private fun hit(target: File): File? =
        target.takeIf { it.isFile && it.length() > 0 }?.also { it.setLastModified(now()) }

    private fun marker(key: String) = File(dir, "$key.miss")

    private fun missActive(key: String): Boolean {
        val m = marker(key)
        if (!m.isFile) return false
        val until = m.readText().trim().toLongOrNull() ?: 0L
        if (until > now()) return true
        m.delete()
        return false
    }

    private fun remember(key: String, ttlMs: Long) {
        marker(key).writeText((now() + ttlMs).toString())
    }

    private fun prune() {
        val files = dir.listFiles { f -> f.isFile && !f.name.endsWith(".part") && !f.name.endsWith(".miss") } ?: return
        var size = files.sumOf { it.length() }
        if (size <= MAX_CACHE_BYTES) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (size <= MAX_CACHE_BYTES * 3 / 4) break
            size -= f.length()
            f.delete()
        }
    }

    companion object {
        const val MISS_TTL_MS = 7L * 24 * 60 * 60 * 1000
        const val RETRY_TTL_MS = 15L * 60 * 1000
        private const val MAX_CACHE_BYTES = 48L * 1024 * 1024
        private const val MAX_WAITING = 8
        private const val MAX_NAME = 200

        /** Placeholder tags the importers use for missing metadata are not worth a lookup. */
        fun worthLooking(name: String?): Boolean {
            val n = name?.trim().orEmpty()
            return n.isNotEmpty() && n.length <= MAX_NAME &&
                !n.equals("Unknown artist", true) && !n.equals("Unknown album", true)
        }

        fun key(kind: String, a: String, b: String): String {
            fun norm(s: String) = s.trim().lowercase().replace(Regex("\\s+"), " ")
            return MessageDigest.getInstance("SHA-256")
                .digest("$kind|${norm(a)}|${norm(b)}".toByteArray())
                .joinToString("") { "%02x".format(it) }
        }
    }
}
