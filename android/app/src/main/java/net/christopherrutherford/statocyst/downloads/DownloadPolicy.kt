package net.christopherrutherford.statocyst.downloads

/**
 * Admission policy for pinned downloads. Pure arithmetic so it can be unit tested
 * without Android: a queue is admitted only when it fits both the user's offline
 * limit and the free space left after a safety reserve.
 *
 * A size of 0 means "unknown" in the catalog. Unknown tracks use a conservative
 * estimate from bitrate and duration, or a small fixed fallback, so a malformed
 * row cannot silently start a multi-gigabyte transfer.
 */
object DownloadPolicy {
    /** Never eat the last half-gigabyte of storage. */
    const val RESERVE_BYTES = 500L * 1024 * 1024

    /** Automatic limit: the smaller of 10 GiB and a quarter of free space. */
    const val AUTO_CAP_BYTES = 10L * 1024 * 1024 * 1024

    /** Used when neither size nor bitrate/duration are known. */
    const val UNKNOWN_TRACK_BYTES = 8L * 1024 * 1024

    data class Decision(val allowed: Boolean, val reason: String? = null) {
        companion object {
            val ALLOWED = Decision(true)
            fun denied(reason: String) = Decision(false, reason)
        }
    }

    /**
     * The limit actually enforced. A requested quota of 0 means automatic; an
     * explicit quota is still clamped by free space so it can never be a promise
     * the device cannot keep.
     */
    fun effectiveQuota(requestedQuota: Long, freeBytes: Long): Long {
        val cap = if (requestedQuota > 0) requestedQuota else AUTO_CAP_BYTES
        val fromFree = (freeBytes.coerceAtLeast(0) / 4)
        return minOf(cap, fromFree)
    }

    fun estimateBytes(
        sizeBytes: Long,
        bitrate: Int?,
        durationMs: Long,
        profile: DownloadProfile = DownloadProfile.ORIGINAL,
    ): Long {
        // A transcode's size is its target bitrate, not the master's size.
        if (profile.bitRate != null && durationMs > 0) {
            return (profile.bitRate.toLong() / 8) * (durationMs / 1000)
        }
        if (sizeBytes > 0) return sizeBytes
        if (bitrate != null && bitrate > 0 && durationMs > 0) {
            // bitrate is bits/second; duration is milliseconds.
            return (bitrate.toLong() / 8) * (durationMs / 1000)
        }
        return UNKNOWN_TRACK_BYTES
    }

    fun admit(
        requestedBytes: Long,
        pinnedBytes: Long,
        freeBytes: Long,
        requestedQuota: Long,
    ): Decision {
        if (requestedBytes <= 0) return Decision.ALLOWED
        val after = pinnedBytes.coerceAtLeast(0) + requestedBytes
        if (after + RESERVE_BYTES > freeBytes) {
            return Decision.denied(
                "Not enough free space: this needs ${describe(requestedBytes)} and " +
                    "the device has ${describe(freeBytes)} free. Keep ${describe(RESERVE_BYTES)} " +
                    "for the app and other work.",
            )
        }
        val quota = effectiveQuota(requestedQuota, freeBytes)
        if (after > quota) {
            return Decision.denied(
                "These downloads would use ${describe(after)}, over the ${describe(quota)} " +
                    "offline limit. Remove something or raise the limit in Settings → Storage.",
            )
        }
        return Decision.ALLOWED
    }

    /** Compact, human-sized text for native dialogs and errors. */
    fun describe(bytes: Long): String {
        val value = bytes.coerceAtLeast(0)
        return when {
            value >= 1024L * 1024 * 1024 -> String.format("%.1f GB", value / (1024.0 * 1024 * 1024))
            value >= 1024L * 1024 -> String.format("%.1f MB", value / (1024.0 * 1024))
            value >= 1024L -> String.format("%.1f KB", value / 1024.0)
            else -> "$value B"
        }
    }
}
