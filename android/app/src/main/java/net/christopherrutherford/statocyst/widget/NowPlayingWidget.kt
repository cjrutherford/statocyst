package net.christopherrutherford.statocyst.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.widget.RemoteViews
import androidx.media3.session.MediaButtonReceiver
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.R
import net.christopherrutherford.statocyst.db.StatocystDatabase
import java.util.concurrent.Executors

/**
 * Home-screen widget: the current song with transport buttons, and the top of the favorites
 * list (the same order as the Favorites folder in the app and in Android Auto). Rendering is
 * pure RemoteViews; the playback service calls [refresh] whenever what it shows changes.
 */
class NowPlayingWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        refresh(context)
    }

    override fun onEnabled(context: Context) {
        refresh(context)
    }

    companion object {
        const val FAVORITE_ROWS = 4
        private val rowIds = intArrayOf(R.id.widget_fav_1, R.id.widget_fav_2, R.id.widget_fav_3, R.id.widget_fav_4)
        private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "widget-render").apply { isDaemon = true } }

        @Volatile
        private var cachedArt: Pair<String, Bitmap?>? = null

        /** Re-renders every placed widget on a worker thread (database and artwork reads). */
        fun refresh(context: Context) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val ids = manager.getAppWidgetIds(ComponentName(app, NowPlayingWidget::class.java))
            if (ids.isEmpty()) return
            worker.execute {
                try {
                    manager.updateAppWidget(ids, render(app, WidgetStateStore(app).load(), favorites(app)))
                } catch (e: Exception) {
                    android.util.Log.w("NowPlayingWidget", "render failed", e)
                }
            }
        }

        data class FavoriteRow(val trackId: String, val label: String)

        private fun favorites(context: Context): List<FavoriteRow> = runBlocking {
            val db = StatocystDatabase.getInstance(context)
            val rows = mutableListOf<FavoriteRow>()
            for (fav in db.userDao().favorites()) {
                if (rows.size >= FAVORITE_ROWS) break
                val item = db.mediaItemDao().getById(fav.trackId)?.takeUnless { it.missing } ?: continue
                rows.add(FavoriteRow(item.id, listOfNotNull(item.title, item.artist).joinToString(" \u2013 ")))
            }
            rows
        }

        internal fun render(context: Context, state: WidgetState, favorites: List<FavoriteRow>): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_now_playing)

            views.setTextViewText(
                R.id.widget_title,
                state.title?.takeIf { state.hasTrack } ?: context.getString(R.string.widget_nothing_playing),
            )
            views.setTextViewText(R.id.widget_artist, state.artist?.takeIf { state.hasTrack } ?: "")
            views.setViewVisibility(R.id.widget_artist, if (state.hasTrack && !state.artist.isNullOrEmpty()) View.VISIBLE else View.GONE)

            val art = state.artworkUri?.takeIf { state.hasTrack }?.let { artwork(context, it) }
            if (art != null) views.setImageViewBitmap(R.id.widget_art, art)
            else views.setImageViewResource(R.id.widget_art, R.drawable.ic_widget_note)

            views.setImageViewResource(
                R.id.widget_play_pause,
                if (state.playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
            )
            views.setContentDescription(
                R.id.widget_play_pause,
                context.getString(if (state.playing) R.string.widget_pause else R.string.widget_play),
            )
            views.setOnClickPendingIntent(R.id.widget_prev, mediaKey(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS))
            views.setOnClickPendingIntent(R.id.widget_play_pause, mediaKey(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
            views.setOnClickPendingIntent(R.id.widget_next, mediaKey(context, KeyEvent.KEYCODE_MEDIA_NEXT))
            views.setOnClickPendingIntent(R.id.widget_header, openApp(context))

            views.setViewVisibility(R.id.widget_fav_header, if (favorites.isEmpty()) View.GONE else View.VISIBLE)
            views.setViewVisibility(R.id.widget_fav_empty, if (favorites.isEmpty()) View.VISIBLE else View.GONE)
            rowIds.forEachIndexed { i, id ->
                val row = favorites.getOrNull(i)
                if (row == null) {
                    views.setViewVisibility(id, View.GONE)
                } else {
                    views.setViewVisibility(id, View.VISIBLE)
                    views.setTextViewText(id, row.label)
                    views.setOnClickPendingIntent(id, playFavorite(context, row.trackId, i))
                }
            }
            return views
        }

        /** Decoded small enough for a RemoteViews payload; the last one is memoised across refreshes. */
        private fun artwork(context: Context, uri: String): Bitmap? {
            cachedArt?.let { if (it.first == uri) return it.second }
            val bitmap = try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                context.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it, null, bounds) }
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= ART_PX && bounds.outHeight / (sample * 2) >= ART_PX) sample *= 2
                context.contentResolver.openInputStream(Uri.parse(uri))?.use {
                    BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
                }
            } catch (e: Exception) {
                android.util.Log.w("NowPlayingWidget", "artwork unavailable", e)
                null
            }
            cachedArt = uri to bitmap
            return bitmap
        }

        private const val ART_PX = 192

        /** Media3's receiver also revives the service and the saved queue when the process is gone. */
        private fun mediaKey(context: Context, keyCode: Int): PendingIntent {
            val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
                .setComponent(ComponentName(context, MediaButtonReceiver::class.java))
                .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
            return PendingIntent.getBroadcast(context, keyCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun openApp(context: Context): PendingIntent {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
            return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun playFavorite(context: Context, trackId: String, row: Int): PendingIntent {
            val intent = Intent(WidgetActionReceiver.ACTION_PLAY_FAVORITE)
                .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
                .setData(Uri.parse("statocyst://widget/favorite/$row"))
                .putExtra(WidgetActionReceiver.EXTRA_TRACK_ID, trackId)
            return PendingIntent.getBroadcast(context, 1000 + row, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}
