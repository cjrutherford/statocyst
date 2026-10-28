package net.christopherrutherford.statocyst.plugin

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.diagnostics.Diagnostics
import net.christopherrutherford.statocyst.diagnostics.SupportBundle
import net.christopherrutherford.statocyst.artwork.ExternalArt
import net.christopherrutherford.statocyst.db.DownloadEntity
import net.christopherrutherford.statocyst.db.MediaItemDao
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.FavoriteEntity
import net.christopherrutherford.statocyst.db.PlaylistEntity
import net.christopherrutherford.statocyst.db.PlaylistTrackEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.cache.MediaCache
import net.christopherrutherford.statocyst.downloads.DownloadManager
import net.christopherrutherford.statocyst.jellyfin.JellyfinClient
import net.christopherrutherford.statocyst.library.LibraryImporter
import net.christopherrutherford.statocyst.media.BrowseAccess
import net.christopherrutherford.statocyst.media.LocalMediaServer
import net.christopherrutherford.statocyst.media.PlaybackService
import net.christopherrutherford.statocyst.media.QueueItems
import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray

@CapacitorPlugin(name = "Statocyst")
class StatocystPlugin : Plugin() {
    private val db by lazy { StatocystDatabase.getInstance(context) }
    private val dao: MediaItemDao by lazy { db.mediaItemDao() }
    private val downloads by lazy { DownloadManager(context) }
    private val cache by lazy { MediaCache(context) }
    private val importer by lazy { LibraryImporter(context) }

    @Volatile
    private var importCancelled = false

    // ---------------------------------------------------------------- library

    @PluginMethod
    fun listTracks(call: PluginCall) {
        io(call) {
            val tracks = dao.getAll().map(::trackJson)
            call.resolve(JSObject().put("tracks", JSArray(tracks)))
        }
    }

    @PluginMethod
    fun removeTrack(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        io(call) {
            cache.lookup(trackId)?.delete()
            downloads.remove(trackId)
            val removed = importer.removeTrack(trackId)
            PlaybackService.onCatalogChanged()
            call.resolve(JSObject().put("removed", removed))
        }
    }

    @PluginMethod
    fun libraryStats(call: PluginCall) {
        io(call) {
            val tracks = dao.getAll()
            val duration = tracks.sumOf { it.durationMs }
            call.resolve(
                JSObject()
                    .put("tracks", tracks.size)
                    .put("albums", tracks.map { it.album }.distinct().size)
                    .put("artists", tracks.map { it.artist }.distinct().size)
                    .put("durationMs", duration)
                    .put("missing", tracks.count { it.missing }),
            )
        }
    }

    // ---------------------------------------------------------------- playback

    /**
     * Resolves what the player should load: a pinned download, the rolling cache,
     * an imported library file, or the authenticated Jellyfin stream URL.
     */
    @PluginMethod
    fun playbackUrl(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        io(call) {
            val track = dao.getById(trackId)
            val local = downloads.verifiedFile(trackId) ?: cache.lookup(trackId)
            if (local != null) {
                call.resolve(JSObject().put("url", LocalMediaServer.localUri(context, local)).put("local", true))
                return@io
            }
            val url = when {
                track == null -> null
                track.sourceKind.startsWith("jellyfin") -> remoteStreamUrl(track)
                else -> File(track.path).takeIf { it.isFile }?.let { LocalMediaServer.localUri(context, it) }
            }
            if (url == null) {
                call.resolve(JSObject().put("url", null as Any?).put("local", false))
                return@io
            }
            val isRemote = track != null && track.sourceKind.startsWith("jellyfin")
            call.resolve(JSObject().put("url", url).put("local", !isRemote))
            if (isRemote && budget > 0) {
                Thread { cache.prefetch(trackId, budget) }.start()
            }
        }
    }

    /** Song radio: the seed first, then similar songs (Jellyfin instant mix, topped up locally). */
    @PluginMethod
    fun radio(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        val limit = (call.getInt("limit") ?: 50).coerceIn(1, 200)
        io(call) {
            val result = net.christopherrutherford.statocyst.radio.RadioBuilder(context).build(trackId, limit)
            if (result == null) {
                call.reject("Track not found")
                return@io
            }
            val ids = JSArray()
            result.trackIds.forEach { ids.put(it) }
            call.resolve(JSObject().put("trackIds", ids).put("source", result.source))
        }
    }

    // ------------------------------------------------- native playback (S2)
    //
    // The ExoPlayer in PlaybackService owns audio, the queue, shuffle and repeat.
    // The WebView drives it through a MediaController and mirrors its state from
    // the playerState / playerQueue / playerPosition events below.

