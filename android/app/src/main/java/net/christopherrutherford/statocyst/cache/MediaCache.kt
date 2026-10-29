package net.christopherrutherford.statocyst.cache

import android.content.Context
import android.os.StatFs
import net.christopherrutherford.statocyst.db.CacheEntryEntity
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import net.christopherrutherford.statocyst.jellyfin.JellyfinSessions
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.runBlocking

/**
 * Rolling, evictable audio cache. Prefetched tracks land in `filesDir/cache`,
 * are served locally on later plays, and are evicted least-recently-used when
 * the budget is exceeded. Pinned downloads never enter this store.
 *
 * The effective budget is the user's setting clamped by free disk space: under
 * pressure it shrinks to a quarter of the free space with a floor of 64 MiB, and
 * `pressure` is reported so the UI can say the budget was reduced.
 */
class MediaCache(private val context: Context) {

    private val database = StatocystDatabase.getInstance(context)
    private val dao = database.cacheDao()
    private val mediaDao = database.mediaItemDao()
    private val directory = File(context.filesDir, "cache")

    data class Stats(val bytes: Long, val entries: Int, val budgetBytes: Long, val pressure: Boolean)

    fun lookup(trackId: String): File? {
        val record = runBlocking { dao.get(trackId) } ?: return null
        val file = File(record.localPath)
        if (!file.isFile || file.length() != record.sizeBytes || file.length() <= 0) {
            runBlocking { dao.delete(trackId) }
            file.delete()
            return null
        }
        runBlocking { dao.touch(trackId, System.currentTimeMillis()) }
        return file
    }

    fun stats(requestedBudget: Long): Stats {
        val (budget, pressure) = effectiveBudget(requestedBudget)
        val bytes = runBlocking { dao.totalBytes() }
        val entries = runBlocking { dao.count() }
        return Stats(bytes, entries, budget, pressure)
    }

    fun budget(requestedBudget: Long): Long = effectiveBudget(requestedBudget).first

    /**
     * Makes [trackId] available locally. Returns the cached file, or null when
     * the track is local-only, already missing, or cannot be fetched.
     */
    fun prefetch(
        trackId: String,
        requestedBudget: Long,
        onProgress: (received: Long, total: Long?) -> Unit = { _, _ -> },
    ): File? {
        lookup(trackId)?.let { return it }
        val track = runBlocking { mediaDao.getById(trackId) } ?: return null
        if (!track.sourceKind.startsWith("jellyfin")) return null

        directory.mkdirs()
        val ext = (track.ext.ifEmpty { track.format ?: "bin" }).lowercase()
        val finalFile = File(directory, "$trackId.$ext")
        val partFile = File(directory, "$trackId.$ext.part")

        val session = JellyfinSessions.forTrack(context, track) ?: return null
        val serverUrl = session.url
        val token = session.token
        val itemId = track.path.ifEmpty { track.id.removePrefix("jf-") }

        val budget = budget(requestedBudget)
        if (budget <= 0) return null

        try {
            val connection = JellyfinAuth.open(JellyfinAuth.streamUrl(serverUrl, itemId), token)
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "*/*")
            try {
                val code = connection.responseCode
                if (code !in 200..299) return null
                val total = connection.contentLengthLong.takeIf { it > 0 }
                val buffer = ByteArray(64 * 1024)
                var received = 0L
                connection.inputStream.use { input ->
                    FileOutputStream(partFile).use { output ->
                        while (true) {
                            val read = input.read(buffer)
                            if (read <= 0) break
                            received += read
                            // Stop early rather than blow the budget on one track.
                            if (received > budget) {
                                output.flush()
                                partFile.delete()
                                return null
                            }
                            output.write(buffer, 0, read)
                            onProgress(received, total)
                        }
                        output.flush()
                    }
                }
            } finally {
                connection.disconnect()
            }
            if (partFile.length() <= 0) {
                partFile.delete()
                return null
            }
            if (finalFile.exists()) finalFile.delete()
            if (!partFile.renameTo(finalFile)) {
                partFile.copyTo(finalFile, overwrite = true)
                partFile.delete()
            }
            val now = System.currentTimeMillis()
            runBlocking {
                dao.upsert(
                    CacheEntryEntity(
                        trackId = trackId,
                        localPath = finalFile.absolutePath,
                        sizeBytes = finalFile.length(),
                        container = track.format ?: track.ext,
                        createdAt = now,
                        lastAccessAt = now,
                    ),
                )
            }
            trimToBudget(budget)
            return if (finalFile.isFile) finalFile else null
        } catch (error: Exception) {
            partFile.delete()
            return null
        }
    }

    /** Drops least-recently-used entries until the cache fits [budget]. */
    fun trimToBudget(budget: Long) {
        var total = runBlocking { dao.totalBytes() }
        if (total <= budget) return
        val entries = runBlocking { dao.getAll() }.sortedBy { it.lastAccessAt }
        for (entry in entries) {
            if (total <= budget) break
            File(entry.localPath).delete()
            runBlocking { dao.delete(entry.trackId) }
            total -= entry.sizeBytes
        }
    }

    fun clear(): Int {
        val entries = runBlocking { dao.getAll() }
        var removed = 0
        for (entry in entries) {
            if (File(entry.localPath).delete() || !File(entry.localPath).exists()) removed++
            runBlocking { dao.delete(entry.trackId) }
        }
        directory.listFiles()?.forEach { it.delete() }
        return removed
    }

    /**
     * Reconciles records with the filesystem: drops records whose file vanished
     * or changed size, and deletes files no record points at.
     */
    fun reconcile(): Pair<Int, Int> {
        val entries = runBlocking { dao.getAll() }
        val known = entries.map { it.localPath }.toSet()
        var removedEntries = 0
        for (entry in entries) {
            val file = File(entry.localPath)
            if (!file.isFile || file.length() != entry.sizeBytes) {
                file.delete()
                runBlocking { dao.delete(entry.trackId) }
                removedEntries++
            }
        }
        var removedOrphans = 0
        directory.listFiles()?.forEach { file ->
            if (file.absolutePath !in known) {
                if (file.delete()) removedOrphans++
            }
        }
        return removedEntries to removedOrphans
    }

    private fun effectiveBudget(requested: Long): Pair<Long, Boolean> {
        val requestedClamped = requested.coerceAtLeast(0L)
        val stat = StatFs(context.filesDir.absolutePath)
        val free = stat.availableBytes
        val floor = 64L * 1024 * 1024
        val fromFree = (free / 4).coerceAtLeast(floor)
        if (requestedClamped <= fromFree) return requestedClamped to false
        return minOf(requestedClamped, fromFree) to true
    }
}
