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
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import net.christopherrutherford.statocyst.jellyfin.JellyfinAuth
import net.christopherrutherford.statocyst.radio.RadioBuilder
import net.christopherrutherford.statocyst.radio.RadioScorer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList as GuavaList
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
    private var contextTail: ContextTail? = null
    private var positionTicker: kotlinx.coroutines.Job? = null

    private val player: ExoPlayer by lazy {
        ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(JellyfinAuth.dataSourceFactory(this)))
            .build().apply {
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
                    extendContext()
                    prefetchCurrent(mediaItem)
                    recordRecent(mediaItem)
                    refreshButtons()
                }
                override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                    persistQueue()
                    notifyBrowseChanged(BrowseIds.QUEUE)
                }
                override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
                    persistQueue()
                    refreshButtons()
                }
                override fun onRepeatModeChanged(repeatMode: Int) {
                    persistQueue()
                    refreshButtons()
                }
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying) {
                        consecutiveErrors = 0
                        startPositionTicker()
                    } else {
                        positionTicker?.cancel()
                        persistQueue()
                    }
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
                    reportFailure(error)
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

    /** Tells the car and notification why a song failed instead of just skipping it. */
    private fun reportFailure(error: PlaybackException) {
        val http = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
        val failure = PlaybackFailures.describe(error.errorCode, http)
        if (::librarySession.isInitialized) {
            librarySession.sendError(SessionError(failure.sessionCode, failure.message))
        }
    }

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
            .setBitmapLoader(
                DataSourceBitmapLoader(
                    DataSourceBitmapLoader.DEFAULT_EXECUTOR_SERVICE.get(),
                    JellyfinAuth.dataSourceFactory(this),
                ),
            )
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
        loadFavorites()
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

    @Volatile
    private var favoriteIds: Set<String> = emptySet()

    private fun currentTrackId(): String? =
        if (player.mediaItemCount == 0) null else player.currentMediaItem?.let(QueueItems::trackIdOf)

    /** Shuffle / repeat / favorite as head-unit buttons; icons reflect the live state. */
    private fun buttons(): GuavaList<CommandButton> {
        val shuffle = CommandButton.Builder(
            if (player.shuffleModeEnabled) CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF,
        )
            .setDisplayName(getString(R.string.auto_shuffle))
            .setSessionCommand(SessionCommand(CMD_SHUFFLE, android.os.Bundle.EMPTY))
            .build()
        val repeat = CommandButton.Builder(
            when (player.repeatMode) {
                Player.REPEAT_MODE_ALL -> CommandButton.ICON_REPEAT_ALL
                Player.REPEAT_MODE_ONE -> CommandButton.ICON_REPEAT_ONE
                else -> CommandButton.ICON_REPEAT_OFF
            },
        )
            .setDisplayName(getString(R.string.auto_repeat))
            .setSessionCommand(SessionCommand(CMD_REPEAT, android.os.Bundle.EMPTY))
            .build()
        val favorite = currentTrackId()?.let { it in favoriteIds } ?: false
        val heart = CommandButton.Builder(
            if (favorite) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED,
        )
            .setDisplayName(getString(R.string.auto_favorite))
            .setSessionCommand(SessionCommand(CMD_FAVORITE, android.os.Bundle.EMPTY))
            .build()
        return GuavaList.of(shuffle, repeat, heart)
    }

    private fun refreshButtons() {
        if (!::librarySession.isInitialized) return
        librarySession.setMediaButtonPreferences(buttons())
    }

    private fun loadFavorites() {
        scope.launch {
            try {
                favoriteIds = withContext(Dispatchers.IO) { userDao.favorites().map { it.trackId }.toSet() }
                refreshButtons()
            } catch (e: Exception) {
                android.util.Log.w(TAG, "loadFavorites failed", e)
            }
        }
    }

    private fun toggleCurrentFavorite() {
        val trackId = currentTrackId() ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) { userDao.toggleFavorite(trackId) }
                val all = withContext(Dispatchers.IO) { userDao.favorites().map { it.trackId } }
                favoriteIds = all.toSet()
                refreshButtons()
                notifyBrowseChanged(BrowseIds.FAVORITES)
                favoritesListener?.invoke(all)
            } catch (e: Exception) {
                android.util.Log.w(TAG, "toggleFavorite failed", e)
            }
        }
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

    private fun isOnline(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Catalog + favorites/playlists/recents + the live queue. Must run on the main thread. */
    private suspend fun browseData(): BrowseData {
        val catalog = tracks()
        val user = withContext(Dispatchers.IO) {
            Triple(userDao.favorites(), userDao.recents(RECENT_LIMIT), Pair(userDao.playlists(), userDao.playlistTracks()))
        }
        val (favorites, recents, playlistRows) = user
        val hasRemote = catalog.any { it.sourceKind.startsWith("jellyfin") }
        val signedIn = !getSharedPreferences("statocyst", MODE_PRIVATE).getString("jellyfin_token", null).isNullOrEmpty()
        val notice = when {
            catalog.isEmpty() -> BrowseNotice.EMPTY_LIBRARY
            hasRemote && !signedIn -> BrowseNotice.SIGNED_OUT
            hasRemote && !isOnline() -> BrowseNotice.OFFLINE
            else -> null
        }
        val tracksByPlaylist = playlistRows.second.groupBy { it.playlistId }
        return BrowseData(
            tracks = catalog,
            notice = notice,
            currentTrackId = player.currentMediaItem?.let(QueueItems::trackIdOf),
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

    /** The persisted queue rebuilt into playable items, or null when nothing usable is saved. */
    private suspend fun savedQueue(): MediaSession.MediaItemsWithStartPosition? {
        val saved = queueStore.load() ?: return null
        val items = mutableListOf<MediaItem>()
        var index = saved.index
        saved.slots.forEachIndexed { i, slot ->
            val resolved = resolveItem(QueueItems.placeholder(slot.entryId, slot.trackId))
            if (resolved != null) items.add(resolved) else if (i < saved.index) index -= 1
        }
        if (items.isEmpty()) return null
        return MediaSession.MediaItemsWithStartPosition(items, index.coerceIn(0, items.size - 1), saved.positionMs)
    }

    private fun restoreQueue() {
        scope.launch {
            try {
                val saved = queueStore.load() ?: return@launch
                val restored = savedQueue() ?: return@launch
                // A controller may have started something while we were resolving.
                if (player.mediaItemCount > 0) return@launch
                player.shuffleModeEnabled = saved.shuffle
                player.repeatMode = saved.repeatMode
                player.setMediaItems(restored.mediaItems, restored.startIndex, restored.startPositionMs)
                player.prepare()
            } catch (e: Exception) {
                android.util.Log.w(TAG, "restoreQueue failed", e)
            }
        }
    }

    /** While playing, records the position every few seconds so a killed process resumes close to where it was. */
    private fun startPositionTicker() {
        positionTicker?.cancel()
        positionTicker = scope.launch {
            while (true) {
                kotlinx.coroutines.delay(POSITION_SAVE_MS)
                if (player.mediaItemCount > 0) {
                    queueStore.savePosition(
                        player.currentMediaItemIndex.coerceAtLeast(0),
                        player.currentPosition.coerceAtLeast(0),
                    )
                }
            }
        }
    }

    /** Appends the next chunk of a windowed browse context when playback nears the end of the queue. */
    private fun extendContext() {
        val tail = contextTail ?: return
        val count = player.mediaItemCount
        if (count == 0) return
        val lastEntry = player.getMediaItemAt(count - 1).mediaId
        if (!tail.continues(lastEntry)) {
            contextTail = null
            return
        }
        if (!tail.due(count - 1 - player.currentMediaItemIndex, player.shuffleModeEnabled)) return
        scope.launch {
            try {
                // Re-check after the suspend point: the queue may have changed meanwhile.
                if (contextTail !== tail || !tail.continues(player.getMediaItemAt(player.mediaItemCount - 1).mediaId)) return@launch
                val items = tail.next().mapNotNull { resolveItem(QueueItems.placeholder(QueueItems.newEntryId(), it)) }
                if (items.isEmpty()) {
                    contextTail = null
                    return@launch
                }
                tail.reanchor(items.last().mediaId)
                player.addMediaItems(items)
                android.util.Log.i(TAG, "context extended by ${items.size}; ${tail.remaining} left")
                if (tail.remaining == 0) contextTail = null
            } catch (e: Exception) {
                android.util.Log.w(TAG, "extendContext failed", e)
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

    private fun mayBrowse(browser: MediaSession.ControllerInfo): Boolean {
        val allowed = ControllerPolicy.mayBrowse(
            browser.packageName,
            packageName,
            browser.isTrusted,
            BrowseAccess.allowed(this),
        )
        if (!allowed) {
            android.util.Log.w(TAG, "browse denied for ${browser.packageName}")
            BrowseAccess.recordDenied(this, browser.packageName)
        }
        return allowed
    }

    private fun <T : Any> deniedBrowse(): ListenableFuture<LibraryResult<T>> =
        Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED))

    private inner class LibrarySessionCallback :
        MediaLibraryService.MediaLibrarySession.Callback {

        override fun onGetLibraryRoot(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            if (!mayBrowse(browser)) deniedBrowse() else Futures.immediateFuture(
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

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(SessionCommand(CMD_SHUFFLE, android.os.Bundle.EMPTY))
                .add(SessionCommand(CMD_REPEAT, android.os.Bundle.EMPTY))
                .add(SessionCommand(CMD_FAVORITE, android.os.Bundle.EMPTY))
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .setMediaButtonPreferences(buttons())
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: android.os.Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                CMD_SHUFFLE -> player.shuffleModeEnabled = !player.shuffleModeEnabled
                CMD_REPEAT -> player.repeatMode = when (player.repeatMode) {
                    Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                    Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                    else -> Player.REPEAT_MODE_OFF
                }
                CMD_FAVORITE -> toggleCurrentFavorite()
                else -> return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> =
            future("onPlaybackResumption") {
                savedQueue() ?: throw UnsupportedOperationException("nothing to resume")
            }

        override fun onSearch(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<Void>> = future("onSearch($query)") {
            if (!mayBrowse(browser)) return@future LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED)
            val count = BrowseTree.search(query, browseData()).size
            session.notifySearchResultChanged(browser, query, count, params)
            LibraryResult.ofVoid()
        }

        override fun onGetSearchResult(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            page: Int,
            pageSize: Int,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = future("onGetSearchResult($query)") {
            if (!mayBrowse(browser)) return@future LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED)
            LibraryResult.ofItemList(
                BrowseTree.searchResult(query, browseData(), page, pageSize).map(::toMediaItem),
                params,
            )
        }

        override fun onGetItem(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            return future("onGetItem($mediaId)") {
                if (!mayBrowse(browser)) return@future LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED)
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
                if (!mayBrowse(browser)) return@future LibraryResult.ofError(LibraryResult.RESULT_ERROR_PERMISSION_DENIED)
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
            val voiceQuery = only?.takeIf { it.mediaId.isEmpty() || it.mediaId == MediaItem.DEFAULT_MEDIA_ID }
                ?.requestMetadata?.let { voiceQueryOf(it) }
            if (voiceQuery != null) {
                return future("voice($voiceQuery)") { playFromVoice(voiceQuery) }
            }
            val radioSeed = only?.mediaId?.let(BrowseIds::radioSeed)
            if (radioSeed != null) {
                return future("radio($radioSeed)") { playRadio(radioSeed) }
            }
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
                contextTail = if (items.isEmpty()) null
                else ContextTail.after(ids, (at - windowAt) + windowIds.size, items.last().mediaId)
                MediaSession.MediaItemsWithStartPosition(items, if (items.isEmpty()) C.INDEX_UNSET else target.coerceAtMost(items.size - 1), 0L).also {
                    android.util.Log.i(TAG, "play $trackId from $context: ${items.size} queued (window at $windowAt)")
                }
            }
        }

        /** Queues a song radio: the seed first, then similar songs. Nothing is queued when the seed is gone. */
        private suspend fun playRadio(seedId: String): MediaSession.MediaItemsWithStartPosition {
            val radio = RadioBuilder(this@PlaybackService).build(seedId)
            val items = radio?.trackIds.orEmpty().mapNotNull { resolveItem(QueueItems.placeholder(QueueItems.newEntryId(), it)) }
            android.util.Log.i(TAG, "radio $seedId: ${items.size} tracks via ${radio?.source}")
            player.shuffleModeEnabled = false
            return MediaSession.MediaItemsWithStartPosition(items, if (items.isEmpty()) C.INDEX_UNSET else 0, 0L)
        }

        /** "Play X" from Assistant / the car mic: queue the best matches (or something sensible for "play music"). */
        private suspend fun playFromVoice(query: String): MediaSession.MediaItemsWithStartPosition {
            val data = browseData()
            val ids = if (query.isBlank()) {
                val pool = (data.favorites + data.recents).distinct().filter { id -> data.tracks.any { it.id == id } }
                (pool.ifEmpty { data.tracks.map { it.id } }).shuffled().take(100).also { player.shuffleModeEnabled = true }
            } else {
                val seedQuery = RadioScorer.seedQueryOf(query)
                val seed = seedQuery?.takeIf { it.isNotEmpty() }?.let { BrowseTree.search(it, data, 1).firstOrNull() }
                if (seed != null) return playRadio(seed)
                BrowseTree.search(query, data)
            }
            val items = ids.mapNotNull { resolveItem(QueueItems.placeholder(QueueItems.newEntryId(), it)) }
            android.util.Log.i(TAG, "voice \"$query\": ${items.size} tracks")
            return MediaSession.MediaItemsWithStartPosition(items, if (items.isEmpty()) C.INDEX_UNSET else 0, 0L)
        }

        /** Text of a voice/search request; empty string means "play something". Null = not a search. */
        private fun voiceQueryOf(meta: MediaItem.RequestMetadata): String? {
            val extras = meta.extras
            val parts = listOfNotNull(
                meta.searchQuery,
                extras?.getString(android.provider.MediaStore.EXTRA_MEDIA_TITLE),
                extras?.getString(android.provider.MediaStore.EXTRA_MEDIA_ARTIST),
                extras?.getString(android.provider.MediaStore.EXTRA_MEDIA_ALBUM),
            ).map { it.trim() }.filter { it.isNotEmpty() }
            return when {
                parts.isNotEmpty() -> parts.joinToString(" ")
                meta.searchQuery != null -> ""
                else -> null
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
        private const val POSITION_SAVE_MS = 5_000L
        private const val CHANNEL_ID = "statocyst_media"
        private const val RECENT_LIMIT = 100
        private const val CMD_SHUFFLE = "statocyst.shuffle"
        private const val CMD_REPEAT = "statocyst.repeat"
        private const val CMD_FAVORITE = "statocyst.favorite"

        /** Set by the WebView plugin so favorites toggled from the car reach the web layer. */
        @Volatile
        var favoritesListener: ((List<String>) -> Unit)? = null

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
            svc.scope.launch {
                svc.loadFavorites()
                svc.notifyBrowseChanged(BrowseIds.FAVORITES, BrowseIds.PLAYLISTS)
            }
        }
    }
}
