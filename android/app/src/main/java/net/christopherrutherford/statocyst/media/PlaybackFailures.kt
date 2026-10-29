package net.christopherrutherford.statocyst.media

import androidx.media3.common.PlaybackException
import androidx.media3.session.SessionError

/** What the car (or notification) should tell the user when a song cannot play. */
data class PlaybackFailure(val sessionCode: Int, val message: String)

/** Maps a player error to a short, actionable message. Pure so it can be unit-tested. */
object PlaybackFailures {
    fun describe(errorCode: Int, httpStatus: Int? = null): PlaybackFailure = when {
        httpStatus == 401 || httpStatus == 403 -> PlaybackFailure(
            SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
            "Jellyfin sign-in expired. Open Statocyst on your phone to sign in again.",
        )
        httpStatus == 404 || errorCode == PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> PlaybackFailure(
            SessionError.ERROR_IO,
            "This song is no longer available.",
        )
        errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> PlaybackFailure(
            SessionError.ERROR_IO,
            "No connection. Connect to the internet or play a downloaded song.",
        )
        else -> PlaybackFailure(SessionError.ERROR_UNKNOWN, "Can't play this song.")
    }

    /** Waits between attempts to recover a stream that dropped; the list length is the attempt limit. */
    val RECOVERY_BACKOFF_MS = longArrayOf(2_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000, 30_000)

    /**
     * True when the stream died because the connection or the server did, as opposed to the
     * track being gone or the sign-in being rejected. Those are worth retrying in place
     * rather than skipping to the next song.
     */
    fun isNetworkLoss(errorCode: Int, httpStatus: Int? = null): Boolean = when {
        httpStatus != null -> httpStatus in 500..599
        else -> errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
            errorCode == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
    }
}
