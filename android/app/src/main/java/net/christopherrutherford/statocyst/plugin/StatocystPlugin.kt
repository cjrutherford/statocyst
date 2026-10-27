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
}
