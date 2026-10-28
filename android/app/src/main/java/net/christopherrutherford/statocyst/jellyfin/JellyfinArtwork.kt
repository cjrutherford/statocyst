package net.christopherrutherford.statocyst.jellyfin

import android.content.Context
import java.io.File
import java.security.MessageDigest

/**
 * Fetches Jellyfin primary images with the session header and keeps them on disk, so the
 * WebView can show artwork from a plain loopback URL and the token never appears in a URL.
 */
object JellyfinArtwork {
    private const val MAX_BYTES = 6L * 1024 * 1024
    private const val MAX_CACHE_BYTES = 64L * 1024 * 1024
    private val ID = Regex("[A-Za-z0-9-]{1,64}")
    private val TAG = Regex("[A-Za-z0-9._-]{0,128}")

    fun isValidId(id: String?) = id != null && ID.matches(id)
    fun isValidTag(tag: String?) = tag != null && TAG.matches(tag)

    /** Image bytes' MIME type from their magic number, or null when they are not a supported image. */
    fun sniffMime(head: ByteArray): String? = when {
        head.size >= 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() && head[2] == 0xFF.toByte() -> "image/jpeg"
        head.size >= 8 && head[0] == 0x89.toByte() && head[1] == 'P'.code.toByte() && head[2] == 'N'.code.toByte() &&
            head[3] == 'G'.code.toByte() -> "image/png"
        head.size >= 12 && String(head, 0, 4, Charsets.ISO_8859_1) == "RIFF" &&
            String(head, 8, 4, Charsets.ISO_8859_1) == "WEBP" -> "image/webp"
        head.size >= 4 && String(head, 0, 4, Charsets.ISO_8859_1) == "GIF8" -> "image/gif"
        else -> null
    }

    fun cacheKey(serverUrl: String, itemId: String, tag: String, height: Int): String =
        MessageDigest.getInstance("SHA-256")
            .digest("${serverUrl.trimEnd('/')}|$itemId|$tag|$height".toByteArray())
            .joinToString("") { "%02x".format(it) }

    /** The cached or freshly downloaded image for the signed-in session, or null. */
    fun fetch(context: Context, itemId: String, tag: String, height: Int = 300): File? {
        val prefs = context.getSharedPreferences("statocyst", Context.MODE_PRIVATE)
        val server = prefs.getString("jellyfin_url", null)?.takeIf { it.isNotEmpty() } ?: return null
        val token = prefs.getString("jellyfin_token", null)?.takeIf { it.isNotEmpty() } ?: return null
        return download(server, token, itemId, tag, height, File(context.cacheDir, "jf-art"))
    }

    fun download(serverUrl: String, token: String, itemId: String, tag: String, height: Int, dir: File): File? {
        if (!isValidId(itemId) || !isValidTag(tag)) return null
        dir.mkdirs()
        val target = File(dir, cacheKey(serverUrl, itemId, tag, height))
        if (target.isFile && target.length() > 0) {
            target.setLastModified(System.currentTimeMillis())
            return target
        }
        val query = buildString {
            append("?maxHeight=").append(height)
            if (tag.isNotEmpty()) append("&tag=").append(tag)
        }
        val url = "${serverUrl.trimEnd('/')}/Items/$itemId/Images/Primary$query"
        val tmp = File(dir, target.name + ".part")
        return try {
            val conn = JellyfinAuth.open(url, token)
            conn.connectTimeout = 8_000
            conn.readTimeout = 15_000
            conn.instanceFollowRedirects = false
            if (conn.responseCode != 200) {
                conn.disconnect()
                return null
            }
            var total = 0L
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw java.io.IOException("image too large")
                        out.write(buf, 0, n)
                    }
                }
            }
            conn.disconnect()
            val head = tmp.inputStream().use { s -> ByteArray(16).also { b -> s.read(b) } }
            if (total == 0L || sniffMime(head) == null || !tmp.renameTo(target)) {
                tmp.delete()
                return null
            }
            prune(dir)
            target
        } catch (e: Exception) {
            tmp.delete()
            null
        }
    }

    /** Keeps the artwork cache bounded by removing the least recently used files. */
    private fun prune(dir: File) {
        val files = dir.listFiles { f -> f.isFile && !f.name.endsWith(".part") } ?: return
        var size = files.sumOf { it.length() }
        if (size <= MAX_CACHE_BYTES) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (size <= MAX_CACHE_BYTES * 3 / 4) break
            size -= f.length()
            f.delete()
        }
    }
}