    private val mainHandler = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private val pendingWork = mutableListOf<(MediaController) -> Unit>()
    private var ticking = false

    override fun load() {
        super.load()
        connectController()
        PlaybackService.favoritesListener = { ids ->
            emit("favoritesChanged", JSObject().put("favorites", JSArray(ids)))
        }
    }

    override fun handleOnDestroy() {
        PlaybackService.favoritesListener = null
        mainHandler.removeCallbacksAndMessages(null)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controller = null
        super.handleOnDestroy()
    }

    private fun connectController() {
        if (controllerFuture != null) return
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        controllerFuture = future
        future.addListener({
            try {
                val c = future.get()
                controller = c
                c.addListener(playerListener)
                pendingWork.toList().also { pendingWork.clear() }.forEach { it(c) }
                emitState(c)
                emitQueue(c)
            } catch (e: Exception) {
                android.util.Log.w("StatocystPlugin", "media controller connect failed", e)
                controllerFuture = null
                pendingWork.clear()
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Runs [block] on the main thread once the controller is connected. */
    private fun withController(call: PluginCall?, block: (MediaController) -> Unit) {
        mainHandler.post {
            val c = controller
            try {
                if (c != null) {
                    block(c)
                } else {
                    pendingWork.add { block(it) }
                    connectController()
                }
            } catch (e: Exception) {
                android.util.Log.w("StatocystPlugin", "controller call failed", e)
                call?.reject(e.message ?: "playback error")
            }
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            val c = player as? MediaController ?: return
            if (events.containsAny(
                    Player.EVENT_PLAYBACK_STATE_CHANGED,
                    Player.EVENT_PLAY_WHEN_READY_CHANGED,
                    Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION,
                    Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
                    Player.EVENT_REPEAT_MODE_CHANGED,
                    Player.EVENT_PLAYER_ERROR,
                    Player.EVENT_POSITION_DISCONTINUITY,
                )
            ) {
                emitState(c)
            }
            if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION)) {
                emitQueue(c)
            }
            if (c.isPlaying) startTicker()
        }
    }

    private fun startTicker() {
        if (ticking) return
        ticking = true
        mainHandler.post(object : Runnable {
            override fun run() {
                val c = controller
                if (c == null || !c.isPlaying) {
                    ticking = false
                    return
                }
                notifyListeners(
                    "playerPosition",
                    JSObject().put("positionMs", c.currentPosition).put("durationMs", durationOf(c)),
                )
                mainHandler.postDelayed(this, 500)
            }
        })
    }

    private fun durationOf(c: MediaController): Long =
        if (c.duration == C.TIME_UNSET) 0L else c.duration

    private fun stateName(c: MediaController): String = when {
        c.playerError != null -> "error"
        c.mediaItemCount == 0 -> "idle"
        c.playbackState == Player.STATE_ENDED -> "ended"
        c.playbackState == Player.STATE_BUFFERING -> if (c.playWhenReady) "buffering" else "paused"
        c.playbackState == Player.STATE_READY -> if (c.playWhenReady) "playing" else "paused"
        else -> "paused"
    }

    private fun stateJson(c: MediaController): JSObject = JSObject()
        .put("state", stateName(c))
        .put("entryId", c.currentMediaItem?.mediaId)
        .put("trackId", c.currentMediaItem?.let { QueueItems.trackIdOf(it) })
        .put("positionMs", c.currentPosition.coerceAtLeast(0))
        .put("durationMs", durationOf(c))
        .put("shuffle", c.shuffleModeEnabled)
        .put("repeat", repeatName(c.repeatMode))
        .put("error", c.playerError?.errorCodeName)

    private fun queueJson(c: MediaController): JSObject {
        val entries = JSArray()
        for (i in 0 until c.mediaItemCount) {
            val item = c.getMediaItemAt(i)
            entries.put(JSObject().put("entryId", item.mediaId).put("trackId", QueueItems.trackIdOf(item)))
        }
        return JSObject().put("entries", entries).put("currentEntryId", c.currentMediaItem?.mediaId)
    }

    private fun emitState(c: MediaController) = notifyListeners("playerState", stateJson(c))

    private fun emitQueue(c: MediaController) = notifyListeners("playerQueue", queueJson(c))

    private fun repeatName(mode: Int): String = when (mode) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
    }

    private fun repeatMode(name: String?): Int = when (name) {
        "all" -> Player.REPEAT_MODE_ALL
        "one" -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }

    private fun slotsFrom(array: JSONArray?): List<MediaItem> {
        array ?: return emptyList()
        return (0 until array.length()).map {
            val o = array.getJSONObject(it)
            QueueItems.placeholder(o.getString("entryId"), o.getString("trackId"))
        }
    }

    /**
     * Replaces the queue. With [keepCurrent] the item that is playing now stays
     * untouched (no audio glitch) and only its neighbours are swapped, which is
     * how queue edits made in the UI are pushed down.
     */
    @PluginMethod
    fun setQueue(call: PluginCall) {
        val entries = slotsFrom(call.getArray("entries"))
        val currentEntryId = call.getString("currentEntryId")
        val startPositionMs = call.getLong("startPositionMs") ?: 0L
        val play = call.getBoolean("play") ?: false
        val keepCurrent = call.getBoolean("keepCurrent") ?: false
        call.getLong("cacheBudgetBytes")?.let {
            context.getSharedPreferences("statocyst", android.content.Context.MODE_PRIVATE)
                .edit().putLong("cache_budget_bytes", it).apply()
        }
        withController(call) { c ->
            val currentIdx = entries.indexOfFirst { it.mediaId == currentEntryId }
            val playingId = c.currentMediaItem?.mediaId
            if (keepCurrent && playingId != null && playingId == currentEntryId && currentIdx >= 0) {
                val at = c.currentMediaItemIndex
                if (at + 1 < c.mediaItemCount) c.removeMediaItems(at + 1, c.mediaItemCount)
                if (at > 0) c.removeMediaItems(0, at)
                val before = entries.subList(0, currentIdx)
                val after = entries.subList(currentIdx + 1, entries.size)
                if (after.isNotEmpty()) c.addMediaItems(1, after)
                if (before.isNotEmpty()) c.addMediaItems(0, before)
            } else if (entries.isEmpty()) {
                c.clearMediaItems()
            } else {
                c.setMediaItems(entries, currentIdx.coerceAtLeast(0), startPositionMs)
                c.prepare()
                if (play) c.play()
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        withController(call) { c ->
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            if (c.playbackState == Player.STATE_ENDED) c.seekTo(0)
            c.play()
            call.resolve()
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        withController(call) { it.pause(); call.resolve() }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        withController(call) { it.stop(); it.clearMediaItems(); call.resolve() }
    }

    @PluginMethod
    fun skipNext(call: PluginCall) {
        withController(call) { it.seekToNextMediaItem(); it.play(); call.resolve() }
    }

    @PluginMethod
    fun skipPrevious(call: PluginCall) {
        withController(call) { c ->
            // Within the first seconds, step back a track; otherwise restart this one.
            if (c.currentPosition > 3000) c.seekTo(0) else c.seekToPreviousMediaItem()
            c.play()
            call.resolve()
        }
    }

    @PluginMethod
    fun playEntry(call: PluginCall) {
        val entryId = call.getString("entryId") ?: run { call.reject("entryId required"); return }
        withController(call) { c ->
            val idx = (0 until c.mediaItemCount).firstOrNull { c.getMediaItemAt(it).mediaId == entryId }
            if (idx == null) {
                call.reject("entry not found")
            } else {
                c.seekTo(idx, 0)
                if (c.playbackState == Player.STATE_IDLE) c.prepare()
                c.play()
                call.resolve()
            }
        }
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val positionMs = call.getLong("positionMs") ?: 0L
        withController(call) { it.seekTo(positionMs.coerceAtLeast(0)); call.resolve() }
    }

    @PluginMethod
    fun setShuffle(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        withController(call) { it.shuffleModeEnabled = enabled; call.resolve() }
    }

    @PluginMethod
    fun setRepeat(call: PluginCall) {
        val mode = repeatMode(call.getString("mode"))
        withController(call) { it.repeatMode = mode; call.resolve() }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = (call.getFloat("volume") ?: 1f).coerceIn(0f, 1f)
        val muted = call.getBoolean("muted") ?: false
        withController(call) { it.volume = if (muted) 0f else volume; call.resolve() }
    }

    /** Current native player state + queue, used by the WebView on startup. */
    @PluginMethod
    fun getPlaybackState(call: PluginCall) {
        withController(call) { c ->
            call.resolve(JSObject().put("state", stateJson(c)).put("queue", queueJson(c)))
        }
    }

    @PluginMethod
    fun dbCount(call: PluginCall) {
        io(call) { call.resolve(JSObject().put("count", dao.count())) }
    }

    // ------------------------------------------------------------- downloads

    @PluginMethod
    fun downloadTrack(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        io(call) {
            try {
                val outcome = downloads.download(trackId) { received, total, done, error ->
                    emit("downloadProgress", JSObject()
                        .put("trackId", trackId)
                        .put("receivedBytes", received)
                        .put("totalBytes", total)
                        .put("done", done)
                        .put("error", error))
                }
                call.resolve(downloadSummary(outcome.entity))
                notifyCacheChanged()
            } catch (error: Exception) {
                emit("downloadProgress", JSObject()
                    .put("trackId", trackId)
                    .put("receivedBytes", 0)
                    .put("totalBytes", null as Any?)
                    .put("done", true)
                    .put("error", error.message))
                call.reject(error.message ?: "Download failed", error)
            }
        }
    }

    @PluginMethod
    fun removeDownload(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        io(call) {
            val removed = downloads.remove(trackId)
            call.resolve(JSObject().put("removed", removed))
        }
    }

    @PluginMethod
    fun listDownloads(call: PluginCall) {
        io(call) {
            val array = JSArray(downloads.list().map(::downloadJson))
            call.resolve(JSObject().put("downloads", array))
        }
    }

    @PluginMethod
    fun downloadStats(call: PluginCall) {
        io(call) {
            val (count, bytes) = downloads.stats()
            call.resolve(JSObject().put("count", count).put("totalBytes", bytes))
        }
    }

    // ----------------------------------------------------------------- cache

    @PluginMethod
    fun cacheStats(call: PluginCall) {
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        io(call) {
            val stats = cache.stats(budget)
            call.resolve(
                JSObject()
                    .put("bytes", stats.bytes)
                    .put("budgetBytes", stats.budgetBytes)
                    .put("entries", stats.entries)
                    .put("pressure", stats.pressure),
            )
        }
    }

    @PluginMethod
    fun cacheClear(call: PluginCall) {
        io(call) { call.resolve(JSObject().put("removed", cache.clear())) }
    }

    @PluginMethod
    fun cacheReconcile(call: PluginCall) {
        io(call) {
            val (removedEntries, removedOrphans) = cache.reconcile()
            call.resolve(
                JSObject().put("removedEntries", removedEntries).put("removedOrphans", removedOrphans),
            )
        }
    }

    @PluginMethod
    fun prefetchTracks(call: PluginCall) {
        val ids = call.getArray("trackIds")?.toList<String>().orEmpty()
        if (ids.isEmpty()) { call.resolve(); return }
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        // A bounded lookahead: only prefetch while there is budget headroom.
        Thread {
            for (id in ids.take(3)) {
                if (cache.budget(budget) <= 0) break
                cache.prefetch(id, budget)
            }
        }.start()
        call.resolve()
    }

    // ---------------------------------------------------------------- import

    @PluginMethod
    fun pickFiles(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "audio/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(call, intent, "filesPicked")
    }

    @ActivityCallback
    private fun filesPicked(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(emptyImport(cancelled = true))
            return
        }
        val uris = mutableListOf<Uri>()
        val data = result.data
        val clip = data?.clipData
        if (clip != null) {
            for (index in 0 until clip.itemCount) uris.add(clip.getItemAt(index).uri)
        } else if (data?.data != null) {
            uris.add(data.data!!)
        }
        runImport(call, label = LibraryImporter.SOURCE_LABEL) { progress ->
            importer.importDocuments(uris) { scanned, imported -> progress(scanned, imported) }
        }
    }

    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "folderPicked")
    }

    @ActivityCallback
    private fun folderPicked(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        if (call == null) return
        val tree = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || tree == null) {
            call.resolve(emptyImport(cancelled = true))
            return
        }
        try {
            context.contentResolver.takePersistableUriPermission(
                tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        } catch (_: SecurityException) {
            // The copy below is what matters; a persisted grant is a nicety.
        }
        runImport(call, label = LibraryImporter.SOURCE_LABEL) { progress ->
            importer.importTree(tree) { scanned, imported -> progress(scanned, imported) }
        }
    }

    @PluginMethod
    fun importPaths(call: PluginCall) {
        val paths = call.getArray("paths")?.toList<String>().orEmpty()
        if (paths.isEmpty()) { call.resolve(emptyImport(cancelled = true)); return }
        runImport(call, label = LibraryImporter.SOURCE_LABEL) { progress ->
            importer.importFiles(paths) { scanned, imported -> progress(scanned, imported) }
        }
    }

    @PluginMethod
    fun cancelImport(call: PluginCall) {
        importCancelled = true
        call.resolve()
    }

    private fun runImport(
        call: PluginCall,
        label: String,
        work: ((scanned: Int, imported: Int) -> Unit) -> LibraryImporter.Summary,
    ) {
        importCancelled = false
        io {
            try {
                val summary = work { scanned, imported ->
                    if (importCancelled) throw InterruptedException("Import cancelled")
                    emit("importProgress", JSObject().put("phase", "importing").put("scanned", scanned).put("imported", imported))
                }
                val tracks = JSArray(summary.imported.map(::trackJson))
                if (summary.imported.isNotEmpty()) PlaybackService.onCatalogChanged()
                call.resolve(
                    JSObject()
                        .put("sourceId", LibraryImporter.SOURCE_ID)
                        .put("sourceLabel", label)
                        .put("imported", summary.imported.size)
                        .put("duplicates", summary.duplicates)
                        .put("missing", summary.missing)
                        .put("rejected", JSArray(summary.rejected.map { (path, code) ->
                            JSObject().put("path", path).put("code", code).put("message", code)
                        }))
                        .put("tracks", tracks)
                        .put("cancelled", summary.cancelled),
                )
            } catch (error: Exception) {
                call.reject(error.message ?: "Import failed", error)
            }
        }
    }

    // --------------------------------------------------------------- session

    @PluginMethod
    fun saveSession(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val userId = call.getString("userId") ?: ""
        val token = call.getString("token") ?: ""
        val serverId = call.getString("serverId") ?: ""
        context.getSharedPreferences("statocyst", android.content.Context.MODE_PRIVATE)
            .edit()
            .putString("jellyfin_url", url)
            .putString("jellyfin_user_id", userId)
            .putString("jellyfin_token", token)
            .putString("jellyfin_server_id", serverId)
            .apply()
        call.resolve()
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        context.getSharedPreferences("statocyst", android.content.Context.MODE_PRIVATE)
            .edit()
            .remove("jellyfin_url")
            .remove("jellyfin_user_id")
            .remove("jellyfin_token")
            .remove("jellyfin_server_id")
            .apply()
        call.resolve()
    }

    // ------------------------------------------------------------- Jellyfin

    @PluginMethod
    fun discoverServer(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (url.isEmpty()) { call.reject("url required"); return }
        io(call) {
            val info = JellyfinClient.discover(url)
            call.resolve(
                JSObject()
                    .put("id", info.id)
                    .put("name", info.name)
                    .put("version", info.version)
                    .put("url", info.baseUrl),
            )
        }
    }

    @PluginMethod
    fun login(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val username = call.getString("username") ?: ""
        val password = call.getString("password") ?: ""
        if (url.isEmpty() || username.isEmpty() || password.isEmpty()) {
            call.reject("url, username, and password required")
            return
        }
        io(call) {
            val auth = JellyfinClient.authenticate(url, username, password)
            call.resolve(authJson(auth))
        }
    }

    @PluginMethod
    fun syncCatalog(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val userId = call.getString("userId") ?: ""
        val token = call.getString("token") ?: ""
        if (url.isEmpty() || userId.isEmpty() || token.isEmpty()) {
            call.reject("url, userId, and token required")
            return
        }
        io(call) {
            var imported = 0
            var startIndex = 0
            val pageSize = 200
            var total = 0
            do {
                val (items, totalCount) = JellyfinClient.listAudioItems(url, userId, token, startIndex, pageSize)
                total = totalCount
                for (item in items) {
                    dao.upsert(jellyfinEntity(item))
                    imported++
                }
                startIndex += items.size
            } while (startIndex < total && items.isNotEmpty())
            if (imported > 0) PlaybackService.onCatalogChanged()
            call.resolve(JSObject().put("imported", imported).put("total", total))
        }
    }

    /**
     * Native is authoritative for favorites once seeded, because the car can toggle them
     * while the WebView is not running. The web layer adopts this at startup.
     */
    @PluginMethod
    fun getBrowseAccess(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("allowed", JSArray(BrowseAccess.allowed(context).sorted()))
                .put("denied", JSArray(BrowseAccess.denied(context))),
        )
    }

