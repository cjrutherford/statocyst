package net.christopherrutherford.statocyst.downloads

/**
 * Quality of a pinned copy. The master is never modified; a transcode is a separate
 * offline file. MP3 is the conservative common denominator: it is already the proven
 * streaming fallback on both Android (ExoPlayer) and iOS (AVPlayer), and at 96/128 kbps
 * it is roughly a tenth of a lossless file.
 *
 * `extension` is the *actual* container of the downloaded bytes. A FLAC track pinned as
 * Saver is written as `.mp3`, not `.flac`.
 */
enum class DownloadProfile(
    val wire: String,
    val bitRate: Int?,
    val codec: String?,
    val extension: String?,
) {
    ORIGINAL("original", null, null, null),
    BALANCED("balanced", 128_000, "mp3", "mp3"),
    SAVER("saver", 96_000, "mp3", "mp3");

    val transcoded: Boolean get() = bitRate != null

    companion object {
        fun from(value: String?): DownloadProfile =
            entries.firstOrNull { it.wire.equals(value, ignoreCase = true) } ?: ORIGINAL
    }
}
