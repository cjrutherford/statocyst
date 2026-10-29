package net.christopherrutherford.statocyst.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.view.KeyEvent
import android.view.View
import android.widget.RemoteViews
import net.christopherrutherford.statocyst.R

/** Shared by the three now-playing layouts: title, artist, artwork and the play/pause icon. */
internal fun bindNowPlaying(context: Context, views: RemoteViews, state: WidgetState, artPx: Int) {
    views.setTextViewText(
        R.id.widget_title,
        state.title?.takeIf { state.hasTrack } ?: context.getString(R.string.widget_nothing_playing),
    )
    views.setTextViewText(R.id.widget_artist, state.artist?.takeIf { state.hasTrack } ?: "")
    views.setViewVisibility(R.id.widget_artist, if (state.hasTrack && !state.artist.isNullOrEmpty()) View.VISIBLE else View.GONE)
    views.setImageViewBitmap(
        R.id.widget_art,
        WidgetArt.tile(context, state.artworkUri.takeIf { state.hasTrack }, state.title, artPx),
    )
    views.setContentDescription(
        R.id.widget_play_pause,
        context.getString(if (state.playing) R.string.widget_pause else R.string.widget_play),
    )
    views.setOnClickPendingIntent(R.id.widget_prev, Widgets.mediaKey(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS))
    views.setOnClickPendingIntent(R.id.widget_play_pause, Widgets.mediaKey(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
    views.setOnClickPendingIntent(R.id.widget_next, Widgets.mediaKey(context, KeyEvent.KEYCODE_MEDIA_NEXT))
    views.setOnClickPendingIntent(R.id.widget_header, Widgets.openApp(context))
}

private fun refreshOnUpdate(context: Context) = Widgets.refresh(context)

/** Now playing plus the top of the favorites list. */
class NowPlayingWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = refreshOnUpdate(context)
    override fun onEnabled(context: Context) = refreshOnUpdate(context)

    companion object {
        /** Kept for callers outside the widget package. */
        fun refresh(context: Context) = Widgets.refresh(context)

        private val rowIds = intArrayOf(R.id.widget_fav_1, R.id.widget_fav_2, R.id.widget_fav_3, R.id.widget_fav_4)

        internal fun render(context: Context, data: WidgetData): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_now_playing)
            bindNowPlaying(context, views, data.state, ART_PX)
            views.setImageViewResource(
                R.id.widget_play_pause,
                if (data.state.playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
            )
            val favorites = data.favorites.take(Widgets.LIST_ROWS)
            views.setViewVisibility(R.id.widget_fav_header, if (favorites.isEmpty()) View.GONE else View.VISIBLE)
            views.setViewVisibility(R.id.widget_fav_empty, if (favorites.isEmpty()) View.VISIBLE else View.GONE)
            rowIds.forEachIndexed { i, id ->
                val row = favorites.getOrNull(i)
                if (row == null) {
                    views.setViewVisibility(id, View.GONE)
                } else {
                    views.setViewVisibility(id, View.VISIBLE)
                    views.setTextViewText(id, listOf(row.title, row.artist).filter { it.isNotEmpty() }.joinToString(" – "))
                    views.setOnClickPendingIntent(id, Widgets.playTile(context, "list", i, row))
                }
            }
            return views
        }

        private const val ART_PX = 160
    }
}

/** Art-forward 4x2 player: big cover, title, artist, heart, prev / play / next. */
class NowPlayingLargeWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = refreshOnUpdate(context)
    override fun onEnabled(context: Context) = refreshOnUpdate(context)

    companion object {
        internal fun render(context: Context, data: WidgetData): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_now_playing_large)
            bindNowPlaying(context, views, data.state, ART_PX)
            views.setImageViewResource(
                R.id.widget_play_pause,
                if (data.state.playing) R.drawable.ic_widget_pause_dark else R.drawable.ic_widget_play_dark,
            )
            views.setImageViewResource(
                R.id.widget_favorite,
                if (data.currentIsFavorite) R.drawable.ic_widget_heart else R.drawable.ic_widget_heart_outline,
            )
            views.setContentDescription(R.id.widget_favorite, context.getString(R.string.widget_favorite))
            views.setViewVisibility(R.id.widget_favorite, if (data.state.hasTrack) View.VISIBLE else View.INVISIBLE)
            views.setOnClickPendingIntent(R.id.widget_favorite, Widgets.toggleFavorite(context))
            return views
        }

        private const val ART_PX = 320
    }
}

/** Slim 4x1 player: small cover, title and artist, prev / play / next. */
class NowPlayingCompactWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = refreshOnUpdate(context)
    override fun onEnabled(context: Context) = refreshOnUpdate(context)

    companion object {
        internal fun render(context: Context, data: WidgetData): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_now_playing_compact)
            bindNowPlaying(context, views, data.state, ART_PX)
            views.setImageViewResource(
                R.id.widget_play_pause,
                if (data.state.playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
            )
            return views
        }

        private const val ART_PX = 160
    }
}

/**
 * Quick picks: a grid of cover tiles from what was played recently (falling back to favorites);
 * tapping a tile plays it with that list queued around it.
 */
class QuickPicksWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = refreshOnUpdate(context)
    override fun onEnabled(context: Context) = refreshOnUpdate(context)

    companion object {
        private val cells = listOf(
            Triple(R.id.pick_1, R.id.pick_1_art, R.id.pick_1_title),
            Triple(R.id.pick_2, R.id.pick_2_art, R.id.pick_2_title),
            Triple(R.id.pick_3, R.id.pick_3_art, R.id.pick_3_title),
            Triple(R.id.pick_4, R.id.pick_4_art, R.id.pick_4_title),
            Triple(R.id.pick_5, R.id.pick_5_art, R.id.pick_5_title),
            Triple(R.id.pick_6, R.id.pick_6_art, R.id.pick_6_title),
            Triple(R.id.pick_7, R.id.pick_7_art, R.id.pick_7_title),
            Triple(R.id.pick_8, R.id.pick_8_art, R.id.pick_8_title),
        )

        /** Recent listening first, topped up by favorites that are not already shown. */
        internal fun picks(data: WidgetData): List<Tile> =
            (data.recents + data.favorites.filter { fav -> data.recents.none { it.trackId == fav.trackId } })
                .take(Widgets.QUICK_PICKS)

        internal fun render(context: Context, data: WidgetData): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_quick_picks)
            val picks = picks(data)
            views.setViewVisibility(R.id.picks_empty, if (picks.isEmpty()) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.picks_row_2, if (picks.size > 4) View.VISIBLE else View.GONE)
            views.setOnClickPendingIntent(R.id.picks_header, Widgets.openApp(context))
            cells.forEachIndexed { i, (cell, art, title) ->
                val tile = picks.getOrNull(i)
                if (tile == null) {
                    views.setViewVisibility(cell, View.INVISIBLE)
                } else {
                    views.setViewVisibility(cell, View.VISIBLE)
                    views.setImageViewBitmap(art, WidgetArt.tile(context, tile.artUri, tile.title, ART_PX))
                    views.setTextViewText(title, tile.title)
                    views.setOnClickPendingIntent(cell, Widgets.playTile(context, "pick", i, tile))
                }
            }
            return views
        }

        private const val ART_PX = 200
    }
}
