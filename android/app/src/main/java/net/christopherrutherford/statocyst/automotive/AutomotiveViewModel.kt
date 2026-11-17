package net.christopherrutherford.statocyst.automotive

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.library.Duplicates
import net.christopherrutherford.statocyst.media.BrowseIds
import net.christopherrutherford.statocyst.media.CarRecommendations
import net.christopherrutherford.statocyst.media.LocalMediaServer
import net.christopherrutherford.statocyst.media.PlaybackService
import net.christopherrutherford.statocyst.media.QueueItems
import java.io.File

data class AutomotiveTrack(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val artUri: String?,
)

data class AutomotiveMix(
    val id: String,
    val title: String,
    val subtitle: String,
    val tracks: List<AutomotiveTrack>,
)

data class AutomotiveRecent(
    val track: AutomotiveTrack,
    val playedAt: Long,
)

enum class AutomotiveTab { FOR_YOU, LIBRARY, FAVORITES, RADIO }

data class AutomotiveUiState(
    val loading: Boolean = true,
    val tab: AutomotiveTab = AutomotiveTab.FOR_YOU,
    val mixes: List<AutomotiveMix> = emptyList(),
    val recent: List<AutomotiveRecent> = emptyList(),
    val favorites: List<AutomotiveTrack> = emptyList(),
    val tracks: List<AutomotiveTrack> = emptyList(),
    val radioSeeds: List<AutomotiveTrack> = emptyList(),
    val nowPlaying: AutomotiveTrack? = null,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val upNext: List<AutomotiveTrack> = emptyList(),
    val currentIsFavorite: Boolean = false,
    val error: String? = null,
)

private data class LoadedLibrary(
    val mixes: List<AutomotiveMix>,
    val recent: List<AutomotiveRecent>,
    val favorites: List<AutomotiveTrack>,
    val tracks: List<AutomotiveTrack>,
    val radioSeeds: List<AutomotiveTrack>,
    val favoriteIds: Set<String>,
)

class AutomotiveViewModel(application: Application) : AndroidViewModel(application) {
    private val app: Application = application
    private val database by lazy { StatocystDatabase.getInstance(application) }
    private val mediaDao by lazy { database.mediaItemDao() }
    private val userDao by lazy { database.userDao() }
    private val prefs by lazy {
        application.getSharedPreferences("statocyst", Context.MODE_PRIVATE)
    }

