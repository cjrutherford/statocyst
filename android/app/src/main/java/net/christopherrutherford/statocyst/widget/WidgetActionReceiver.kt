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
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.media.BrowseIds
import net.christopherrutherford.statocyst.media.PlaybackService

/**
 * Widget taps that need more than a media key: play a song with its folder (favorites, recents)
 * queued around it, exactly like choosing it in that folder from the car, and heart the current song.
 */
class WidgetActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        when (intent.action) {
            ACTION_PLAY_TRACK -> playTrack(
                app,
                intent.getStringExtra(EXTRA_TRACK_ID) ?: return,
                intent.getStringExtra(EXTRA_CONTEXT) ?: BrowseIds.FAVORITES,
            )
            ACTION_TOGGLE_FAVORITE -> toggleFavorite(app)
        }
    }

    private fun toggleFavorite(app: Context) {
        val trackId = WidgetStateStore(app).load().trackId ?: return
        val pending = goAsync()
        Thread {
            try {
                val dao = StatocystDatabase.getInstance(app).userDao()
                runBlocking { dao.toggleFavorite(trackId) }
                val all = runBlocking { dao.favorites().map { it.trackId } }
                PlaybackService.onUserStateChanged()
                PlaybackService.favoritesListener?.invoke(all)
                Widgets.refresh(app)
            } catch (e: Exception) {
                android.util.Log.w("WidgetAction", "toggle favorite failed", e)
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun playTrack(app: Context, trackId: String, contextId: String) {
        val pending = goAsync()
        val main = Handler(Looper.getMainLooper())
        val future = MediaController.Builder(app, SessionToken(app, ComponentName(app, PlaybackService::class.java))).buildAsync()
        future.addListener({
            try {
                val controller = future.get()
                controller.setMediaItem(MediaItem.Builder().setMediaId(BrowseIds.track(trackId, contextId)).build())
                controller.prepare()
                controller.play()
                // Commands are queued on the binder; give them a moment before letting go.
                main.postDelayed({ controller.release(); pending.finish() }, RELEASE_DELAY_MS)
            } catch (e: Exception) {
                android.util.Log.w("WidgetAction", "play track failed", e)
                pending.finish()
            }
        }, ContextCompat.getMainExecutor(app))
    }

    companion object {
        const val ACTION_PLAY_TRACK = "net.christopherrutherford.statocyst.widget.PLAY_TRACK"
        const val ACTION_TOGGLE_FAVORITE = "net.christopherrutherford.statocyst.widget.TOGGLE_FAVORITE"
        const val EXTRA_TRACK_ID = "trackId"
        const val EXTRA_CONTEXT = "contextId"
        private const val RELEASE_DELAY_MS = 1_500L
    }
}
