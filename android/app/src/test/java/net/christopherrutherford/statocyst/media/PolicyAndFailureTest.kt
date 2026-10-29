package net.christopherrutherford.statocyst.media

import androidx.media3.common.PlaybackException
import androidx.media3.session.SessionError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PolicyAndFailureTest {
    private val own = "net.christopherrutherford.statocyst"

    @Test
    fun userAllowedPackageMayBrowse() {
        val own = "net.christopherrutherford.statocyst"
        assertFalse(ControllerPolicy.mayBrowse("com.example.headunit", own, false))
        assertTrue(ControllerPolicy.mayBrowse("com.example.headunit", own, false, setOf("com.example.headunit")))
        assertFalse(ControllerPolicy.mayBrowse("com.example.other", own, false, setOf("com.example.headunit")))
    }

    @Test
    fun knownCarAndSystemControllersMayBrowse() {
        assertTrue(ControllerPolicy.mayBrowse("com.google.android.projection.gearhead", own, false))
        assertTrue(ControllerPolicy.mayBrowse("com.google.android.autosimulator", own, false))
        assertTrue(ControllerPolicy.mayBrowse("com.android.car.media", own, false))
        assertTrue(ControllerPolicy.mayBrowse(own, own, false))
        assertTrue(ControllerPolicy.mayBrowse("com.some.system", own, true))
    }

    @Test
    fun unknownUntrustedAppsCannotBrowse() {
        assertFalse(ControllerPolicy.mayBrowse("com.evil.app", own, false))
        assertFalse(ControllerPolicy.mayBrowse("com.android.carfake", own, false))
    }

    @Test
    fun failuresExplainWhatToDo() {
        assertEquals(
            SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
            PlaybackFailures.describe(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 403).sessionCode,
        )
        assertTrue(
            PlaybackFailures.describe(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED).message
                .contains("No connection"),
        )
        assertTrue(
            PlaybackFailures.describe(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 404).message
                .contains("no longer available"),
        )
        assertEquals(SessionError.ERROR_UNKNOWN, PlaybackFailures.describe(PlaybackException.ERROR_CODE_UNSPECIFIED).sessionCode)
    }
}
