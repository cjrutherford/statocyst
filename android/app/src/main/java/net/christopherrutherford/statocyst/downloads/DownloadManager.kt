package net.christopherrutherford.statocyst.downloads

import android.content.Context
import net.christopherrutherford.statocyst.db.DownloadEntity
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.Instant

/**
 * Protected (pinned) downloads: the Android counterpart of the Electron
 * DownloadService. Files live in `filesDir/downloads`, are written to a `.part`
 * file first, then verified by size and SHA-256 before a record is committed.
 * A download whose file disappeared or changed size is reported as unverified,
 * so the UI never advertises a file it cannot play.
 */
class DownloadManager(private val context: Context) {

    private val database = StatocystDatabase.getInstance(context)
    private val dao = database.downloadDao()
    private val mediaDao = database.mediaItemDao()
    private val directory = File(context.filesDir, "downloads")

    data class Outcome(val entity: DownloadEntity, val alreadyPresent: Boolean)

    fun download(
        trackId: String,
        onProgress: (received: Long, total: Long?, done: Boolean, error: String?) -> Unit,
    ): Outcome {
        val track = runBlockingLookup(trackId)
            ?: throw IllegalArgumentException("The track does not exist")
        directory.mkdirs()

        val ext = (track.ext.ifEmpty { track.format ?: "bin" }).lowercase()
        val finalFile = File(directory, "$trackId.$ext")
        val partFile = File(directory, "$trackId.$ext.part")

        // Already downloaded and intact: report it without touching the network.
        verifiedFile(trackId)?.let { return Outcome(requireNotNull(daoGet(trackId)), true) }

        if (finalFile.exists()) finalFile.delete()
        partFile.delete()

        try {
            if (track.sourceKind.startsWith("jellyfin")) {
                copyRemote(track, partFile, onProgress)
            } else {
                copyLocal(track, partFile, onProgress)
            }
            val size = partFile.length()
            if (size <= 0L) throw IllegalStateException("Downloaded file is empty")
            val digest = sha256(partFile)
            if (!partFile.renameTo(finalFile)) {
                partFile.copyTo(finalFile, overwrite = true)
                partFile.delete()
            }
            val entity = DownloadEntity(
                trackId = trackId,
                localPath = finalFile.absolutePath,
                sizeBytes = size,
                sha256 = digest,
                container = track.format ?: track.ext,
                verified = true,
                createdAt = Instant.now().toString(),
            )
            runBlockingWrite { dao.upsert(entity) }
            onProgress(size, size, true, null)
            return Outcome(entity, false)
        } catch (error: Exception) {
            partFile.delete()
            throw error
        }
    }

    fun remove(trackId: String): Boolean {
        val record = runBlockingRead { dao.get(trackId) }
        record?.let { File(it.localPath).delete() }
        // Remove any stale file even when the record is already gone.
        directory.listFiles()?.forEach { file ->
            if (file.name.startsWith("$trackId.")) file.delete()
        }
        val removed = runBlockingWrite { dao.delete(trackId) } > 0
        return removed || record != null
    }

    fun list(): List<DownloadEntity> = liveRecords()

    fun stats(): Pair<Int, Long> {
        val records = liveRecords()
        return records.size to records.sumOf { it.sizeBytes }
    }

    /**
     * Downloaded records whose file is still present at the recorded size.
     *
     * A record can outlive its file: the OS may reclaim app storage, or a user
     * can clear the folder. Such a record is unplayable, so it is dropped
     * instead of inflating the "saved" counter with 0-byte entries (the cache
     * reconciler does the same for its own manifest).
     */
    private fun liveRecords(): List<DownloadEntity> = runBlockingRead { dao.getAll() }
        .filter { record ->
            val file = File(record.localPath)
            val intact = record.verified && file.isFile && file.length() == record.sizeBytes && file.length() > 0
            if (!intact) dropStale(record)
            intact
        }

    private fun dropStale(record: DownloadEntity) {
        runBlockingWrite { dao.delete(record.trackId) }
        if (record.localPath.isNotEmpty()) File(record.localPath).delete()
        directory.listFiles()?.forEach { file ->
            if (file.name.startsWith("${record.trackId}.")) file.delete()
        }
    }

    /** The file for [trackId] only when it is present, non-empty and size-matched. */
    fun verifiedFile(trackId: String): File? {
        val record = runBlockingRead { dao.get(trackId) } ?: return null
        if (!record.verified) return null
        val file = File(record.localPath)
        if (!file.isFile || file.length() != record.sizeBytes || file.length() <= 0) return null
        return file
    }

    private fun copyRemote(
        track: MediaItemEntity,
        target: File,
        onProgress: (Long, Long?, Boolean, String?) -> Unit,
    ) {
        val prefs = context.getSharedPreferences("statocyst", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("jellyfin_url", null)
            ?: throw IllegalStateException("The server is not signed in")
        val token = prefs.getString("jellyfin_token", null)
            ?: throw IllegalStateException("The server is not signed in")
        val itemId = track.path.ifEmpty { track.id.removePrefix("jf-") }
        val connection = JellyfinAuth.open(JellyfinAuth.streamUrl(serverUrl, itemId), token)
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "*/*")
        try {
            val code = connection.responseCode
            if (code == 401 || code == 403) throw SecurityException("The stored session was rejected")
            if (code !in 200..299) throw IllegalStateException("The server returned HTTP $code")
            val total = connection.contentLengthLong.takeIf { it > 0 }
            connection.inputStream.use { input -> copyWithProgress(input, target, total, onProgress) }
        } finally {
            connection.disconnect()
        }
    }

    private fun copyLocal(
        track: MediaItemEntity,
        target: File,
        onProgress: (Long, Long?, Boolean, String?) -> Unit,
    ) {
        val source = File(track.path)
        if (!source.isFile) throw IllegalStateException("The source file is missing")
        FileInputStream(source).use { input ->
            copyWithProgress(input, target, source.length(), onProgress)
        }
    }

    private fun copyWithProgress(
        input: InputStream,
        target: File,
        total: Long?,
        onProgress: (Long, Long?, Boolean, String?) -> Unit,
    ) {
        val buffer = ByteArray(64 * 1024)
        var received = 0L
        var lastReport = 0L
        FileOutputStream(target).use { output ->
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                output.write(buffer, 0, read)
                received += read
                if (received - lastReport >= 256 * 1024) {
                    lastReport = received
                    onProgress(received, total, false, null)
                }
            }
            output.flush()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun daoGet(trackId: String) = runBlockingRead { dao.get(trackId) }

    private fun runBlockingLookup(trackId: String) = runBlockingRead { mediaDao.getById(trackId) }

    private fun <T> runBlockingRead(block: suspend () -> T): T = kotlinx.coroutines.runBlocking { block() }

    private fun <T> runBlockingWrite(block: suspend () -> T): T = kotlinx.coroutines.runBlocking { block() }
}