    @PluginMethod
    fun setBrowseAllowed(call: PluginCall) {
        val packageName = call.getString("packageName")
        if (packageName.isNullOrBlank()) {
            call.reject("packageName is required")
            return
        }
        BrowseAccess.setAllowed(context, packageName, call.getBoolean("allowed", true) ?: true)
        getBrowseAccess(call)
    }

    @PluginMethod
    fun getUserState(call: PluginCall) {
        io(call) {
            try {
                val seeded = context.getSharedPreferences("statocyst", android.content.Context.MODE_PRIVATE)
                    .getBoolean("user_state_seeded", false)
                val favorites = db.userDao().favorites().map { it.trackId }
                call.resolve(JSObject().put("seeded", seeded).put("favorites", JSArray(favorites)))
            } catch (error: Exception) {
                call.reject(error.message ?: "getUserState failed", error)
            }
        }
    }

    /**
     * Mirrors the web layer's favorites and playlists into Room so the Android Auto
     * browse tree (which has no WebView) can list them. Replaces the whole mirror.
     */
    @PluginMethod
    fun syncUserState(call: PluginCall) {
        val favorites = call.getArray("favorites")?.toList<String>().orEmpty()
        val playlistsJson = call.getArray("playlists")
        io(call) {
            try {
                val favoriteRows = favorites.mapIndexed { i, id -> FavoriteEntity(id, i) }
                val playlistRows = mutableListOf<PlaylistEntity>()
                val trackRows = mutableListOf<PlaylistTrackEntity>()
                for (i in 0 until (playlistsJson?.length() ?: 0)) {
                    val obj = playlistsJson!!.getJSONObject(i)
                    val id = obj.optString("id")
                    if (id.isEmpty()) continue
                    playlistRows.add(PlaylistEntity(id, obj.optString("name", "Playlist"), obj.optLong("createdAt", 0L), i))
                    val ids = obj.optJSONArray("trackIds")
                    for (j in 0 until (ids?.length() ?: 0)) {
                        trackRows.add(PlaylistTrackEntity(id, j, ids!!.getString(j)))
                    }
                }
                db.userDao().replaceUserState(favoriteRows, playlistRows, trackRows)
                context.getSharedPreferences("statocyst", android.content.Context.MODE_PRIVATE)
                    .edit().putBoolean("user_state_seeded", true).apply()
                PlaybackService.onUserStateChanged()
                call.resolve(JSObject().put("favorites", favoriteRows.size).put("playlists", playlistRows.size))
            } catch (error: Exception) {
                call.reject(error.message ?: "syncUserState failed", error)
            }
        }
    }

