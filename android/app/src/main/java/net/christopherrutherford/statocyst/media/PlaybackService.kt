package net.christopherrutherford.statocyst.media

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
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
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.R
import net.christopherrutherford.statocyst.db.MediaItemEntity
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
            addListener(object : Player.Listener {
                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    persistQueue()
                    prefetchCurrent(mediaItem)
                }
                override fun onTimelineChanged(timeline: Timeline, reason: Int) = persistQueue()
                override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = persistQueue()
                override fun onRepeatModeChanged(repeatMode: Int) = persistQueue()
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (!isPlaying) persistQueue()
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
                }
            })
        }
    }

    private lateinit var librarySession: MediaLibraryService.MediaLibrarySession

    @Volatile
    private var cachedTracks: List<MediaItemEntity>? = null

    override fun onCreate() {
        super.onCreate()
        // Create notification channel
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = android.app.NotificationChannel(
                "statocyst_media",
                getString(R.string.app_name),
                android.app.NotificationManager.IMPORTANCE_LOW
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
        // Show media controls/notification so Android Auto and lock screen can
        // control playback even when the app is not in the foreground.
        try {
            val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
                .setChannelId("statocyst_media")
                .setChannelName(R.string.app_name)
                .build()
            setMediaNotificationProvider(notificationProvider)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "notification provider setup failed", e)
        }
        // Ensure foreground service is started for media playback
        try {
            val notification = NotificationCompat.Builder(this, "statocyst_media")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("Media playback")
                .setOngoing(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build()
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(1, notification)
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "startForeground failed", e)
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
        scope.cancel()
        librarySession.release()
        player.release()
        super.onDestroy()
    }

    /** Drops the cached browse catalog so the next browse reads fresh rows. */
    fun invalidateCatalog() {
        cachedTracks = null
    }

    private fun tracks(): List<MediaItemEntity> {
        cachedTracks?.let { return it }
        return synchronized(this) {
            cachedTracks ?: runBlocking { dao.getAll() }.also { cachedTracks = it }
        }
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

    private fun toMediaItem(node: BrowseNode): MediaItem {
        val metadataBuilder = MediaMetadata.Builder()
            .setTitle(node.title)
            .apply { node.subtitle?.let { setArtist(it) } }
            .apply { node.trackNumber?.let { setTrackNumber(it) } }
            .setIsBrowsable(!node.playable)
            .setIsPlayable(node.playable)
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
                LibraryResult.ofItem(toMediaItem(BrowseTree.root()), params),
            )

        override fun onGetItem(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val node = BrowseTree.node(mediaId, tracks())
            return Futures.immediateFuture(
                if (node != null) LibraryResult.ofItem(toMediaItem(node), null)
                else LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE),
            )
        }

        override fun onGetChildren(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val children = BrowseTree.children(parentId, tracks()).map(::toMediaItem)
            return Futures.immediateFuture(LibraryResult.ofItemList(children, params))
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
            val future = SettableFuture.create<MutableList<MediaItem>>()
            scope.launch {
                try {
                    val resolved = mediaItems.mapNotNull { item ->
                        resolveItem(item).also {
                            if (it == null) android.util.Log.w(TAG, "dropping unresolvable ${item.mediaId}")
                        }
                    }.toMutableList()
                    future.set(resolved)
                } catch (e: Exception) {
                    future.setException(e)
                }
            }
            return future
        }
    }

    companion object {
        private const val TAG = "PlaybackService"
    }
}
