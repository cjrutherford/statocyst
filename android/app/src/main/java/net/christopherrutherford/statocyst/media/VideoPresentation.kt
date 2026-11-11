package net.christopherrutherford.statocyst.media

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.util.Rational
import android.view.Gravity
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.Player

/**
 * Video is a presentation of the one Media3 player, never a second player.
 *
 * This object owns the single native [SurfaceView] overlay that is attached to the
 * Activity's content view while the user is watching a video podcast. It is
 * detached on background, screen-off or audio-only; the player keeps playing audio
 * and reattaches without a seek. PiP stays on the same surface and session.
 */
object VideoPresentation {
    const val MODE_AUDIO_ONLY = "audio-only"
    const val MODE_VIDEO = "video"

    @Volatile
    var mode: String = MODE_AUDIO_ONLY
        private set

    @Volatile
    var mediaForm: String = "audio"
        private set

    @Volatile
    var videoWidth: Int? = null
        private set

    @Volatile
    var videoHeight: Int? = null
        private set

    @Volatile
    var posterUrl: String? = null
        private set

    @Volatile
    var attached: Boolean = false
        private set

    private var overlay: FrameLayout? = null
    private var surface: SurfaceView? = null

    @Volatile
    private var pipRequested = false

    /** Records the renderer's requested presentation and the current media metadata. */
    @JvmStatic
    fun configure(
        mode: String?,
        mediaForm: String? = null,
        videoWidth: Int? = null,
        videoHeight: Int? = null,
        posterUrl: String? = null,
    ) {
        if (mode != null) this.mode = if (mode == MODE_VIDEO) MODE_VIDEO else MODE_AUDIO_ONLY
        if (mediaForm != null) {
            this.mediaForm = if (mediaForm == "video") "video" else "audio"
            if (this.mediaForm != "video") {
                this.videoWidth = null
                this.videoHeight = null
            }
        }
        if (videoWidth != null) this.videoWidth = videoWidth.takeIf { it > 0 }
        if (videoHeight != null) this.videoHeight = videoHeight.takeIf { it > 0 }
        if (posterUrl != null) this.posterUrl = posterUrl
    }

    /** True when a video surface should be shown for the current episode. */
    @JvmStatic
    fun canShowVideo(): Boolean = mode == MODE_VIDEO && mediaForm == "video"

    /**
     * Attaches the native surface to [activity] and hands it to the existing player.
     * Runs on the main thread; callers in the plugin already marshal there.
     */
    @JvmStatic
    fun attach(activity: Activity?, player: Player?): Boolean {
        if (activity == null || player == null || !canShowVideo()) return false
        val existing = surface
        if (existing != null && overlay?.parent != null) {
            player.setVideoSurfaceView(existing)
            attached = true
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            return true
        }
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return false
        detachView()
        val frame = FrameLayout(activity).apply { setBackgroundColor(Color.TRANSPARENT) }
        val view = SurfaceView(activity).apply {
            setZOrderMediaOverlay(true)
            setBackgroundColor(Color.BLACK)
        }
        frame.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER,
            ),
        )
        root.addView(
            frame,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        overlay = frame
        surface = view
        player.setVideoSurfaceView(view)
        attached = true
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        return true
    }

    /** Detaches the surface but leaves playback (audio) untouched. */
    @JvmStatic
    fun detach(player: Player?) {
        player?.clearVideoSurface()
        detachView()
        attached = false
    }

    private fun detachView() {
        val frame = overlay ?: return
        (frame.parent as? ViewGroup)?.removeView(frame)
        overlay = null
        surface = null
    }

    /** Applies the form to the one player without reloading or creating another. */
    @JvmStatic
    fun applyTrackSelection(player: Player) {
        if (mediaForm != "video") return
        setVideoTrackDisabled(player, disabled = mode != MODE_VIDEO)
    }

    @JvmStatic
    fun pipSupported(activity: Activity?): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
            activity?.packageManager?.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) == true

    /** True when leaving the app should shrink the current video into PiP. */
    @JvmStatic
    fun shouldEnterPip(activity: Activity?): Boolean =
        activity != null && canShowVideo() && attached && pipSupported(activity)

    /**
     * Enters PiP with the video's aspect ratio. Audio-only and music never enter PiP.
     * Returns false when the OS/device does not support it, so the caller can report
     * the capability honestly instead of failing silently.
     */
    @JvmStatic
    fun enterPip(activity: Activity?): Boolean {
        if (!shouldEnterPip(activity)) return false
        val width = videoWidth ?: 16
        val height = videoHeight ?: 9
        return try {
            val entered = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val aspect = if (height > 0) Rational(width.coerceAtLeast(1), height) else Rational(16, 9)
                val builder = PictureInPictureParams.Builder().setAspectRatio(aspect)
                activity!!.enterPictureInPictureMode(builder.build())
            } else {
                @Suppress("DEPRECATION")
                activity!!.enterPictureInPictureMode()
                true
            }
            if (entered) pipRequested = true
            entered
        } catch (error: Exception) {
            android.util.Log.w("VideoPresentation", "PiP entry failed", error)
            false
        }
    }

    /** The Activity is back in the foreground; a later Home press may enter PiP again. */
    @JvmStatic
    fun onHostResumed() {
        pipRequested = false
    }

    /** The Activity is going away or lost the foreground (but not to PiP). */
    @JvmStatic
    fun onHostPaused(activity: Activity?, player: Player?) {
        if (activity == null) return
        val inPip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity.isInPictureInPictureMode
        // onPause can arrive before isInPictureInPictureMode flips on older releases.
        if (!inPip && !(pipRequested && canShowVideo())) {
            detach(player)
            // Clearing the surface alone can leave the video decoder running while the
            // screen is off. Disable the video track until the host resumes.
            player?.let { setVideoTrackDisabled(it, disabled = true) }
        }
    }

    private fun setVideoTrackDisabled(player: Player, disabled: Boolean) {
        if (mediaForm != "video") return
        val parameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, disabled)
            .build()
        player.trackSelectionParameters = parameters
    }

    @JvmStatic
    fun onHostDestroyed(activity: Activity?) {
        val frame = overlay ?: return
        val ownedByActivity = frame.context === activity
        if (ownedByActivity) detachView()
        attached = false
    }

    fun state(): Map<String, Any?> = mapOf(
        "presentation" to mode,
        "mediaForm" to mediaForm,
        "attached" to attached,
        "videoWidth" to videoWidth,
        "videoHeight" to videoHeight,
        "posterUrl" to posterUrl,
    )
}
