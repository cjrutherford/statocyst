package net.christopherrutherford.statocyst.library

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking

/**
 * On-device library import through the Storage Access Framework.
 *
 * Audio is copied into `filesDir/library` (the picker grant is not durable), then
 * indexed with whatever metadata `MediaMetadataRetriever` can read. The copied
 * file becomes the track path, so imported tracks behave exactly like Jellyfin
 * tracks for playback, queueing, downloads and caching.
 */
class LibraryImporter(private val context: Context) {

    companion object {
        const val SOURCE_ID = "local"
        const val SOURCE_LABEL = "This device"

        private val EXTENSIONS = setOf(
            "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wave", "alac", "wma", "aiff", "aif",
        )
    }

    private val database = StatocystDatabase.getInstance(context)
    private val dao = database.mediaItemDao()
    private val directory = File(context.filesDir, "library")

    data class Summary(
        val imported: List<MediaItemEntity>,
        val duplicates: Int,
        val missing: Int,
        val rejected: List<Pair<String, String>>,
        val cancelled: Boolean = false,
    )

    /** Imports individual documents chosen with ACTION_OPEN_DOCUMENT. */
    fun importDocuments(uris: List<Uri>, onProgress: (scanned: Int, imported: Int) -> Unit): Summary {
        val imported = mutableListOf<MediaItemEntity>()
        val rejected = mutableListOf<Pair<String, String>>()
        var duplicates = 0
        var missing = 0
        uris.forEachIndexed { index, uri ->
            val name = displayName(uri) ?: uri.lastPathSegment ?: "audio"
            if (!isAudio(name)) {
                rejected.add(name to "UNSUPPORTED_FORMAT")
                return@forEachIndexed
            }
            try {
                val existing = runBlocking { dao.getByPathKey(keyFor(uri)) }
                if (existing != null) {
                    duplicates++
                } else {
                    val entity = importOne(uri, name)
                    if (entity == null) missing++ else imported.add(entity)
                }
            } catch (error: Exception) {
                rejected.add(name to (error.message ?: "IMPORT_FAILED"))
            }
            onProgress(index + 1, imported.size)
        }
        return Summary(imported, duplicates, missing, rejected)
    }