    @PluginMethod
    fun validateSession(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val token = call.getString("token") ?: ""
        if (url.isEmpty() || token.isEmpty()) {
            call.reject("url and token required")
            return
        }
        io(call) {
            val itemId = call.getString("itemId")
                ?: dao.getAll().firstOrNull { it.id.startsWith("jf-") }?.id?.removePrefix("jf-")
            if (itemId == null) {
                call.resolve(JSObject().put("valid", null as Any?))
                return@io
            }

            // A probe that cannot reach the server must never outlive the app's
            // boot: hostname resolution in particular is not covered by the
            // connection timeout, so answer with `null` (unknown) if it stalls.
            val answered = java.util.concurrent.atomic.AtomicBoolean(false)
            val timer = java.util.Timer()
            timer.schedule(
                object : java.util.TimerTask() {
                    override fun run() {
                        if (answered.compareAndSet(false, true)) {
                            call.resolve(JSObject().put("valid", null as Any?).put("itemId", itemId))
                        }
                    }
                },
                PROBE_TIMEOUT_MS,
            )
            val valid = try {
                JellyfinClient.probeStream(url, itemId, token)
            } catch (_: Exception) {
                null
            } finally {
                timer.cancel()
            }
            if (answered.compareAndSet(false, true)) {
                call.resolve(JSObject().put("valid", valid).put("itemId", itemId))
            }
        }
    }

