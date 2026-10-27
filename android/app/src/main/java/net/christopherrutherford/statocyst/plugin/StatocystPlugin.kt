package net.christopherrutherford.statocyst.plugin

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.db.MediaItemDao
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.jellyfin.JellyfinClient
import net.christopherrutherford.statocyst.media.PlaybackService

@CapacitorPlugin(name = "Statocyst")
class StatocystPlugin : Plugin() {
    private val db by lazy { StatocystDatabase.getInstance(context) }
    private val dao: MediaItemDao by lazy { db.mediaItemDao() }

    @PluginMethod
    fun listTracks(call: PluginCall) {
        // Room getAll is suspend; run on IO dispatcher
        Thread {
            try {
                val tracks = runBlocking { dao.getAll() }
                val arr = tracks.map { t ->
                    val obj = com.getcapacitor.JSObject()
                    obj.put("id", t.id)
                    obj.put("title", t.title)
                    obj.put("artist", t.artist)
                    obj.put("album", t.album)
                    obj.put("durationMs", t.durationMs)
                    obj.put("sourceKind", t.sourceKind)
                    obj.put("sourceLabel", t.sourceLabel)
                    obj
                }
                val ret = com.getcapacitor.JSObject()
                ret.put("tracks", com.getcapacitor.JSArray(arr))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message, e)
            }
        }.start()
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (url.isEmpty()) { call.reject("url required"); return }
        val intent = Intent(context, PlaybackService::class.java).apply {
            action = "PLAY"
            putExtra("url", url)
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
        Thread {
            try {
                val c = runBlocking { dao.count() }
                val ret = com.getcapacitor.JSObject()
                ret.put("count", c)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message, e)
            }
        }.start()
    }

    @PluginMethod
    fun discoverServer(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (url.isEmpty()) { call.reject("url required"); return }
        Thread {
            try {
                val info = JellyfinClient.discover(url)
                val ret = com.getcapacitor.JSObject()
                ret.put("id", info.id)
                ret.put("name", info.name)
                ret.put("version", info.version)
                ret.put("url", info.baseUrl)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message, e)
            }
        }.start()
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
        Thread {
            try {
                val auth = JellyfinClient.authenticate(url, username, password)
                val ret = com.getcapacitor.JSObject()
                ret.put("serverId", auth.serverId)
                ret.put("userId", auth.userId)
                ret.put("userName", auth.userName)
                ret.put("accessToken", auth.accessToken)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message, e)
            }
        }.start()
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
        Thread {
            try {
                val (items, total) = JellyfinClient.listAudioItems(url, userId, token)
                var imported = 0
                for (item in items) {
                    val entity = MediaItemEntity(
                        id = "jf-" + item.optString("Id"),
                        sourceId = "jellyfin",
                        path = item.optString("Id"),
                        pathKey = "jellyfin:" + item.optString("Id"),
                        fileName = item.optString("Name"),
                        ext = item.optJSONArray("MediaSources")?.optJSONObject(0)?.optString("Container") ?: "audio",
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
                        bitrate = item.optJSONArray("MediaSources")?.optJSONObject(0)?.optInt("Bitrate", 0)?.takeIf { it > 0 },
                        sampleRate = null,
                        channels = null,
                        codec = item.optJSONArray("MediaSources")?.optJSONObject(0)?.optString("Codec"),
                        format = item.optJSONArray("MediaSources")?.optJSONObject(0)?.optString("Container"),
                        artworkPath = null,
                        jellyfinImageTag = item.optJSONObject("ImageTags")?.optString("Primary"),
                        sourceKind = "jellyfin",
                        sourceLabel = "Jellyfin",
                        addedAt = java.time.Instant.now().toString(),
                        updatedAt = java.time.Instant.now().toString(),
                    )
                    runBlocking { dao.upsert(entity) }
                    imported++
                }
                val ret = com.getcapacitor.JSObject()
                ret.put("imported", imported)
                ret.put("total", total)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message, e)
            }
        }.start()
    }
}
