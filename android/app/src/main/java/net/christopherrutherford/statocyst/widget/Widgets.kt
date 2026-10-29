package net.christopherrutherford.statocyst.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.widget.RemoteViews
import androidx.media3.session.MediaButtonReceiver
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.R
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.media.ArtKey
import net.christopherrutherford.statocyst.media.BrowseIds
import net.christopherrutherford.statocyst.media.SourceResolver
import java.util.concurrent.Executors

/** One song in a widget list or grid; [contextId] is the browse folder it is queued from when tapped. */
data class Tile(
    val trackId: String,
    val title: String,
    val artist: String,
    val artUri: String?,
    val contextId: String,
)

/** Everything a widget renders; loaded once per refresh and shared by every placed widget. */
data class WidgetData(
    val state: WidgetState,
    val currentIsFavorite: Boolean = false,
    val favorites: List<Tile> = emptyList(),
    val recents: List<Tile> = emptyList(),
    /** Recently played songs (not collapsed to one per album), newest first; feeds the speed dial. */
    val history: List<Tile> = emptyList(),
)

/** The set of home-screen widgets and the one place that re-renders them. */
object Widgets {
    const val LIST_ROWS = 4
    const val QUICK_PICKS = 8
    const val SPEED_DIAL = 24

    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "widget-render").apply { isDaemon = true } }

    private val providers: List<Pair<Class<out AppWidgetProvider>, (Context, WidgetData) -> RemoteViews>> = listOf(
        NowPlayingWidget::class.java to NowPlayingWidget::render,
        NowPlayingLargeWidget::class.java to NowPlayingLargeWidget::render,
        NowPlayingCompactWidget::class.java to NowPlayingCompactWidget::render,
        QuickPicksWidget::class.java to QuickPicksWidget::render,
        SpeedDialWidget::class.java to SpeedDialWidget::render,
    )

    /** Re-renders every placed widget on a worker thread (database and artwork reads). */
    fun refresh(context: Context) {
        val app = context.applicationContext
        val manager = AppWidgetManager.getInstance(app)
        val placed = providers
            .map { (cls, render) -> Triple(manager.getAppWidgetIds(ComponentName(app, cls)), render, cls) }
            .filter { it.first.isNotEmpty() }
        if (placed.isEmpty()) return
        worker.execute {
            try {
                val data = load(app)
                placed.forEach { (ids, render, cls) ->
                    manager.updateAppWidget(ids, render(app, data))
                    if (cls == SpeedDialWidget::class.java) manager.notifyAppWidgetViewDataChanged(ids, R.id.dial_grid)
                }
            } catch (e: Exception) {
                android.util.Log.w("Widgets", "render failed", e)
            }
        }
    }

    internal fun load(context: Context): WidgetData = runBlocking {
        val db = StatocystDatabase.getInstance(context)
        val resolver = SourceResolver(context)
        val state = WidgetStateStore(context).load()
        val favoriteIds = db.userDao().favorites().map { it.trackId }
        val recentIds = db.userDao().recents(100).map { it.trackId }

        suspend fun tiles(ids: List<String>, contextId: String, limit: Int, distinctAlbums: Boolean): List<Tile> {
            val out = mutableListOf<Tile>()
            val seenAlbums = mutableSetOf<String>()
            for (id in ids) {
                if (out.size >= limit) break
                val item = db.mediaItemDao().getById(id)?.takeUnless { it.missing } ?: continue
                if (distinctAlbums && !seenAlbums.add("${item.albumArtist ?: item.artist}::${item.album}")) continue
                out.add(Tile(item.id, item.title, item.artist, artwork(resolver, item), contextId))
            }
            return out
        }

        WidgetData(
            state = state,
            currentIsFavorite = state.trackId?.let { it in favoriteIds } ?: false,
            favorites = tiles(favoriteIds, BrowseIds.FAVORITES, SPEED_DIAL, distinctAlbums = false),
            recents = tiles(recentIds, BrowseIds.RECENTS, QUICK_PICKS, distinctAlbums = true),
            history = tiles(recentIds, BrowseIds.RECENTS, SPEED_DIAL, distinctAlbums = false),
        )
    }

    private fun artwork(resolver: SourceResolver, item: MediaItemEntity): String? =
        resolver.artwork(item.albumId, item.jellyfinImageTag, ArtKey(item.albumArtist ?: item.artist, item.album))

    // ---- PendingIntents -------------------------------------------------------------------

    private const val FLAGS = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    /** Media3's receiver also revives the service and the saved queue when the process is gone. */
    fun mediaKey(context: Context, keyCode: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
            .setComponent(ComponentName(context, MediaButtonReceiver::class.java))
            .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        return PendingIntent.getBroadcast(context, keyCode, intent, FLAGS)
    }

    fun openApp(context: Context): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
        return PendingIntent.getActivity(context, 0, launch, FLAGS)
    }

    /** Plays [tile] with its folder queued around it. [slot] keeps each widget cell's intent distinct. */
    fun playTile(context: Context, kind: String, slot: Int, tile: Tile): PendingIntent {
        val intent = Intent(WidgetActionReceiver.ACTION_PLAY_TRACK)
            .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
            .setData(Uri.parse("statocyst://widget/$kind/$slot"))
            .putExtra(WidgetActionReceiver.EXTRA_TRACK_ID, tile.trackId)
            .putExtra(WidgetActionReceiver.EXTRA_CONTEXT, tile.contextId)
        return PendingIntent.getBroadcast(context, kind.hashCode() + slot, intent, FLAGS)
    }

    /** Template for a collection widget; each item supplies the track through a fill-in intent. */
    fun playTemplate(context: Context): PendingIntent {
        val intent = Intent(WidgetActionReceiver.ACTION_PLAY_TRACK)
            .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
        return PendingIntent.getBroadcast(context, 11, intent, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun toggleFavorite(context: Context): PendingIntent {
        val intent = Intent(WidgetActionReceiver.ACTION_TOGGLE_FAVORITE)
            .setComponent(ComponentName(context, WidgetActionReceiver::class.java))
        return PendingIntent.getBroadcast(context, 7, intent, FLAGS)
    }
}