    /** Recursively imports every audio document below a tree picked with ACTION_OPEN_DOCUMENT_TREE. */
    fun importTree(treeUri: Uri, onProgress: (scanned: Int, imported: Int) -> Unit): Summary {
        val imported = mutableListOf<MediaItemEntity>()
        val rejected = mutableListOf<Pair<String, String>>()
        var duplicates = 0
        var missing = 0
        var scanned = 0
        val pending = ArrayDeque<String>()
        pending.add(DocumentsContract.getTreeDocumentId(treeUri))

        while (pending.isNotEmpty()) {
            val documentId = pending.removeFirst()
            val children = queryChildren(treeUri, documentId)
            for (child in children) {
                scanned++
                if (child.mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
                    pending.add(child.documentId)
                    continue
                }
                if (!isAudio(child.name)) continue
                val uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, child.documentId)
                try {
                    val existing = runBlocking { dao.getByPathKey(keyFor(uri)) }
                    if (existing != null) {
                        duplicates++
                    } else {
                        val entity = importOne(uri, child.name)
                        if (entity == null) missing++ else imported.add(entity)
                    }
                } catch (error: Exception) {
                    rejected.add(child.name to (error.message ?: "IMPORT_FAILED"))
                }
                onProgress(scanned, imported.size)
            }
        }
        return Summary(imported, duplicates, missing, rejected)
    }

    /**
     * Imports absolute file paths, for example a file shared into the app by a
     * file manager. The source is copied into the library so the index stays
     * valid after the original is moved or its permission is revoked.
     */
    fun importFiles(paths: List<String>, onProgress: (scanned: Int, imported: Int) -> Unit): Summary {
        val imported = mutableListOf<MediaItemEntity>()
        val rejected = mutableListOf<Pair<String, String>>()
        var duplicates = 0
        var missing = 0
        paths.forEachIndexed { index, rawPath ->
            val source = File(rawPath)
            val name = source.name.ifEmpty { "audio" }
            if (!isAudio(name)) {
                rejected.add(rawPath to "UNSUPPORTED_FORMAT")
                return@forEachIndexed
            }
            if (!source.isFile) {
                missing++
                return@forEachIndexed
            }
            try {
                val existing = runBlocking { dao.getByPathKey(keyFor(source)) }
                if (existing != null) {
                    duplicates++
                } else {
                    val entity = importOne(source, name)
                    if (entity == null) missing++ else imported.add(entity)
                }
            } catch (error: Exception) {
                rejected.add(rawPath to (error.message ?: "IMPORT_FAILED"))
            }
            onProgress(index + 1, imported.size)
        }
        return Summary(imported, duplicates, missing, rejected)
    }

    fun removeTrack(trackId: String): Boolean {
        val entity = runBlocking { dao.getById(trackId) } ?: return false
        if (entity.sourceKind == "local") {
            File(entity.path).delete()
        }
        runBlocking { dao.deleteById(trackId) }
        return true
    }

    fun stats(): Triple<Int, Int, Long> {
        val tracks = runBlocking { dao.getAll() }
        return Triple(tracks.size, tracks.map { it.album }.distinct().size, tracks.sumOf { it.durationMs })
    }

    private fun importOne(uri: Uri, name: String): MediaItemEntity? =
        importOne(name, keyFor(uri), { context.contentResolver.openInputStream(uri) }) { retriever ->
            retriever.setDataSource(context, uri)
        }

    private fun importOne(source: File, name: String): MediaItemEntity? =
        importOne(name, keyFor(source), { source.inputStream() }) { retriever ->
            retriever.setDataSource(source.absolutePath)
        }

    private fun importOne(
        name: String,
        pathKey: String,
        open: () -> java.io.InputStream?,
        bind: (MediaMetadataRetriever) -> Unit,
    ): MediaItemEntity? {
        directory.mkdirs()
        val ext = name.substringAfterLast('.', "").lowercase().ifEmpty { "audio" }
        val id = "local-" + UUID.randomUUID()
        val target = File(directory, "$id.$ext")

        open()?.use { input ->
            target.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
        } ?: return null
        if (target.length() <= 0) {
            target.delete()
            return null
        }

        val metadata = readMetadata(name, bind)
        val now = Instant.now().toString()
        val entity = MediaItemEntity(
            id = id,
            sourceId = SOURCE_ID,
            path = target.absolutePath,
            pathKey = pathKey,
            fileName = name,
            ext = ext,
            sizeBytes = target.length(),
            mtimeMs = System.currentTimeMillis(),
            title = metadata.title,
            artist = metadata.artist,
            album = metadata.album,
            albumArtist = metadata.albumArtist,
            trackNo = metadata.trackNo,
            discNo = metadata.discNo,
            year = metadata.year,
            genre = metadata.genre,
            durationMs = metadata.durationMs,
            bitrate = metadata.bitrate,
            sampleRate = metadata.sampleRate,
            channels = metadata.channels,
            codec = metadata.codec,
            format = ext,
            artworkPath = null,
            jellyfinImageTag = null,
            albumId = null,
            sourceKind = "local",
            sourceLabel = SOURCE_LABEL,
            addedAt = now,
            updatedAt = now,
        )
        runBlocking { dao.upsert(entity) }
        return entity
    }

    private data class Metadata(
        val title: String,
        val artist: String,
        val album: String,
        val albumArtist: String?,
        val trackNo: Int?,
        val discNo: Int?,
        val year: Int?,
        val genre: String?,
        val durationMs: Long,
        val bitrate: Int?,
        val sampleRate: Int?,
        val channels: Int?,
        val codec: String?,
    )

    private fun readMetadata(uri: Uri, name: String): Metadata =
        readMetadata(name) { retriever -> retriever.setDataSource(context, uri) }

    private fun readMetadata(name: String, bind: (MediaMetadataRetriever) -> Unit): Metadata {
        val fallbackTitle = name.substringBeforeLast('.')
        val retriever = MediaMetadataRetriever()
        val values = mutableMapOf<Int, String>()
        try {
            bind(retriever)
            for (key in KEY_LIST) {
                retriever.extractMetadata(key)?.takeIf { it.isNotBlank() }?.let { values[key] = it }
            }
        } catch (_: Exception) {
            // Unreadable metadata still yields a playable, named track.
        } finally {
            retriever.release()
        }
        return Metadata(
            title = values[MediaMetadataRetriever.METADATA_KEY_TITLE] ?: fallbackTitle,
            artist = values[MediaMetadataRetriever.METADATA_KEY_ARTIST]
                ?: values[MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST]
                ?: "Unknown artist",
            album = values[MediaMetadataRetriever.METADATA_KEY_ALBUM] ?: "Unknown album",
            albumArtist = values[MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST],
            trackNo = values[MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER]?.let(::leadingInt),
            discNo = values[MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER]?.let(::leadingInt),
            year = values[MediaMetadataRetriever.METADATA_KEY_YEAR]?.let(::leadingInt),
            genre = values[MediaMetadataRetriever.METADATA_KEY_GENRE],
            durationMs = values[MediaMetadataRetriever.METADATA_KEY_DURATION]?.toLongOrNull() ?: 0L,
            bitrate = values[MediaMetadataRetriever.METADATA_KEY_BITRATE]?.toIntOrNull(),
            sampleRate = if (android.os.Build.VERSION.SDK_INT >= 31) {
                values[MediaMetadataRetriever.METADATA_KEY_SAMPLERATE]?.toIntOrNull()
            } else {
                null
            },
            channels = null,
            codec = values[MediaMetadataRetriever.METADATA_KEY_MIMETYPE],
        )
    }

    private fun leadingInt(value: String): Int? =
        value.takeWhile { it.isDigit() }.toIntOrNull()

    private fun displayName(uri: Uri): String? {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) return cursor.getString(0)
            }
        return null
    }

    private data class Child(val documentId: String, val name: String, val mimeType: String)

    private val KEY_LIST = intArrayOf(
        MediaMetadataRetriever.METADATA_KEY_TITLE,
        MediaMetadataRetriever.METADATA_KEY_ARTIST,
        MediaMetadataRetriever.METADATA_KEY_ALBUM,
        MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST,
        MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER,
        MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER,
        MediaMetadataRetriever.METADATA_KEY_YEAR,
        MediaMetadataRetriever.METADATA_KEY_GENRE,
        MediaMetadataRetriever.METADATA_KEY_DURATION,
        MediaMetadataRetriever.METADATA_KEY_BITRATE,
        MediaMetadataRetriever.METADATA_KEY_MIMETYPE,
    )

    private fun queryChildren(treeUri: Uri, parentDocumentId: String): List<Child> {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
        val result = mutableListOf<Child>()
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        )
        try {
            context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
                while (cursor.moveToNext()) {
                    result.add(Child(cursor.getString(0), cursor.getString(1) ?: "audio", cursor.getString(2) ?: ""))
                }
            }
        } catch (_: Exception) {
            // A revoked or unreadable subtree is skipped; other folders still import.
        }
        return result
    }

    private fun isAudio(name: String): Boolean =
        name.substringAfterLast('.', "").lowercase() in EXTENSIONS

    private fun keyFor(uri: Uri): String = "saf:" + uri.toString()

    private fun keyFor(file: File): String = "file:" + file.absolutePath
}
