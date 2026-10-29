package net.christopherrutherford.statocyst.widget

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import net.christopherrutherford.statocyst.media.BrowseIds
import net.christopherrutherford.statocyst.media.PlaybackService

/**
 * Tapping a favorite in the widget plays it with the favorites list queued around it, exactly
 * like choosing it in the Favorites folder from the car.
 */
class WidgetActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_PLAY_FAVORITE) return
        val trackId = intent.getStringExtra(EXTRA_TRACK_ID) ?: return
        val app = context.applicationContext
        val pending = goAsync()
        val main = Handler(Looper.getMainLooper())
        val future = MediaController.Builder(app, SessionToken(app, ComponentName(app, PlaybackService::class.java))).buildAsync()
        future.addListener({
            try {
                val controller = future.get()
                controller.setMediaItem(MediaItem.Builder().setMediaId(BrowseIds.track(trackId, BrowseIds.FAVORITES)).build())
                controller.prepare()
                controller.play()
                // Commands are queued on the binder; give them a moment before letting go.
                main.postDelayed({ controller.release(); pending.finish() }, RELEASE_DELAY_MS)
            } catch (e: Exception) {
                android.util.Log.w("WidgetAction", "play favorite failed", e)
                pending.finish()
            }
        }, ContextCompat.getMainExecutor(app))
    }

    companion object {
        const val ACTION_PLAY_FAVORITE = "net.christopherrutherford.statocyst.widget.PLAY_FAVORITE"
        const val EXTRA_TRACK_ID = "trackId"
        private const val RELEASE_DELAY_MS = 1_500L
    }
}