    private val _state = MutableStateFlow(AutomotiveUiState())
    val state = _state.asStateFlow()

    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var favoriteIds: Set<String> = emptySet()

    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = refreshPlayback()
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = refreshPlayback()
        override fun onIsPlayingChanged(isPlaying: Boolean) = refreshPlayback()
    }

    init {
        loadLibrary()
        connectController()
        viewModelScope.launch {
            while (isActive) {
                refreshPlayback()
                delay(1_000)
            }
        }
    }

    fun selectTab(tab: AutomotiveTab) {
        _state.update { it.copy(tab = tab) }
    }

    fun loadLibrary() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            try {
                val loaded = withContext(Dispatchers.IO) { readLibrary() }
                favoriteIds = loaded.favoriteIds
                _state.update {
                    it.copy(
                        loading = false,
                        mixes = loaded.mixes,
                        recent = loaded.recent,
                        favorites = loaded.favorites,
                        tracks = loaded.tracks,
                        radioSeeds = loaded.radioSeeds,
                        currentIsFavorite = currentTrackId()?.let { id -> id in favoriteIds } ?: false,
                        error = null,
                    )
                }
                refreshPlayback()
            } catch (error: Exception) {
                _state.update { it.copy(loading = false, error = error.message) }
            }
        }
    }

    fun playMix(mix: AutomotiveMix) {
        mix.tracks.firstOrNull()?.let { playSingle(it, BrowseIds.carMix(mix.id)) }
    }

    fun playRecent(recent: AutomotiveRecent) {
        playSingle(recent.track, BrowseIds.RECENTS)
    }

    fun playFavorite(track: AutomotiveTrack) {
        playSingle(track, BrowseIds.FAVORITES)
    }

    fun playLibraryTrack(track: AutomotiveTrack) {
        playSingle(track, BrowseIds.TRACKS)
    }

    fun playRadio(seed: AutomotiveTrack) {
        val mediaController = controller ?: return
        val item = MediaItem.Builder()
            .setMediaId(BrowseIds.radio(seed.id))
            .setMediaMetadata(metadata(seed))
            .build()
        mediaController.setMediaItem(item)
        mediaController.prepare()
        mediaController.play()
    }

    fun togglePlay() {
        val mediaController = controller ?: return
        if (mediaController.isPlaying) {
            mediaController.pause()
            return
        }
        if (mediaController.playbackState == Player.STATE_ENDED) mediaController.seekTo(0)
        mediaController.play()
    }

    fun next() {
        controller?.seekToNextMediaItem()
    }

    fun previous() {
        controller?.seekToPreviousMediaItem()
    }

    fun toggleFavorite() {
        val mediaController = controller ?: return
        mediaController.sendCustomCommand(
            SessionCommand(PlaybackService.CMD_FAVORITE, Bundle.EMPTY),
            Bundle.EMPTY,
        )
        viewModelScope.launch {
            delay(300)
            loadLibrary()
        }
    }

    private fun playSingle(track: AutomotiveTrack, contextId: String) {
        val mediaController = controller ?: return
        val item = MediaItem.Builder()
            .setMediaId(BrowseIds.track(track.id, contextId))
            .setMediaMetadata(metadata(track))
            .build()
        mediaController.setMediaItem(item)
        mediaController.prepare()
        mediaController.play()
    }

    private fun metadata(track: AutomotiveTrack): MediaMetadata =
        MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .apply { track.artUri?.let { setArtworkUri(Uri.parse(it)) } }
            .build()

    private fun connectController() {
        val token = SessionToken(
            app,
            ComponentName(app, PlaybackService::class.java),
        )
        val future = MediaController.Builder(app, token).buildAsync()
        controllerFuture = future
        future.addListener(
            {
                runCatching {
                    future.get().also { mediaController ->
                        controller = mediaController
                        mediaController.addListener(playerListener)
                        refreshPlayback()
                    }
                }.onFailure { error ->
                    _state.update { it.copy(error = error.message) }
                }
            },
            ContextCompat.getMainExecutor(app),
        )
    }

    private suspend fun readLibrary(): LoadedLibrary {
        val all = mediaDao.getAll().filter { it.mediaKind == "music" }
        val hidden = Duplicates.hiddenToKeeper(all)
        val visible = all.filter { it.id !in hidden }
        val byId = visible.associateBy { it.id }

        val snapshot = CarRecommendations.parse(
            prefs.getString(CarRecommendations.PREF_KEY, null),
        )
        val mixes = snapshot.mapNotNull { mix ->
            val tracks = mix.trackIds.mapNotNull { byId[it] }.map { it.toAutomotiveTrack() }
            if (tracks.isEmpty()) null else AutomotiveMix(mix.id, mix.title, mix.subtitle, tracks)
        }

        val recentById = mutableMapOf<String, Long>()
        for (row in userDao.recents(30)) {
            val keeper = hidden[row.trackId] ?: row.trackId
            recentById[keeper] = maxOf(recentById[keeper] ?: 0L, row.playedAt)
        }
        val recent = recentById.entries
            .sortedByDescending { it.value }
            .mapNotNull { (id, playedAt) ->
                byId[id]?.let { AutomotiveRecent(it.toAutomotiveTrack(), playedAt) }
            }

        val favoriteRows = userDao.favorites().sortedByDescending { it.position }
        val favoriteIds = favoriteRows
            .map { hidden[it.trackId] ?: it.trackId }
            .distinct()
            .toSet()
        val favorites = favoriteIds.mapNotNull { byId[it] }.map { it.toAutomotiveTrack() }

        val tracks = visible
            .sortedBy { it.title.lowercase() }
            .map { it.toAutomotiveTrack() }

        val radioSeeds = (recent.map { it.track.id } + favorites.map { it.id })
            .distinct()
            .take(12)
            .mapNotNull { byId[it] }
            .map { it.toAutomotiveTrack() }

        return LoadedLibrary(
            mixes = mixes,
            recent = recent,
            favorites = favorites,
            tracks = tracks,
            radioSeeds = radioSeeds,
            favoriteIds = favoriteIds,
        )
    }

    private fun MediaItemEntity.toAutomotiveTrack(): AutomotiveTrack =
        AutomotiveTrack(
            id = id,
            title = title,
            artist = artist,
            album = album,
            artUri = artworkUri(this),
        )

    private fun artworkUri(track: MediaItemEntity): String? {
        if (track.mediaKind == "music" && track.sourceKind.startsWith("jellyfin")) {
            val itemId = track.albumId?.takeIf { it.isNotEmpty() }
                ?: track.id.removePrefix("jf-")
            val tag = if (track.albumId.isNullOrEmpty()) "" else track.jellyfinImageTag.orEmpty()
            return LocalMediaServer.artUri(app, itemId, tag)
        }
        return track.artworkPath
            ?.takeIf { it.isNotEmpty() }
            ?.let { LocalMediaServer.localUri(app, File(it)) }
    }

    private fun currentTrackId(): String? =
        controller?.currentMediaItem?.let { QueueItems.trackIdOf(it) }

    private fun refreshPlayback() {
        val mediaController = controller ?: return
        val current = mediaController.currentMediaItem
        val nowPlaying = current?.let {
            AutomotiveTrack(
                id = QueueItems.trackIdOf(it),
                title = it.mediaMetadata.title?.toString() ?: "Nothing playing",
                artist = it.mediaMetadata.artist?.toString().orEmpty(),
                album = it.mediaMetadata.albumTitle?.toString().orEmpty(),
                artUri = it.mediaMetadata.artworkUri?.toString(),
            )
        }
        val index = mediaController.currentMediaItemIndex
        val upNext = if (index >= 0) {
            ((index + 1) until minOf(mediaController.mediaItemCount, index + 4)).map { at ->
                val item = mediaController.getMediaItemAt(at)
                AutomotiveTrack(
                    id = QueueItems.trackIdOf(item),
                    title = item.mediaMetadata.title?.toString() ?: "Track",
                    artist = item.mediaMetadata.artist?.toString().orEmpty(),
                    album = item.mediaMetadata.albumTitle?.toString().orEmpty(),
                    artUri = item.mediaMetadata.artworkUri?.toString(),
                )
            }
        } else {
            emptyList()
        }
        val duration = if (mediaController.duration == C.TIME_UNSET) 0L else mediaController.duration
        _state.update {
            it.copy(
                nowPlaying = nowPlaying,
                isPlaying = mediaController.isPlaying,
                positionMs = mediaController.currentPosition.coerceAtLeast(0),
                durationMs = duration,
                upNext = upNext,
                currentIsFavorite = nowPlaying?.id?.let { id -> id in favoriteIds } ?: false,
            )
        }
    }

    override fun onCleared() {
        controller?.removeListener(playerListener)
        val future = controllerFuture
        if (future != null) {
            MediaController.releaseFuture(future)
        } else {
            controller?.release()
        }
        controller = null
        controllerFuture = null
        super.onCleared()
    }
}
