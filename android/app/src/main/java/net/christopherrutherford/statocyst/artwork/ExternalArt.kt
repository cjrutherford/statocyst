package net.christopherrutherford.statocyst.artwork

import android.content.Context
import android.net.Uri
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

    /** Token-free content URI for an album cover, or null when disabled or not worth looking up. */
    fun coverUri(context: Context, artist: String?, album: String?): String? {
        if (!enabled(context) || !ExternalArtwork.worthLooking(artist) || !ExternalArtwork.worthLooking(album)) return null
        return Uri.Builder().scheme("content").authority("${context.packageName}.artwork")
            .appendPath("cover").appendQueryParameter("artist", artist).appendQueryParameter("album", album)
            .build().toString()
    }

    fun artistUri(context: Context, name: String?): String? {
        if (!enabled(context) || !ExternalArtwork.worthLooking(name)) return null
        return Uri.Builder().scheme("content").authority("${context.packageName}.artwork")
            .appendPath("artist").appendQueryParameter("name", name)
            .build().toString()
    }
}
