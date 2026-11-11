package net.christopherrutherford.statocyst.downloads

import android.content.Context
import android.os.StatFs
import net.christopherrutherford.statocyst.db.DownloadEntity
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.podcast.PodcastUrls
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import net.christopherrutherford.statocyst.jellyfin.JellyfinSessions
import org.json.JSONArray
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

    companion object {
        private const val PART_MAX_AGE_MS = 24L * 60 * 60 * 1000
    }

    data class Outcome(val entity: DownloadEntity, val alreadyPresent: Boolean)

    /** Where the bytes for a pin come from and what the committed file should be. */
    private data class SourcePlan(
        val remoteKind: RemoteKind,
        val url: String?,
        val sourceExtension: String,
        val outputExtension: String,
        val transcode: Boolean,
        val serverTranscode: Boolean = false,
        val codec: String? = null,
        val sourceBytes: Long? = null,
    )

    private enum class RemoteKind { NONE, JELLYFIN, PODCAST }

    fun download(
        trackId: String,
        onProgress: (received: Long, total: Long?, done: Boolean, error: String?) -> Unit,
    ): Outcome = download(trackId, DownloadProfile.ORIGINAL, object : DownloadEvents {
        override fun progress(received: Long, total: Long?) = onProgress(received, total, false, null)
    })

    fun download(trackId: String, events: DownloadEvents): Outcome =
        download(trackId, DownloadProfile.ORIGINAL, events)

    fun download(
        trackId: String,
        profile: DownloadProfile,
        onProgress: (received: Long, total: Long?, done: Boolean, error: String?) -> Unit,
    ): Outcome = download(trackId, profile, object : DownloadEvents {
        override fun progress(received: Long, total: Long?) = onProgress(received, total, false, null)
    })

    fun download(
        trackId: String,
        profile: DownloadProfile,
        allowLocalNetwork: Boolean,
        onProgress: (received: Long, total: Long?, done: Boolean, error: String?) -> Unit,
    ): Outcome = download(trackId, profile, object : DownloadEvents {
        override fun progress(received: Long, total: Long?) = onProgress(received, total, false, null)
    }, allowLocalNetwork)

    /**
     * Downloads [trackId] at [profile], resuming a leftover `.part` file from an
     * earlier attempt and retrying transient network failures (see [ResumableDownload]).
     *
     * Podcast enclosures are ordinary HTTP(S) URLs and now use the same remote path
     * as Jellyfin (with the feed SSRF gate). Audio-only/480p/720p first download the
     * publisher bytes, then transcode to a temp file with Media3 Transformer; the
     * committed file is the compressed copy. Re-pinning at a different quality
     * replaces the old copy instead of silently keeping it.
     */
    fun download(
        trackId: String,
        profile: DownloadProfile,
        events: DownloadEvents,
        allowLocalNetwork: Boolean = false,
    ): Outcome {
        val track = runBlockingLookup(trackId)
            ?: throw IllegalArgumentException("The track does not exist")
        directory.mkdirs()

        val plan = planFor(track, profile)
        val finalFile = File(directory, "$trackId.${plan.outputExtension}")
        val partFile = File(directory, "$trackId.${plan.sourceExtension}.part")

        // Already downloaded at the requested quality: report it without touching the network.
        val existing = daoGet(trackId)
        if (existing != null && existing.profile == profile.wire) {
            verifiedFile(trackId)?.let { return Outcome(existing, true) }
        } else if (existing != null) {
            // Re-pin at a different quality: drop the old bytes first.
            remove(trackId)
        }

        if (finalFile.exists()) finalFile.delete()
        val remote = plan.remoteKind != RemoteKind.NONE
        // A partial file is only worth resuming for a remote track, and not when it is old.
        if (!remote || System.currentTimeMillis() - partFile.lastModified() > PART_MAX_AGE_MS) partFile.delete()

        var keepPart = false
        try {
            if (StatFs(context.filesDir.absolutePath).availableBytes < DownloadPolicy.RESERVE_BYTES) {
                throw IllegalStateException("Not enough free space to start this download")
            }
            if (remote) {
                try {
                    when (plan.remoteKind) {
                        RemoteKind.JELLYFIN -> copyJellyfin(track, profile, partFile, events)
                        RemoteKind.PODCAST -> copyPodcast(plan.url!!, allowLocalNetwork, partFile, events)
                        RemoteKind.NONE -> Unit
                    }
                } catch (error: java.io.IOException) {
                    keepPart = true
                    throw error
                }
            } else {
                copyLocal(track, partFile, events)
            }
            if (partFile.length() <= 0L) throw IllegalStateException("Downloaded file is empty")

            if (plan.transcode) {
                val temp = File(directory, "$trackId.transcode.${plan.outputExtension}.tmp")
                temp.delete()
                events.compressing(0)
                TransformerCompressor.compress(context, partFile, temp, profile, events)
                partFile.delete()
                commit(temp, finalFile)
            } else {
                commit(partFile, finalFile)
            }

            val size = finalFile.length()
            if (size <= 0L) throw IllegalStateException("The saved file is empty")
            val digest = sha256(finalFile)
            val entity = DownloadEntity(
                trackId = trackId,
                localPath = finalFile.absolutePath,
                sizeBytes = size,
                sha256 = digest,
                container = if (plan.transcode || plan.serverTranscode) plan.outputExtension else (track.format ?: track.ext),
                verified = true,
                createdAt = Instant.now().toString(),
                profile = profile.wire,
                codec = plan.codec ?: if (plan.transcode) profile.codec else track.codec,
                bitRate = if (plan.transcode) profile.bitRate else track.bitrate,
                sourceBytes = plan.sourceBytes ?: track.sizeBytes,
            )
            runBlockingWrite { dao.upsert(entity) }
            events.progress(size, size)
            return Outcome(entity, false)
        } catch (error: Exception) {
            if (!keepPart) partFile.delete()
            throw error
        }
    }

    private fun commit(source: File, target: File) {
        if (!source.renameTo(target)) {
            source.copyTo(target, overwrite = true)
            source.delete()
        }
    }

    private fun planFor(track: MediaItemEntity, profile: DownloadProfile): SourcePlan {
        // The fixed presets are for video podcast pins only; never mislabel another row.
        if (profile.compressed && track.sourceKind != "podcast") {
            throw IllegalArgumentException("Compressed copies are only available for podcast episodes")
        }
        val originalExt = track.ext.ifEmpty { track.format ?: "bin" }.lowercase()
        if (track.sourceKind.startsWith("jellyfin")) {
            return if (profile.serverTranscode) {
                val ext = profile.extension ?: "mp3"
                SourcePlan(RemoteKind.JELLYFIN, null, ext, ext, transcode = false, serverTranscode = true, codec = profile.codec)
            } else {
                SourcePlan(RemoteKind.JELLYFIN, null, originalExt, originalExt, transcode = false)
            }
        }
        val podcastHttp = track.sourceKind == "podcast" &&
            (track.path.startsWith("http://") || track.path.startsWith("https://"))
        if (podcastHttp) {
            if (profile == DownloadProfile.AUDIO_ONLY) {
                val alternate = audioAlternate(track)
                if (alternate != null) {
                    return SourcePlan(
                        RemoteKind.PODCAST,
                        alternate.url,
                        alternate.extension,
                        alternate.extension,
                        transcode = false,
                        codec = alternate.codec,
                        sourceBytes = alternate.lengthBytes,
                    )
                }
                return SourcePlan(
                    RemoteKind.PODCAST,
                    track.path,
                    originalExt,
                    "m4a",
                    transcode = true,
                    codec = "aac",
                )
            }
            if (profile.compressed) {
                return SourcePlan(
                    RemoteKind.PODCAST,
                    track.path,
                    originalExt,
                    profile.extension ?: "mp4",
                    transcode = true,
                    codec = profile.codec,
                )
            }
            return SourcePlan(RemoteKind.PODCAST, track.path, originalExt, originalExt, transcode = false)
        }
        if (profile.compressed) {
            return SourcePlan(
                RemoteKind.NONE,
                null,
                originalExt,
                profile.extension ?: "m4a",
                transcode = true,
                codec = profile.codec,
            )
        }
        return SourcePlan(RemoteKind.NONE, null, originalExt, profile.extension ?: originalExt, transcode = false)
    }

    private data class Alternate(
        val url: String,
        val extension: String,
        val codec: String?,
        val lengthBytes: Long?,
    )

    /**
     * The feed's own audio alternate, when it published one. Using it avoids a
     * transcode entirely; the compressed-audio fallback is only for video-only items.
     */
    private fun audioAlternate(track: MediaItemEntity): Alternate? {
        val episode = runBlockingRead { database.podcastDao().getEpisodeByMediaItem(track.id) } ?: return null
        val array = runCatching { JSONArray(episode.alternatesJson ?: "[]") }.getOrNull() ?: return null
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val url = item.optString("url")
            if (!url.startsWith("http://") && !url.startsWith("https://")) continue
            val type = item.optString("type").substringBefore(';').trim().lowercase()
            val form = item.optString("form")
            if (form != "audio" && !type.startsWith("audio/")) continue
            val extension = extensionFor(type, url).takeIf { it != "bin" } ?: "m4a"
            return Alternate(
                url = url,
                extension = extension,
                codec = type.takeIf { it.isNotEmpty() },
                lengthBytes = if (item.has("lengthBytes") && !item.isNull("lengthBytes")) item.optLong("lengthBytes") else null,
            )
        }
        return null
    }

    private fun extensionFor(type: String, url: String): String {
        val byType = mapOf(
            "audio/mpeg" to "mp3",
            "audio/mp3" to "mp3",
            "audio/mp4" to "m4a",
            "audio/x-m4a" to "m4a",
            "audio/aac" to "aac",
            "audio/ogg" to "ogg",
            "audio/opus" to "opus",
            "audio/wav" to "wav",
            "audio/flac" to "flac",
            "audio/webm" to "webm",
        )
        byType[type]?.let { return it }
        val candidate = url.substringBefore('?').substringAfterLast('.', "").lowercase()
        return if (candidate in byType.values) candidate else "bin"
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

    /**
     * The presentation a pinned copy can actually deliver. An audio-only pin of a
     * video episode must not ask for a video surface when it plays offline.
     */
    fun playbackMediaForm(trackId: String, fallback: String): String {
        val record = daoGet(trackId) ?: return fallback
        return if (record.profile == DownloadProfile.AUDIO_ONLY.wire) "audio" else fallback
    }

    private fun copyJellyfin(
        track: MediaItemEntity,
        profile: DownloadProfile,
        target: File,
        events: DownloadEvents,
    ) {
        val session = JellyfinSessions.forTrack(context, track)
            ?: throw IllegalStateException("The server is not signed in")
        val serverUrl = session.url
        val token = session.token
        val itemId = track.path.ifEmpty { track.id.removePrefix("jf-") }
        val url = when {
            profile.serverTranscode -> JellyfinAuth.transcodeUrl(serverUrl, itemId, profile.bitRate!!.toLong())
            else -> JellyfinAuth.streamUrl(serverUrl, itemId)
        }
        ResumableDownload.fetch(
            open = { rangeStart ->
                JellyfinAuth.open(url, token).also {
                    it.connectTimeout = 15_000
                    it.readTimeout = 30_000
                    it.instanceFollowRedirects = false
                    it.setRequestProperty("Accept", "*/*")
                    if (rangeStart > 0) it.setRequestProperty("Range", "bytes=$rangeStart-")
                }
            },
            target = target,
            events = events,
        )
    }

    /**
     * Direct publisher enclosure download (S059 parity with iOS/desktop). The URL is
     * revalidated on every attempt and redirect by [PodcastUrls], so a pinned episode
     * cannot bypass the feed SSRF policy.
     */
    private fun copyPodcast(
        url: String,
        allowLocalNetwork: Boolean,
        target: File,
        events: DownloadEvents,
    ) {
        ResumableDownload.fetch(
            open = { rangeStart ->
                PodcastUrls.open(url, allowLocalNetwork, rangeStart)
            },
            target = target,
            events = events,
        )
    }

    private fun copyLocal(track: MediaItemEntity, target: File, events: DownloadEvents) {
        val source = File(track.path)
        if (!source.isFile) throw IllegalStateException("The source file is missing")
        val total = source.length()
        FileInputStream(source).use { input ->
            FileOutputStream(target).use { output ->
                val buffer = ByteArray(64 * 1024)
                var received = 0L
                var lastReport = 0L
                while (true) {
                    if (events.cancelled()) throw DownloadCancelled()
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                    received += read
                    if (received - lastReport >= 256 * 1024) {
                        lastReport = received
                        events.progress(received, total)
                    }
                }
                output.flush()
            }
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