    @PluginMethod
    fun initiateQuickConnect(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (url.isEmpty()) { call.reject("url required"); return }
        io(call) {
            val init = JellyfinClient.initiateQuickConnect(url)
            call.resolve(JSObject().put("secret", init.secret).put("code", init.code))
        }
    }

    @PluginMethod
    fun pollQuickConnect(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val secret = call.getString("secret") ?: ""
        if (url.isEmpty() || secret.isEmpty()) { call.reject("url and secret required"); return }
        io(call) {
            call.resolve(JSObject().put("authenticated", JellyfinClient.quickConnectStatus(url, secret)))
        }
    }

    @PluginMethod
    fun loginWithQuickConnect(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val secret = call.getString("secret") ?: ""
        if (url.isEmpty() || secret.isEmpty()) { call.reject("url and secret required"); return }
        io(call) {
            val auth = JellyfinClient.authenticateWithQuickConnect(url, secret)
            call.resolve(authJson(auth))
        }
    }

    // ---------------------------------------------------------- diagnostics

    @PluginMethod
    fun appInfo(call: PluginCall) {
        io(call) {
            val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
            call.resolve(
                JSObject()
                    .put("name", "Statocyst")
                    .put("version", pkg.versionName ?: "0.1.0")
                    .put("versionCode", if (android.os.Build.VERSION.SDK_INT >= 28) pkg.longVersionCode else pkg.versionCode.toLong())
                    .put("platform", "android")
                    .put("android", android.os.Build.VERSION.RELEASE)
                    .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                    .put("dataPath", context.filesDir.absolutePath),
            )
        }
    }

