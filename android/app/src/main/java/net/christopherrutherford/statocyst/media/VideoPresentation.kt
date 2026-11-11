package net.christopherrutherford.statocyst.media

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.util.Rational
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.Player
import kotlin.math.min

/**
 * Video is a presentation of the one Media3 player, never a second player.
 *
 * This object owns the single native [TextureView] overlay that is attached to the
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

    /** Physical-pixel rect of the WebView's video stage, reported by the renderer. */
    data class Bounds(val left: Int, val top: Int, val width: Int, val height: Int)

    @Volatile
    private var bounds: Bounds? = null

    private var overlay: FrameLayout? = null
    private var texture: TextureView? = null

    @Volatile
    private var pipRequested = false

    /** Activity children hidden while PiP shows only the video. */
    private var hiddenForPip: List<Pair<View, Int>> = emptyList()

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
        overlay?.let { texture?.let { view -> applySurfaceAspect(view) } }
    }

    /**
     * Sets the physical-pixel rect of the in-page video stage. The native surface
     * is laid out there instead of covering the whole Activity, so the app's
     * header, controls and episode list stay visible around it.
     */
    @JvmStatic
    fun setBounds(left: Int, top: Int, width: Int, height: Int): Boolean {
        if (width <= 0 || height <= 0) return false
        val next = Bounds(left, top, width, height)
        bounds = next
        overlay?.let { frame ->
            applyBounds(frame, next)
            texture?.let { applySurfaceAspect(it) }
        }
        return true
    }

    /** True when a video surface should be shown for the current episode. */
    @JvmStatic
    fun canShowVideo(): Boolean = mode == MODE_VIDEO && mediaForm == "video"

    /**
     * Attaches the native surface to [activity] and hands it to the existing player.
     * Runs on the main thread; callers in the plugin already marshal there.
     *
     * Without a stage rect there is nowhere integrated to put the surface, so it
     * waits for the renderer to report one instead of covering the whole app.
     */
    @JvmStatic
    fun attach(activity: Activity?, player: Player?): Boolean {
        if (activity == null || player == null || !canShowVideo()) return false
        val rect = bounds ?: return false
        val existing = texture
        if (existing != null && overlay?.parent != null) {
            overlay?.let { applyBounds(it, rect) }
            applySurfaceAspect(existing)
            player.setVideoTextureView(existing)
            attached = true
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            return true
        }
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return false
        detachView()
        val frame = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            isClickable = false
            isFocusable = false
            isFocusableInTouchMode = false
        }
        // TextureView participates in normal view compositing, so it stays
        // above the WebView and can be clipped to the in-page stage.
        val view = TextureView(activity).apply {
            isOpaque = true
            isClickable = false
            isFocusable = false
            isFocusableInTouchMode = false
        }
        frame.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER,
            ),
        )
        root.addView(frame)
        overlay = frame
        texture = view
        applyBounds(frame, rect)
        applySurfaceAspect(view)
        player.setVideoTextureView(view)
        attached = true
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        return true
    }

    private fun applyBounds(frame: FrameLayout, rect: Bounds) {
        frame.layoutParams = FrameLayout.LayoutParams(rect.width, rect.height).apply {
            leftMargin = rect.left
            topMargin = rect.top
            gravity = Gravity.TOP or Gravity.START
        }
        frame.requestLayout()
    }

    /** Letterboxes the surface inside the stage instead of stretching the video. */
    private fun applySurfaceAspect(view: TextureView) {
        val width = videoWidth
        val height = videoHeight
        val rect = bounds
        if (width == null || height == null || width <= 0 || height <= 0 || rect == null) {
            view.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER,
            )
        } else {
            val scale = min(rect.width.toFloat() / width, rect.height.toFloat() / height)
            view.layoutParams = FrameLayout.LayoutParams(
                (width * scale).toInt().coerceAtLeast(1),
                (height * scale).toInt().coerceAtLeast(1),
                Gravity.CENTER,
            )
        }
        view.requestLayout()
    }

    /** Detaches the surface but leaves playback (audio) untouched. */
    @JvmStatic
    fun detach(player: Player?) {
        val view = texture
        if (view != null) player?.clearVideoTextureView(view) else player?.clearVideoSurface()
        detachView()
        attached = false
    }

    private fun detachView() {
        val frame = overlay ?: return
        (frame.parent as? ViewGroup)?.removeView(frame)
        overlay = null
        texture = null
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

    /**
     * PiP shows the whole Activity window, so expand the one video surface to fill it.
     * On exit, restore the in-page stage rect; the renderer re-syncs on resume.
     */
    @JvmStatic
    fun onPipModeChanged(activity: Activity?, inPip: Boolean) {
        val frame = overlay ?: return
        val root = activity?.findViewById<ViewGroup>(android.R.id.content)
        if (inPip) {
            // PiP scales the whole Activity; hide the WebView and app chrome so
            // the window shows the video, not a miniature copy of the app.
            hiddenForPip = root?.let { group ->
                (0 until group.childCount)
                    .map { group.getChildAt(it) }
                    .filter { it !== frame && it.visibility == View.VISIBLE }
                    .map { it to it.visibility }
            }.orEmpty()
            hiddenForPip.forEach { it.first.visibility = View.GONE }
            frame.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            texture?.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER,
            )
            frame.requestLayout()
        } else {
            hiddenForPip.forEach { it.first.visibility = it.second }
            hiddenForPip = emptyList()
            bounds?.let { applyBounds(frame, it) }
            texture?.let { applySurfaceAspect(it) }
        }
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
