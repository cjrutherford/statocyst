package net.christopherrutherford.statocyst.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.view.KeyEvent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import net.christopherrutherford.statocyst.R

/** Shared by the three now-playing layouts: title, artist, artwork and the play/pause icon. */
internal fun bindNowPlaying(context: Context, views: RemoteViews, state: WidgetState, artPx: Int, withEyebrow: Boolean = true) {
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
    views.setImageViewResource(
        R.id.widget_play_pause,
        if (state.playing) R.drawable.ic_widget_pause_dark else R.drawable.ic_widget_play_dark,
    )
    if (withEyebrow) {
        views.setTextViewText(
            R.id.widget_eyebrow,
            context.getString(
                when {
                    !state.hasTrack -> R.string.widget_eyebrow_idle
                    state.playing -> R.string.widget_eyebrow_playing
                    else -> R.string.widget_eyebrow_paused
                },
            ),
        )
    }
    views.setContentDescription(
        R.id.widget_play_pause,
        context.getString(if (state.playing) R.string.widget_pause else R.string.widget_play),
    )
    views.setOnClickPendingIntent(R.id.widget_prev, Widgets.mediaKey(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS))
    views.setOnClickPendingIntent(R.id.widget_play_pause, Widgets.mediaKey(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
    views.setOnClickPendingIntent(R.id.widget_next, Widgets.mediaKey(context, KeyEvent.KEYCODE_MEDIA_NEXT))
    views.setOnClickPendingIntent(R.id.widget_header, Widgets.openApp(context))
}

/** "1  Title \u2013 Artist": the rank in cyan, then the artist in the muted tone. */
internal fun rowText(rank: Int, row: Tile): CharSequence {
    val lead = "$rank  "
    val title = lead + row.title
    val text = android.text.SpannableString(if (row.artist.isEmpty()) title else "$title \u2013 ${row.artist}")
    text.setSpan(android.text.style.ForegroundColorSpan(0xFF38E1FF.toInt()), 0, 1, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (row.artist.isNotEmpty()) {
        text.setSpan(
            android.text.style.ForegroundColorSpan(0xFFA9C0D8.toInt()),
            title.length, text.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
    }
    return text
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
            val favorites = data.favorites.take(Widgets.LIST_ROWS)
            views.setViewVisibility(R.id.widget_fav_header, if (favorites.isEmpty()) View.GONE else View.VISIBLE)
            views.setViewVisibility(R.id.widget_fav_empty, if (favorites.isEmpty()) View.VISIBLE else View.GONE)
            rowIds.forEachIndexed { i, id ->
                val row = favorites.getOrNull(i)
                if (row == null) {
                    views.setViewVisibility(id, View.GONE)
                } else {
                    views.setViewVisibility(id, View.VISIBLE)
                    views.setTextViewText(id, rowText(i + 1, row))
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
            bindNowPlaying(context, views, data.state, ART_PX, withEyebrow = false)
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

/**
 * Speed dial: a scrolling grid of covers that mixes listening history with favorites, using
 * whichever of the two the library has. Tapping a cover plays it with its list queued around it.
 */
class SpeedDialWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = refreshOnUpdate(context)
    override fun onEnabled(context: Context) = refreshOnUpdate(context)

    companion object {
        /** History and favorites interleaved, history first, with songs in both lists shown once. */
        internal fun mix(data: WidgetData): List<Tile> {
            val out = LinkedHashMap<String, Tile>()
            val history = data.history.iterator()
            val favorites = data.favorites.iterator()
            while (history.hasNext() || favorites.hasNext()) {
                if (history.hasNext()) history.next().let { out.putIfAbsent(it.trackId, it) }
                if (favorites.hasNext()) favorites.next().let { out.putIfAbsent(it.trackId, it) }
            }
            return out.values.take(Widgets.SPEED_DIAL)
        }

        internal fun label(context: Context, data: WidgetData): String = context.getString(
            when {
                data.history.isNotEmpty() && data.favorites.isNotEmpty() -> R.string.widget_history_and_favorites
                data.favorites.isNotEmpty() -> R.string.widget_favorites_label
                data.history.isNotEmpty() -> R.string.widget_history
                else -> R.string.widget_speed_dial
            },
        )

        internal fun render(context: Context, data: WidgetData): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_speed_dial)
            views.setTextViewText(R.id.dial_header, label(context, data))
            views.setRemoteAdapter(R.id.dial_grid, Intent(context, SpeedDialService::class.java))
            views.setEmptyView(R.id.dial_grid, R.id.dial_empty)
            views.setPendingIntentTemplate(R.id.dial_grid, Widgets.playTemplate(context))
            return views
        }
    }
}

/** Supplies the speed dial grid; re-reads the library whenever the widget is told its data changed. */
class SpeedDialService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    internal class Factory(private val context: Context) : RemoteViewsFactory {
        private var tiles = emptyList<Tile>()

        override fun onCreate() = Unit
        override fun onDataSetChanged() {
            tiles = SpeedDialWidget.mix(Widgets.load(context))
        }
        override fun onDestroy() { tiles = emptyList() }
        override fun getCount() = tiles.size
        override fun getViewAt(position: Int): RemoteViews = item(context, tiles[position])
        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount() = 1
        override fun getItemId(position: Int) = tiles.getOrNull(position)?.trackId.hashCode().toLong()
        override fun hasStableIds() = true

        companion object {
            internal fun item(context: Context, tile: Tile): RemoteViews {
                val views = RemoteViews(context.packageName, R.layout.widget_speed_dial_item)
                views.setImageViewBitmap(R.id.dial_item_art, WidgetArt.tile(context, tile.artUri, tile.title, 160))
                views.setTextViewText(R.id.dial_item_title, tile.title)
                views.setOnClickFillInIntent(
                    R.id.dial_item,
                    Intent()
                        .putExtra(WidgetActionReceiver.EXTRA_TRACK_ID, tile.trackId)
                        .putExtra(WidgetActionReceiver.EXTRA_CONTEXT, tile.contextId),
                )
                return views
            }
        }
    }
}
