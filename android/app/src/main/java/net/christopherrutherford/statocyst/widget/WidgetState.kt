package net.christopherrutherford.statocyst.widget

import android.content.Context

/** What the home-screen widget shows for the current song; written by the playback service. */
data class WidgetState(
    val trackId: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val artworkUri: String? = null,
    val playing: Boolean = false,
) {
    val hasTrack: Boolean get() = !trackId.isNullOrEmpty()
}

/**
 * Persisted so the widget keeps showing the last song (paused) after the playback service has
 * stopped or the process was killed, instead of going blank.
 */
class WidgetStateStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("statocyst_widget", Context.MODE_PRIVATE)

    fun load(): WidgetState = WidgetState(
        trackId = prefs.getString(KEY_TRACK, null),
        title = prefs.getString(KEY_TITLE, null),
        artist = prefs.getString(KEY_ARTIST, null),
        artworkUri = prefs.getString(KEY_ART, null),
        playing = prefs.getBoolean(KEY_PLAYING, false),
    )

    fun save(state: WidgetState) {
        prefs.edit()
            .putString(KEY_TRACK, state.trackId)
            .putString(KEY_TITLE, state.title)
            .putString(KEY_ARTIST, state.artist)
            .putString(KEY_ART, state.artworkUri)
            .putBoolean(KEY_PLAYING, state.playing)
            .apply()
    }

    private companion object {
        const val KEY_TRACK = "trackId"
        const val KEY_TITLE = "title"
        const val KEY_ARTIST = "artist"
        const val KEY_ART = "artworkUri"
        const val KEY_PLAYING = "playing"
    }
}