    @PluginMethod
    fun diagnostics(call: PluginCall) {
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        io(call) {
            val snapshot = Diagnostics.snapshot(context, db, cache, budget, queueEntries = 0)
            call.resolve(
                JSObject()
                    .put("databasePath", snapshot.databasePath)
                    .put("logPath", snapshot.logPath)
                    .put("databaseBytes", snapshot.databaseBytes)
                    .put("cacheBytes", snapshot.cacheBytes)
                    .put("schemaVersion", snapshot.schemaVersion)
                    .put("integrity", snapshot.integrity)
                    .put("queueEntries", snapshot.queueEntries)
                    .put("trackCount", snapshot.trackCount),
            )
        }
    }

    @PluginMethod
    fun healthChecks(call: PluginCall) {
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        io(call) {
            val checks = Diagnostics.health(context, db, cache, downloads, budget)
            val array = JSArray(
                checks.map { check ->
                    JSObject()
                        .put("id", check.id)
                        .put("label", check.label)
                        .put("status", check.status)
                        .put("detail", check.detail)
                },
            )
            call.resolve(JSObject().put("checks", array))
        }
    }

    @PluginMethod
    fun exportSupportBundle(call: PluginCall) {
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        io(call) {
            try {
                val file = SupportBundle(context, db, downloads, cache).write(budget)
                shareSupportBundle(file)
                call.resolve(JSObject().put("path", file.absolutePath).put("bytes", file.length()))
            } catch (error: Exception) {
                call.reject(error.message ?: "Could not write support bundle", error)
            }
        }
    }

