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
import net.christopherrutherford.statocyst.db.DownloadEntity
import net.christopherrutherford.statocyst.db.MediaItemDao
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.cache.MediaCache
import net.christopherrutherford.statocyst.downloads.DownloadManager
import net.christopherrutherford.statocyst.jellyfin.JellyfinClient
import net.christopherrutherford.statocyst.library.LibraryImporter
import net.christopherrutherford.statocyst.media.LocalMediaServer
import net.christopherrutherford.statocyst.media.PlaybackService

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
        io {
            val tracks = dao.getAll().map(::trackJson)
            call.resolve(JSObject().put("tracks", JSArray(tracks)))
        }
    }

    @PluginMethod
    fun removeTrack(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        io {
            cache.lookup(trackId)?.delete()
            downloads.remove(trackId)
            val removed = importer.removeTrack(trackId)
            call.resolve(JSObject().put("removed", removed))
        }
    }

    @PluginMethod
    fun libraryStats(call: PluginCall) {
        io {
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
        io {
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

    @PluginMethod
    fun play(call: PluginCall) {
        val url = call.getString("url")
        val trackId = call.getString("trackId")
        val intent = Intent(context, PlaybackService::class.java)
        if (!url.isNullOrEmpty()) {
            intent.action = "PLAY"
            intent.putExtra("url", url)
        } else if (!trackId.isNullOrEmpty()) {
            intent.action = "PLAY_TRACK"
            intent.putExtra("trackId", trackId)
        } else {
            call.reject("url or trackId required")
            return
        }
        context.startForegroundService(intent)
        call.resolve()
    }

    @PluginMethod
    fun enqueue(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        val intent = Intent(context, PlaybackService::class.java).apply {
            action = "ENQUEUE"
            putExtra("trackId", trackId)
        }
        context.startForegroundService(intent)
        call.resolve()
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        val intent = Intent(context, PlaybackService::class.java).apply { action = "PAUSE" }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val intent = Intent(context, PlaybackService::class.java).apply { action = "STOP" }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun dbCount(call: PluginCall) {
        io { call.resolve(JSObject().put("count", dao.count())) }
    }

    // ------------------------------------------------------------- downloads

    @PluginMethod
    fun downloadTrack(call: PluginCall) {
        val trackId = call.getString("trackId") ?: ""
        if (trackId.isEmpty()) { call.reject("trackId required"); return }
        io {
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
        io {
            val removed = downloads.remove(trackId)
            call.resolve(JSObject().put("removed", removed))
        }
    }

    @PluginMethod
    fun listDownloads(call: PluginCall) {
        io {
            val array = JSArray(downloads.list().map(::downloadJson))
            call.resolve(JSObject().put("downloads", array))
        }
    }

    @PluginMethod
    fun downloadStats(call: PluginCall) {
        io {
            val (count, bytes) = downloads.stats()
            call.resolve(JSObject().put("count", count).put("totalBytes", bytes))
        }
    }

    // ----------------------------------------------------------------- cache

    @PluginMethod
    fun cacheStats(call: PluginCall) {
        val budget = call.getLong("budgetBytes") ?: DEFAULT_CACHE_BUDGET
        io {
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
        io { call.resolve(JSObject().put("removed", cache.clear())) }
    }

    @PluginMethod
    fun cacheReconcile(call: PluginCall) {
        io {
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
        io {
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
        io {
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
        io {
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
            call.resolve(JSObject().put("imported", imported).put("total", total))
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
        io {
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
        io {
            val init = JellyfinClient.initiateQuickConnect(url)
            call.resolve(JSObject().put("secret", init.secret).put("code", init.code))
        }
    }

    @PluginMethod
    fun pollQuickConnect(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val secret = call.getString("secret") ?: ""
        if (url.isEmpty() || secret.isEmpty()) { call.reject("url and secret required"); return }
        io {
            call.resolve(JSObject().put("authenticated", JellyfinClient.quickConnectStatus(url, secret)))
        }
    }

    @PluginMethod
    fun loginWithQuickConnect(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val secret = call.getString("secret") ?: ""
        if (url.isEmpty() || secret.isEmpty()) { call.reject("url and secret required"); return }
        io {
            val auth = JellyfinClient.authenticateWithQuickConnect(url, secret)
            call.resolve(authJson(auth))
        }
    }

    // ---------------------------------------------------------- diagnostics

    @PluginMethod
    fun appInfo(call: PluginCall) {
        io {
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
        io {
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
        io {
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
        io {
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

    private fun io(block: suspend () -> Unit) {
        Thread {
            try {
                runBlocking { block() }
            } catch (error: Exception) {
                // A failing call must never crash the WebView thread.
                android.util.Log.w("StatocystPlugin", "call failed", error)
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
        val token = prefs.getString("jellyfin_token", null) ?: return null
        val itemId = track.path.ifEmpty { track.id.removePrefix("jf-") }
        return "${serverUrl.trimEnd('/')}/Audio/$itemId/stream?static=true&api_key=${Uri.encode(token)}"
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
        .put("format", t.format)
        .put("jellyfinImageTag", t.jellyfinImageTag)
        .put("albumId", t.albumId)
        .put("missing", t.missing)

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
