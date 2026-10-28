package net.christopherrutherford.statocyst.artwork

import android.content.Context
import android.net.Uri
import net.christopherrutherford.statocyst.jellyfin.JellyfinArtwork
import java.io.File

/**
 * Opt-in access to MusicBrainz artwork. Off by default because it sends album
 * and artist names to musicbrainz.org (and image requests to the Cover Art
 * Archive / Wikimedia); nothing else about the library or user leaves the device.
 */
object ExternalArt {
    const val PREF = "external_art_enabled"

    @Volatile
    private var instance: ExternalArtwork? = null

    fun enabled(context: Context): Boolean =
        context.applicationContext.getSharedPreferences("statocyst", Context.MODE_PRIVATE).getBoolean(PREF, false)

    fun setEnabled(context: Context, on: Boolean) {
        context.applicationContext.getSharedPreferences("statocyst", Context.MODE_PRIVATE)
            .edit().putBoolean(PREF, on).apply()
    }

    private fun store(context: Context): ExternalArtwork = instance ?: synchronized(this) {
        instance ?: run {
            val app = context.applicationContext
            val version = try {
                app.packageManager.getPackageInfo(app.packageName, 0).versionName
            } catch (_: Exception) {
                "0"
            }
            ExternalArtwork(
                File(app.cacheDir, "ext-art"),
                MusicBrainzClient("Statocyst/$version (+${app.packageName})"),
            ).also { instance = it }
        }
    }

    fun cover(context: Context, artist: String, album: String): File? =
        if (enabled(context)) store(context).cover(artist, album) else null

    fun artist(context: Context, name: String): File? =
        if (enabled(context)) store(context).artist(name) else null

    /**
     * Token-free content URI for an album cover, or null when disabled or not worth looking up.
     * Pulled artwork overrides the server's: [fallback] (Jellyfin item id and image tag) is only
     * served when nothing could be found online.
     */
    fun coverUri(context: Context, artist: String?, album: String?, fallback: Pair<String, String?>? = null): String? {
        if (!enabled(context) || !ExternalArtwork.worthLooking(artist) || !ExternalArtwork.worthLooking(album)) return null
        return Uri.Builder().scheme("content").authority("${context.packageName}.artwork")
            .appendPath("cover").appendQueryParameter("artist", artist).appendQueryParameter("album", album)
            .withFallback(fallback).build().toString()
    }

    fun artistUri(context: Context, name: String?, fallback: Pair<String, String?>? = null): String? {
        if (!enabled(context) || !ExternalArtwork.worthLooking(name)) return null
        return Uri.Builder().scheme("content").authority("${context.packageName}.artwork")
            .appendPath("artist").appendQueryParameter("name", name)
            .withFallback(fallback).build().toString()
    }

    /** Appends `id` and `tag` for the Jellyfin image to fall back to; invalid values are dropped. */
    fun Uri.Builder.withFallback(fallback: Pair<String, String?>?): Uri.Builder {
        val id = fallback?.first?.takeIf { JellyfinArtwork.isValidId(it) } ?: return this
        appendQueryParameter("id", id)
        fallback.second?.takeIf { it.isNotEmpty() && JellyfinArtwork.isValidTag(it) }?.let { appendQueryParameter("tag", it) }
        return this
    }
}
