package net.christopherrutherford.statocyst.media

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.media3.exoplayer.upstream.BandwidthMeter
import net.christopherrutherford.statocyst.db.MediaItemEntity

/**
 * The Adaptive quality setting for streams. A track already on the device (a pinned download or
 * a finished cache copy) is always played as it is, never swapped for a lower quality stream.
 * Only a track that has to come over the network is a candidate for a transcode, and only when
 * the connection cannot carry the original with some headroom to spare. Mirrors the pure
 * `decideQuality` policy of the web layer.
 */
object AdaptiveQuality {
    enum class Mode { DIRECT, TRANSCODE }

    /** Bitrate requested from the server for a transcode. */
    const val TRANSCODE_BITS = 192_000L
    private const val HEADROOM = 1.15
    private const val PREF_KEY = "quality"

    /** ExoPlayer's running estimate of the connection, set by the playback service. */
    @Volatile
    var bandwidth: BandwidthMeter? = null

    fun setPreference(context: Context, quality: String) {
        context.getSharedPreferences("statocyst", Context.MODE_PRIVATE).edit().putString(PREF_KEY, quality).apply()
    }

    fun isAuto(context: Context): Boolean =
        context.getSharedPreferences("statocyst", Context.MODE_PRIVATE).getString(PREF_KEY, "lossless") == "auto"

    /** The original file's bitrate: as reported by the server, else a typical value for its format. */
    fun sourceBits(track: MediaItemEntity): Long {
        track.bitrate?.takeIf { it > 0 }?.let { return it.toLong() }
        return when ((track.codec ?: track.format ?: track.ext).lowercase()) {
            "flac", "alac", "wav", "wave", "aiff", "ape", "wv" -> 1_000_000L
            else -> 320_000L
        }
    }

    /**
     * [stalled] says the original already failed to keep up, which settles it without a measurement.
     * With no measurement at all the original is kept: an unknown connection is not a bad one.
     */
    fun decide(auto: Boolean, sourceBits: Long, measuredBits: Long?, stalled: Boolean = false): Mode {
        if (!auto) return Mode.DIRECT
        // A source this small is no bigger than the transcode: there is nothing to save.
        if (sourceBits <= TRANSCODE_BITS * 1.2) return Mode.DIRECT
        if (stalled) return Mode.TRANSCODE
        if (measuredBits == null || measuredBits <= 0) return Mode.DIRECT
        return if (measuredBits >= sourceBits * HEADROOM) Mode.DIRECT else Mode.TRANSCODE
    }

    fun measuredBits(context: Context): Long? {
        bandwidth?.bitrateEstimate?.takeIf { it > 0 }?.let { return it }
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return null
        return caps.linkDownstreamBandwidthKbps.takeIf { it > 0 }?.let { it * 1_000L }
    }

    fun modeFor(context: Context, track: MediaItemEntity, stalled: Boolean = false): Mode =
        decide(isAuto(context), sourceBits(track), measuredBits(context), stalled)
}
