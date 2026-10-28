package net.christopherrutherford.statocyst.media

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import net.christopherrutherford.statocyst.R
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.RecentEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase

/**
 * The single owner of audio on Android. The ExoPlayer here holds the real queue
 * (including shuffle/repeat), and is driven by the WebView (through a
 * MediaController), the notification, hardware buttons and Android Auto alike,
 * so every surface sees the same state. Serves the Auto browse tree from the
 * local Room catalog with no WebView involvement.
 */
class PlaybackService : MediaLibraryService() {

    private val database by lazy { StatocystDatabase.getInstance(this) }
    private val dao by lazy { database.mediaItemDao() }
    private val resolver by lazy { SourceResolver(this) }
    private val userDao by lazy { database.userDao() }
    private val queueStore by lazy { QueueStore(this) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val player: ExoPlayer by lazy {
        ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true,
            )
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_NETWORK)
            addListener(object : Player.Listener {
                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    persistQueue()
                    prefetchCurrent(mediaItem)
                    recordRecent(mediaItem)
                }
                override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                    persistQueue()
                    notifyBrowseChanged(BrowseIds.QUEUE)
                }
                override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = persistQueue()
                override fun onRepeatModeChanged(repeatMode: Int) = persistQueue()
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying) consecutiveErrors = 0 else persistQueue()
                }
                override fun onPositionDiscontinuity(
                    oldPosition: Player.PositionInfo,
                    newPosition: Player.PositionInfo,
                    reason: Int,
                ) {
                    if (reason == Player.DISCONTINUITY_REASON_SEEK ||
                        reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
                    ) {
                        persistQueue()
                    }
                }
                override fun onPlayerError(error: PlaybackException) {
                    android.util.Log.w(TAG, "player error: ${error.errorCodeName}", error)
                    // Skip an unplayable item (offline, expired token, deleted file) instead
                    // of stalling, but stop once every remaining item has failed in a row.
                    if (++consecutiveErrors <= mediaItemCount && hasNextMediaItem()) {
                        seekToNextMediaItem()
                        prepare()
                    }
                }
            })
        }
    }

    private var consecutiveErrors = 0

    private lateinit var librarySession: MediaLibraryService.MediaLibrarySession

    @Volatile
    private var cachedTracks: List<MediaItemEntity>? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Create notification channel
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = android.app.NotificationChannel(
                CHANNEL_ID,
                getString(R.string.app_name),
                android.app.NotificationManager.IMPORTANCE_LOW,
            )
            val nm = getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.createNotificationChannel(channel)
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, Class.forName("net.christopherrutherford.statocyst.MainActivity"))
        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        librarySession = MediaLibraryService.MediaLibrarySession.Builder(
            this,
            player,
            LibrarySessionCallback(),
        )
            .setSessionActivity(sessionActivity)
            .build()
        // Media3 owns the (single) media notification and the foreground state:
        // it promotes the service when playback starts and demotes it on pause.
        try {
            val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setChannelName(R.string.app_name)
                .build()
            setMediaNotificationProvider(notificationProvider)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "notification provider setup failed", e)
        }
        restoreQueue()
    }

    override fun onGetSession(
        controllerInfo: MediaSession.ControllerInfo,
    ): MediaLibraryService.MediaLibrarySession = librarySession

    override fun onDestroy() {
        try {
            persistQueue()
        } catch (e: Exception) {
            android.util.Log.w(TAG, "final persist failed", e)
        }
        if (instance === this) instance = null
        scope.cancel()
        librarySession.release()
        player.release()
        super.onDestroy()
    }

    /** Drops the cached track list so the next browse reads fresh rows. */
    private fun dropCatalogCache() {
        cachedTracks = null
    }

    /** Tells subscribed browsers (Auto) that [folders] changed so they re-fetch them. */
    private fun notifyBrowseChanged(vararg folders: String) {
        if (!::librarySession.isInitialized) return
        for (folder in folders) {
            librarySession.notifyChildrenChanged(folder, Int.MAX_VALUE, null)
        }
        librarySession.notifyChildrenChanged(BrowseIds.ROOT, Int.MAX_VALUE, null)
    }

    private suspend fun tracks(): List<MediaItemEntity> {
        cachedTracks?.let { return it }
        return withContext(Dispatchers.IO) { dao.getAll() }.also { cachedTracks = it }
    }

    /** Catalog + favorites/playlists/recents + the live queue. Must run on the main thread. */
    private suspend fun browseData(): BrowseData {
        val catalog = tracks()
        val user = withContext(Dispatchers.IO) {
            Triple(userDao.favorites(), userDao.recents(RECENT_LIMIT), Pair(userDao.playlists(), userDao.playlistTracks()))
        }
        val (favorites, recents, playlistRows) = user
        val tracksByPlaylist = playlistRows.second.groupBy { it.playlistId }
        return BrowseData(
            tracks = catalog,
            // Web order is oldest-first; Auto shows the most recent favorite on top.
            favorites = favorites.sortedByDescending { it.position }.map { it.trackId },
            playlists = playlistRows.first.map { pl ->
                PlaylistInfo(pl.id, pl.name, tracksByPlaylist[pl.id].orEmpty().map { it.trackId })
            },
            recents = recents.map { it.trackId },
            queue = (0 until player.mediaItemCount).map {
                val item = player.getMediaItemAt(it)
                QueueEntry(item.mediaId, QueueItems.trackIdOf(item))
            },
        )
    }

    private fun recordRecent(item: MediaItem?) {
        item ?: return
        val trackId = QueueItems.trackIdOf(item)
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    userDao.upsertRecent(RecentEntity(trackId, System.currentTimeMillis()))
                    userDao.trimRecents(RECENT_LIMIT)
                }
                notifyBrowseChanged(BrowseIds.RECENTS)
            } catch (e: Exception) {
                android.util.Log.w(TAG, "recordRecent failed", e)
            }
        }
    }

    /** Runs [block] off the session thread and exposes it as a Media3-friendly future. */
    private fun <T> future(label: String, block: suspend () -> T): ListenableFuture<T> {
        val future = SettableFuture.create<T>()
        scope.launch {
            try {
                future.set(block())
            } catch (e: CancellationException) {
                future.cancel(false)
                throw e
            } catch (e: Exception) {
                android.util.Log.w(TAG, "$label failed", e)
                future.setException(e)
            }
        }
        return future
    }

    private fun prefetchCurrent(item: MediaItem?) {
        item ?: return
        val trackId = QueueItems.trackIdOf(item)
        if (item.localConfiguration?.uri?.host?.let { it != "127.0.0.1" } == true) {
            resolver.prefetch(trackId)
        }
    }

    /** Resolves a queue slot placeholder into a playable item with full metadata. */
    private suspend fun resolveItem(item: MediaItem): MediaItem? {
        val trackId = QueueItems.trackIdOf(item)
        val prepared = resolver.prepare(trackId) ?: return null
        val entityMeta = MediaMetadata.Builder()
            .setTitle(prepared.entity.title)
            .setArtist(prepared.entity.artist)
            .setAlbumTitle(prepared.entity.album)
            .setAlbumArtist(prepared.entity.albumArtist)
            .setDurationMs(prepared.entity.durationMs.takeIf { it > 0 })
            .setIsPlayable(true)
            .setIsBrowsable(false)
            .setExtras(android.os.Bundle().apply { putString(QueueItems.EXTRA_TRACK_ID, trackId) })
        resolver.artworkUrl(prepared.entity.albumId, prepared.entity.jellyfinImageTag)
            ?.let { entityMeta.setArtworkUri(Uri.parse(it)) }
        val entryId = if (QueueItems.isSlot(item)) item.mediaId else QueueItems.newEntryId()
        return MediaItem.Builder()
            .setMediaId(entryId)
            .setUri(Uri.parse(prepared.uri))
            .setMediaMetadata(entityMeta.build())
            .build()
    }

    private fun restoreQueue() {
        scope.launch {
            try {
                val saved = queueStore.load() ?: return@launch
                val items = mutableListOf<MediaItem>()
                var index = saved.index
                saved.slots.forEachIndexed { i, slot ->
                    val resolved = resolveItem(QueueItems.placeholder(slot.entryId, slot.trackId))
                    if (resolved != null) items.add(resolved) else if (i < saved.index) index -= 1
                }
                if (items.isEmpty()) return@launch
                player.shuffleModeEnabled = saved.shuffle
                player.repeatMode = saved.repeatMode
                player.setMediaItems(items, index.coerceIn(0, items.size - 1), saved.positionMs)
                player.prepare()
            } catch (e: Exception) {
                android.util.Log.w(TAG, "restoreQueue failed", e)
            }
        }
    }

    private fun persistQueue() {
        try {
            if (player.mediaItemCount == 0) return
            val slots = (0 until player.mediaItemCount).map {
                val item = player.getMediaItemAt(it)
                QueueSlot(item.mediaId, QueueItems.trackIdOf(item))
            }
            queueStore.save(
                SavedQueue(
                    slots = slots,
                    index = player.currentMediaItemIndex.coerceAtLeast(0),
                    positionMs = player.currentPosition.coerceAtLeast(0),
                    shuffle = player.shuffleModeEnabled,
                    repeatMode = player.repeatMode,
                ),
            )
        } catch (e: Exception) {
            android.util.Log.w(TAG, "persistQueue failed", e)
        }
    }

    private fun ChildStyle.hint(): Int = when (this) {
        ChildStyle.GRID -> MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM
        ChildStyle.LIST -> MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM
    }

    private fun toMediaItem(node: BrowseNode): MediaItem {
        val metadataBuilder = MediaMetadata.Builder()
            .setTitle(node.title)
            .apply { node.subtitle?.let { setArtist(it) } }
            .apply { node.trackNumber?.let { setTrackNumber(it) } }
            .setIsBrowsable(!node.playable)
            .setIsPlayable(node.playable)
        node.childStyle?.let { style ->
            metadataBuilder.setExtras(
                android.os.Bundle().apply {
                    putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, style.hint())
                    putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
                },
            )
        }
        val artUrl = resolver.artworkUrl(node.albumId, node.imageTag)
        if (artUrl != null) {
            metadataBuilder.setArtworkUri(Uri.parse(artUrl))
        }
        val metadata = metadataBuilder.build()
        val builder = MediaItem.Builder()
            .setMediaId(node.id)
            .setMediaMetadata(metadata)
        if (node.playable) {
            builder.setRequestMetadata(
                MediaItem.RequestMetadata.Builder()
                    .setMediaUri(Uri.parse("statocyst://track/${node.trackId ?: node.id}"))
                    .build(),
            )
        }
        return builder.build()
    }

    private inner class LibrarySessionCallback :
        MediaLibraryService.MediaLibrarySession.Callback {

        override fun onGetLibraryRoot(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(
                LibraryResult.ofItem(
                    toMediaItem(BrowseTree.root()),
                    // Defaults for every folder; folders override them with their own hints.
                    MediaLibraryService.LibraryParams.Builder()
                        .setExtras(
                            android.os.Bundle().apply {
                                putInt(
                                    MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                                    MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
                                )
                                putInt(
                                    MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                                    MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
                                )
                            },
                        )
                        .setOffline(true)
                        .build(),
                ),
            )

        override fun onGetItem(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            return future("onGetItem($mediaId)") {
                val node = BrowseTree.node(mediaId, browseData())
                if (node != null) LibraryResult.ofItem(toMediaItem(node), null)
                else LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
            }
        }

        override fun onGetChildren(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            return future("onGetChildren($parentId)") {
                val children = BrowseTree.children(parentId, browseData(), page, pageSize).map(::toMediaItem)
                LibraryResult.ofItemList(children, params)
            }
        }

        /**
         * "Play" from a browse list: a queue row jumps within the current queue, and a
         * track listed in a folder queues that folder around it, so next/previous work.
         */
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val only = mediaItems.singleOrNull()
            val queueEntry = only?.mediaId?.let(BrowseIds::queueEntryId)
            val context = only?.mediaId?.let(BrowseIds::contextOf)
            val trackId = only?.mediaId?.let(BrowseIds::trackEntityId)
            if (queueEntry == null && (context == null || trackId == null)) {
                return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
            }
            return future("onSetMediaItems(${only?.mediaId})") {
                if (queueEntry != null) {
                    val current = (0 until player.mediaItemCount).map { player.getMediaItemAt(it) }
                    val at = current.indexOfFirst { it.mediaId == queueEntry }
                    if (at < 0) return@future MediaSession.MediaItemsWithStartPosition(emptyList(), C.INDEX_UNSET, C.TIME_UNSET)
                    return@future MediaSession.MediaItemsWithStartPosition(current, at, 0L)
                }
                val ids = BrowseTree.contextTrackIds(context!!, browseData())
                val at = ids?.indexOf(trackId!!) ?: -1
                if (ids == null || at < 0) {
                    val single = listOfNotNull(resolveItem(only!!))
                    return@future MediaSession.MediaItemsWithStartPosition(single, 0, 0L)
                }
                val (windowIds, windowAt) = BrowseTree.window(ids, at)
                val items = windowIds.mapNotNull { id ->
                    resolveItem(QueueItems.placeholder(QueueItems.newEntryId(), id))
                }
                // Dropped (unresolvable) items before the target shift its index.
                val target = items.indexOfFirst { QueueItems.trackIdOf(it) == trackId }.coerceAtLeast(0)
                MediaSession.MediaItemsWithStartPosition(items, if (items.isEmpty()) C.INDEX_UNSET else target.coerceAtMost(items.size - 1), 0L).also {
                    android.util.Log.i(TAG, "play $trackId from $context: ${items.size} queued (window at $windowAt)")
                }
            }
        }

        /**
         * Turns queue placeholders (WebView) and browse items (Android Auto) into
         * playable slots. Resolution is async so the session thread never blocks.
         * Unresolvable items are dropped; controllers re-sync from the queue event.
         */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> {
            return future("onAddMediaItems") {
                mediaItems.mapNotNull { item ->
                    resolveItem(item).also {
                        if (it == null) android.util.Log.w(TAG, "dropping unresolvable ${item.mediaId}")
                    }
                }.toMutableList()
            }
        }
    }

    companion object {
        private const val TAG = "PlaybackService"
        private const val CHANNEL_ID = "statocyst_media"
        private const val RECENT_LIMIT = 100

        @Volatile
        private var instance: PlaybackService? = null

        /** Library sync finished: re-read the catalog and refresh every browse folder. */
        fun onCatalogChanged() = instance?.let { svc ->
            svc.scope.launch {
                svc.dropCatalogCache()
                svc.notifyBrowseChanged(*BrowseIds.ROOT_FOLDERS.toTypedArray())
            }
        }

        /** Favorites/playlists were replaced by the web layer. */
        fun onUserStateChanged() = instance?.let { svc ->
            svc.scope.launch { svc.notifyBrowseChanged(BrowseIds.FAVORITES, BrowseIds.PLAYLISTS) }
        }
    }
}