    /**
     * Hands the bundle to the Android share sheet so it is actually reachable
     * from the device. A failed share must not fail the export itself.
     */
    private fun shareSupportBundle(file: File) {
        try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "Statocyst support bundle")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity?.runOnUiThread {
                activity?.startActivity(Intent.createChooser(send, "Share support bundle"))
            }
        } catch (error: Exception) {
            android.util.Log.w("StatocystPlugin", "support bundle share failed", error)
        }
    }

    // --------------------------------------------------------------- helpers

    private val DEFAULT_CACHE_BUDGET = 2L * 1024 * 1024 * 1024

    /** Upper bound for the optional session probe; boot must never wait on it. */
    private val PROBE_TIMEOUT_MS = 4_000L

    private fun io(call: PluginCall? = null, block: suspend () -> Unit) {
        Thread {
            try {
                runBlocking { block() }
            } catch (error: Exception) {
                // A failing call must never crash the WebView thread, but it must
                // also not leave the JS promise pending forever.
                android.util.Log.w("StatocystPlugin", "call failed", error)
                call?.reject(error.message ?: "Native call failed")
            }
        }.start()
    }

    private fun emit(event: String, payload: JSObject) {
        activity?.runOnUiThread { notifyListeners(event, payload) }
    }

    private fun notifyCacheChanged() {
        emit("cacheChanged", JSObject())
    }

    private fun remoteStreamUrl(track: MediaItemEntity): String? {
        val prefs = context.getSharedPreferences("statocyst", android.content.Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("jellyfin_url", null) ?: return null
        if (prefs.getString("jellyfin_token", null).isNullOrEmpty()) return null
        val itemId = track.path.ifEmpty { track.id.removePrefix("jf-") }
        return net.christopherrutherford.statocyst.jellyfin.JellyfinAuth.streamUrl(serverUrl, itemId)
    }

    private fun trackJson(t: MediaItemEntity): JSObject = JSObject()
        .put("id", t.id)
        .put("title", t.title)
        .put("artist", t.artist)
        .put("album", t.album)
        .put("albumArtist", t.albumArtist)
        .put("durationMs", t.durationMs)
        .put("sourceKind", t.sourceKind)
        .put("sourceLabel", t.sourceLabel)
        .put("sourceId", t.sourceId)
        .put("trackNo", t.trackNo)
        .put("year", t.year)
        .put("genre", t.genre)
        .put("format", t.format)
        .put("jellyfinImageTag", t.jellyfinImageTag)
        .put("albumId", t.albumId)
        .put("artworkUrl", artworkFor(t))
        .put("artistArtworkUrl", artistArtworkFor(t))
        .put("missing", t.missing)

    /** Loopback artwork URL for a Jellyfin track (the server adds the session header); null for other sources. */
    private fun artworkFor(t: MediaItemEntity): String? {
        if (!t.sourceKind.startsWith("jellyfin")) {
            return LocalMediaServer.extArtUri(context, t.albumArtist ?: t.artist, t.album)
        }
        val itemId = t.albumId?.takeIf { it.isNotEmpty() } ?: t.id.removePrefix("jf-")
        val tag = if (t.albumId.isNullOrEmpty()) "" else t.jellyfinImageTag.orEmpty()
        return LocalMediaServer.artUri(context, itemId, tag)
    }

    /** Opt-in MusicBrainz artist photo for tracks with no Jellyfin artwork of their own; null otherwise. */
    private fun artistArtworkFor(t: MediaItemEntity): String? =
        if (t.sourceKind.startsWith("jellyfin")) null
        else LocalMediaServer.extArtUri(context, t.albumArtist ?: t.artist, null)

    @PluginMethod
    fun getExternalArtwork(call: PluginCall) {
        call.resolve(JSObject().put("enabled", ExternalArt.enabled(context)))
    }

    /** Turns opt-in MusicBrainz artwork on or off and refreshes the Android Auto browse tree. */
    @PluginMethod
    fun setExternalArtwork(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        ExternalArt.setEnabled(context, enabled)
        PlaybackService.onCatalogChanged()
        call.resolve(JSObject().put("enabled", enabled))
    }

    private fun downloadJson(d: DownloadEntity): JSObject = JSObject()
        .put("trackId", d.trackId)
        .put("localPath", d.localPath)
        .put("sizeBytes", d.sizeBytes)
        .put("sha256", d.sha256)
        .put("container", d.container)
        .put("verified", d.verified)
        .put("createdAt", d.createdAt)

    private fun downloadSummary(d: DownloadEntity): JSObject = JSObject()
        .put("trackId", d.trackId)
        .put("sizeBytes", d.sizeBytes)
        .put("sha256", d.sha256)
        .put("verified", d.verified)

    private fun authJson(auth: net.christopherrutherford.statocyst.jellyfin.JellyfinAuthResult): JSObject = JSObject()
        .put("serverId", auth.serverId)
        .put("userId", auth.userId)
        .put("userName", auth.userName)
        .put("accessToken", auth.accessToken)

    private fun emptyImport(cancelled: Boolean): JSObject = JSObject()
        .put("sourceId", null as Any?)
        .put("sourceLabel", null as Any?)
        .put("imported", 0)
        .put("duplicates", 0)
        .put("missing", 0)
        .put("rejected", JSArray())
        .put("tracks", JSArray())
        .put("cancelled", cancelled)

    private fun jellyfinEntity(item: org.json.JSONObject): MediaItemEntity {
        val source = item.optJSONArray("MediaSources")?.optJSONObject(0)
        val now = java.time.Instant.now().toString()
        return MediaItemEntity(
            id = "jf-" + item.optString("Id"),
            sourceId = "jellyfin",
            path = item.optString("Id"),
            pathKey = "jellyfin:" + item.optString("Id"),
            fileName = item.optString("Name"),
            ext = source?.optString("Container") ?: "audio",
            sizeBytes = 0,
            mtimeMs = 0,
            title = item.optString("Name"),
            artist = item.optJSONArray("Artists")?.optString(0) ?: item.optString("AlbumArtist", "Unknown artist"),
            album = item.optString("Album", "Unknown album"),
            albumArtist = item.optString("AlbumArtist", "Unknown artist"),
            trackNo = if (item.has("IndexNumber")) item.getInt("IndexNumber") else null,
            discNo = if (item.has("ParentIndexNumber")) item.getInt("ParentIndexNumber") else null,
            year = if (item.has("ProductionYear")) item.getInt("ProductionYear") else null,
            genre = item.optJSONArray("Genres")?.let { g ->
                (0 until g.length()).map { g.getString(it) }.joinToString(", ")
            },
            durationMs = (item.optLong("RunTimeTicks", 0) / 10000).toLong(),
            bitrate = source?.optInt("Bitrate", 0)?.takeIf { it > 0 },
            sampleRate = null,
            channels = null,
            codec = source?.optString("Codec"),
            format = source?.optString("Container"),
            artworkPath = null,
            jellyfinImageTag = item.optString("AlbumPrimaryImageTag").takeIf { it.isNotEmpty() }
                ?: item.optJSONObject("ImageTags")?.optString("Primary")?.takeIf { it.isNotEmpty() },
            albumId = item.optString("AlbumId").takeIf { it.isNotEmpty() },
            sourceKind = "jellyfin",
            sourceLabel = "Jellyfin",
            addedAt = now,
            updatedAt = now,
        )
    }
}
