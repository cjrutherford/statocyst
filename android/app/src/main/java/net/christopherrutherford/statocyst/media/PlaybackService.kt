package net.christopherrutherford.statocyst.media

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import net.christopherrutherford.statocyst.R
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase

/**
 * Android Auto / MediaBrowser entry point. Serves a deterministic browse tree
 * straight from the local Room catalog with no WebView involvement.
 * Headless source resolution (S020) and queue persistence (S021).
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
                }
                override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
                    persistQueue()
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
                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    // Surface to Android Auto via the session; Media3 propagates
                    // playback errors to controllers automatically. Keep the
                    // service alive so a controller can recover/retry.
                    lastError = error
                }
            })
        }
    }

    private lateinit var librarySession: MediaLibraryService.MediaLibrarySession

    @Volatile
    private var cachedTracks: List<MediaItemEntity>? = null

    @Volatile
    private var lastError: androidx.media3.common.PlaybackException? = null

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
        }
        restoreQueue()
    }

    override fun onGetSession(
        controllerInfo: MediaSession.ControllerInfo,
    ): MediaLibraryService.MediaLibrarySession = librarySession

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "PLAY" -> {
                val url = intent.getStringExtra("url")
                val trackId = intent.getStringExtra("trackId")
                if (url != null) {
                    val mediaItem = MediaItem.fromUri(url)
                    player.setMediaItem(mediaItem)
                    player.prepare()
                    player.play()
                    persistQueue()
                } else if (trackId != null) {
                    scope.launch {
                        try {
                            val res = resolver.resolve(trackId)
                            if (res != null) {
                                val entity = dao.getById(trackId)
                                val meta = MediaMetadata.Builder()
                                    .setTitle(entity?.title)
                                    .setArtist(entity?.artist)
                                entity?.albumId?.let { meta.setAlbumTitle(entity.album) }
                                resolver.artworkUrl(entity?.albumId, entity?.jellyfinImageTag)?.let { meta.setArtworkUri(Uri.parse(it)) }
                                val mediaItem = MediaItem.Builder()
                                    .setMediaId(trackId)
                                    .setUri(Uri.parse(res.uri))
                                    .setMediaMetadata(meta.build())
                                    .build()
                                player.setMediaItem(mediaItem)
                                player.prepare()
                                player.play()
                                persistQueue()
                            }
                        } catch (e: Exception) {
                            android.util.Log.w("PlaybackService", "PLAY failed for $trackId", e)
                        }
                    }
                }
            }
            "PLAY_TRACK" -> {
                val trackId = intent.getStringExtra("trackId") ?: return START_STICKY
                scope.launch {
                    try {
                        val entity = dao.getById(trackId) ?: return@launch
                        val res = resolver.resolve(trackId) ?: return@launch
                        val meta = MediaMetadata.Builder()
                            .setTitle(entity.title)
                            .setArtist(entity.artist)
                            .setAlbumTitle(entity.album)
                        resolver.artworkUrl(entity.albumId, entity.jellyfinImageTag)?.let { meta.setArtworkUri(Uri.parse(it)) }
                        val mediaItem = MediaItem.Builder()
                            .setMediaId(trackId)
                            .setUri(Uri.parse(res.uri))
                            .setMediaMetadata(meta.build())
                            .build()
                        player.setMediaItem(mediaItem)
                        player.prepare()
                        player.play()
                        persistQueue()
                    } catch (e: Exception) {
                    }
                }
            }
            "ENQUEUE" -> {
                val trackId = intent.getStringExtra("trackId") ?: return START_STICKY
                scope.launch {
                    try {
                        val entity = dao.getById(trackId) ?: return@launch
                        val res = resolver.resolve(trackId) ?: return@launch
                        val mediaItem = MediaItem.Builder()
                            .setMediaId(trackId)
                            .setUri(Uri.parse(res.uri))
                            .setMediaMetadata(
                                MediaMetadata.Builder()
                                    .setTitle(entity.title)
                                    .setArtist(entity.artist)
                                    .build(),
                            )
                            .build()
                        player.addMediaItem(mediaItem)
                        if (player.playbackState == Player.STATE_IDLE) {
                            player.prepare()
                        }
                        persistQueue()
                    } catch (e: Exception) {
                    }
                }
            }
            "PAUSE" -> player.pause()
            "STOP" -> {
                persistQueue()
                player.stop()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            persistQueue()
        } catch (e: Exception) {
        }
        librarySession.release()
        player.release()
        super.onDestroy()
    }

    private fun tracks(): List<MediaItemEntity> {
        cachedTracks?.let { return it }
        return synchronized(this) {
            cachedTracks ?: runBlocking { dao.getAll() }.also { cachedTracks = it }
        }
    }

    private fun restoreQueue() {
        scope.launch {
            try {
                val (ids, idx) = queueStore.loadQueue()
                if (ids.isEmpty()) return@launch
                val list = ids.mapNotNull { id -> dao.getById(id) }
                if (list.isEmpty()) return@launch
                val items = list.mapNotNull { entity ->
                    resolver.resolve(entity.id)?.let { res ->
                        MediaItem.Builder()
                            .setMediaId(entity.id)
                            .setUri(Uri.parse(res.uri))
                            .setMediaMetadata(
                                MediaMetadata.Builder()
                                    .setTitle(entity.title)
                                    .setArtist(entity.artist)
                                    .build(),
                            )
                            .build()
                    }
                }
                if (items.isNotEmpty()) {
                    player.setMediaItems(items, if (idx >= 0 && idx < items.size) idx else 0, 0L)
                    player.prepare()
                }
            } catch (e: Exception) {
            }
        }
    }

    private fun persistQueue() {
        try {
            val items = mutableListOf<String>()
            for (i in 0 until player.mediaItemCount) {
                items.add(player.getMediaItemAt(i).mediaId)
            }
            queueStore.saveQueue(items, player.currentMediaItemIndex)
        } catch (e: Exception) {
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

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> {
            val resolved = mutableListOf<MediaItem>()
            for (item in mediaItems) {
                val trackId = BrowseIds.trackEntityId(item.mediaId) ?: item.mediaId
                val res = runBlocking { resolver.resolve(trackId) }
                if (res != null) {
                    resolved.add(
                        item.buildUpon()
                            .setUri(Uri.parse(res.uri))
                            .build(),
                    )
                } else {
                    resolved.add(item)
                }
            }
            return Futures.immediateFuture(resolved)
        }
    }
}
