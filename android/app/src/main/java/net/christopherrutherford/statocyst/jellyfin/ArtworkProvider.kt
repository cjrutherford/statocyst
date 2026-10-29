package net.christopherrutherford.statocyst.jellyfin

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import net.christopherrutherford.statocyst.artwork.ExternalArt
import java.io.File
import java.io.FileNotFoundException

/**
 * Serves Jellyfin artwork as `content://<package>.artwork/art/<itemId>?tag=<tag>`.
 *
 * Android Auto's host and the system media UI fetch artwork themselves and send
 * no Jellyfin credentials, so a direct server URL fails with 401. This provider
 * downloads through [JellyfinArtwork] (session header, disk cache) and hands the
 * caller a file descriptor, so no token ever appears in a URI. Exported because
 * the head unit host is another app; it only serves album art for valid item ids.
 *
 * `/cover?artist=&album=` and `/artist?name=` serve opt-in MusicBrainz artwork
 * (see [ExternalArt]); they return nothing while that setting is off. Pulled artwork
 * takes precedence: an optional `id`/`tag` names the Jellyfin image to serve only when
 * nothing could be found online.
 */
class ArtworkProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("read-only")
        val file = resolve(uri) ?: throw FileNotFoundException("no artwork")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String? = resolve(uri)?.let { file ->
        file.inputStream().use { s -> ByteArray(16).also { s.read(it) } }.let(JellyfinArtwork::sniffMime)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val file = resolve(uri) ?: return null
        val cols = (projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE))
        val row = cols.map {
            when (it) {
                OpenableColumns.DISPLAY_NAME -> "${request(uri)?.first ?: uri.pathSegments.firstOrNull()}.img"
                OpenableColumns.SIZE -> file.length()
                else -> null
            }
        }
        return MatrixCursor(cols).also { it.addRow(row) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    private fun request(uri: Uri): Pair<String, String>? = parse(uri.pathSegments, uri.getQueryParameter("tag"))

    private fun resolve(uri: Uri): File? {
        val ctx = context ?: return null
        return when (uri.pathSegments.firstOrNull()) {
            "cover" -> {
                val artist = uri.getQueryParameter("artist") ?: return null
                val album = uri.getQueryParameter("album") ?: return null
                ExternalArt.cover(ctx, artist, album) ?: fallback(ctx, uri)
            }
            "artist" -> {
                val name = uri.getQueryParameter("name") ?: return null
                ExternalArt.artist(ctx, name) ?: fallback(ctx, uri)
            }
            else -> {
                val (id, tag) = request(uri) ?: return null
                JellyfinArtwork.fetch(ctx, id, tag, serverId = serverOf(uri))
            }
        }
    }

    /** The Jellyfin image named by `id`/`tag`, used when no pulled artwork exists. */
    private fun fallback(ctx: Context, uri: Uri): File? {
        val id = uri.getQueryParameter("id")?.takeIf { JellyfinArtwork.isValidId(it) } ?: return null
        val tag = uri.getQueryParameter("tag")?.takeIf { JellyfinArtwork.isValidTag(it) } ?: ""
        return JellyfinArtwork.fetch(ctx, id, tag, serverId = serverOf(uri))
    }

    /** The optional `server` hint naming which signed-in server owns the image. */
    private fun serverOf(uri: Uri): String? =
        uri.getQueryParameter("server")?.takeIf { JellyfinArtwork.isValidId(it) }

    companion object {
        /** `/art/<itemId>` plus optional tag, validated; null for anything else. */
        fun parse(segments: List<String>, tag: String?): Pair<String, String>? {
            if (segments.size != 2 || segments[0] != "art") return null
            val id = segments[1]
            if (!JellyfinArtwork.isValidId(id)) return null
            return id to (tag?.takeIf { JellyfinArtwork.isValidTag(it) } ?: "")
        }

        fun authority(context: Context) = "${context.packageName}.artwork"

        /** Token-free content URI for a Jellyfin item's primary image, or null for an invalid id. */
        fun uri(context: Context, itemId: String, tag: String?, serverId: String? = null): String? {
            if (!JellyfinArtwork.isValidId(itemId)) return null
            val t = tag?.takeIf { it.isNotEmpty() && JellyfinArtwork.isValidTag(it) }
            val s = serverId?.takeIf { JellyfinArtwork.isValidId(it) }
            val query = listOfNotNull(t?.let { "tag=$it" }, s?.let { "server=$it" })
            return "content://${authority(context)}/art/$itemId" +
                (if (query.isEmpty()) "" else "?" + query.joinToString("&"))
        }
    }
}
