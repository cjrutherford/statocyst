package net.christopherrutherford.statocyst.downloads

/**
 * Quality/variant of a pinned copy. The master is never modified; a transcode is a
 * separate offline file. MP3 is the conservative common denominator for music: it is
 * already the proven streaming fallback on both Android (ExoPlayer) and iOS
 * (AVPlayer), and at 96/128 kbps it is roughly a tenth of a lossless file.
 *
 * Video podcast variants use the fixed MVP-6 presets. They are download-time only:
 * playback never transcodes, and the publisher's original remains available.
 *
 * `extension` is the *actual* container of the written bytes. A FLAC track pinned as
 * Saver is written as `.mp3`, not `.flac`.
 */
enum class DownloadProfile(
    val wire: String,
    val bitRate: Int?,
    val codec: String?,
    val extension: String?,
    val targetHeight: Int? = null,
) {
    ORIGINAL("original", null, null, null),
    BALANCED("balanced", 128_000, "mp3", "mp3"),
    SAVER("saver", 96_000, "mp3", "mp3"),

    /** Smallest spoken-word copy: AAC/M4A, mono 64 kbps. */
    AUDIO_ONLY("audio-only", 64_000, "aac", "m4a"),

    /** Phone-sized video: H.264/AAC around 800 kbps. Never upscales. */
    VIDEO_480P("video-480p", 800_000, "h264", "mp4", 480),

    /** Tablet/laptop video: H.264/AAC around 1.5 Mbps. Never upscales. */
    VIDEO_720P("video-720p", 1_500_000, "h264", "mp4", 720);

    /** Jellyfin can produce its own audio transcode; the other profiles are local. */
    val serverTranscode: Boolean get() = this == BALANCED || this == SAVER

    /** True when the variant needs the Media3 Transformer after download. */
    val compressed: Boolean get() = this == AUDIO_ONLY || targetHeight != null

    /** Output audio bitrate for the local transcode presets. */
    val targetAudioBitRate: Int get() = if (this == AUDIO_ONLY) 64_000 else 96_000

    /** Kept for the existing container/bitrate bookkeeping; local or server-produced. */
    val transcoded: Boolean get() = wire != ORIGINAL.wire

    companion object {
        fun from(value: String?): DownloadProfile =
            entries.firstOrNull { it.wire.equals(value, ignoreCase = true) } ?: ORIGINAL
    }
}
