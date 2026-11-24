package net.christopherrutherford.statocyst.ui

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import net.christopherrutherford.statocyst.MainActivity
import net.christopherrutherford.statocyst.db.MediaItemEntity
import net.christopherrutherford.statocyst.db.StatocystDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.Callable
import java.util.concurrent.CompletableFuture
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.UUID

/** Exercises the packaged Angular UI and native library bridge in a real Android WebView. */
@RunWith(AndroidJUnit4::class)
class PhoneWebViewRegressionTest {
    @Test fun populatedPlaylistFitsAndSearchCardsSwipe() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val db = StatocystDatabase.getInstance(context)
        val runId = UUID.randomUUID().toString()
        val id = "zz-phone-ui-regression-$runId"
        val playlistId = "zz-phone-ui-playlist-$runId"
        val playlistKey = "statocyst.playlists"
        val file = java.io.File(context.cacheDir, "$id.mp3")
        var ownsMediaFixture = false
        var ownsPlaylistFixture = false
        var playlistSnapshot: String? = null
        var playlistKeyWasPresent = false
        var pageTimeOriginBeforeReload: Double? = null
        var activity: MainActivity? = null
        var lifecycle: Application.ActivityLifecycleCallbacks? = null
        var web: WebView? = null

        fun stage(name: String) { Log.i(TAG, "STAGE $name at ${SystemClock.uptimeMillis()}") }
        fun <T> awaitStage(name: String, block: () -> T): T {
            stage("START $name")
            try {
                val result = block()
                stage("DONE $name")
                return result
            } catch (t: Throwable) {
                Log.e(TAG, "STAGE FAILED $name: ${t.javaClass.name}: ${t.message}", t)
                throw AssertionError("Stage '$name' failed: ${t.javaClass.simpleName}: ${t.message}", t)
            }
        }

        fun <T> onUi(name: String, timeoutSeconds: Long = 10, block: () -> T): T {
            val task = FutureTask(Callable(block))
            Handler(Looper.getMainLooper()).post(task)
            try { return task.get(timeoutSeconds, TimeUnit.SECONDS) }
            catch (e: TimeoutException) { task.cancel(true); throw AssertionError("UI stage '$name' timed out after ${timeoutSeconds}s", e) }
        }

        fun js(script: String, label: String = "evaluateJavascript", timeoutSeconds: Long = 10): String {
            val currentWeb = web ?: error("WebView not captured")
            val task = CompletableFuture<String>()
            onUi("$label dispatch") {
                currentWeb.evaluateJavascript(script) { value ->
                    task.complete(value)
                }
            }
            try { return task.get(timeoutSeconds, TimeUnit.SECONDS) }
            catch (e: TimeoutException) { throw TimeoutException("$label callback timed out after ${timeoutSeconds}s") }
        }

        fun await(expression: String, timeoutMs: Long = 30_000) {
            val deadline = SystemClock.uptimeMillis() + timeoutMs
            var last: String? = null
            while (SystemClock.uptimeMillis() < deadline) {
                try {
                    last = js("Boolean($expression)", "page readiness: $expression", 2)
                    if (last == "true") return
                } catch (_: TimeoutException) { last = "callback timed out during navigation" }
                SystemClock.sleep(200)
            }
            throw AssertionError("Timed out after ${timeoutMs}ms waiting for $expression; last evaluation=$last")
        }

        try {
            awaitStage("fixture ownership and insertion") {
                check(runBlocking { db.mediaItemDao().getById(id) } == null) { "Refusing to overwrite pre-existing media id $id" }
                check(!file.exists()) { "Refusing to overwrite pre-existing fixture file $file" }
                check(file.createNewFile()) { "Could not create fixture file $file" }
                runBlocking {
                    db.mediaItemDao().upsert(MediaItemEntity(
                        id = id, sourceId = "local", path = file.absolutePath, pathKey = "zz:$id", fileName = "test.mp3",
                        ext = "mp3", sizeBytes = 0, mtimeMs = 0, title = "Fixture extraordinarily long track title without truncation",
                        artist = "Fixture extraordinarily long artist name for layout", album = "Fixture album", albumArtist = "Fixture artist",
                        trackNo = 1, discNo = null, year = null, genre = null, durationMs = 200000, bitrate = null,
                        sampleRate = null, channels = null, codec = null, format = "mp3", artworkPath = null,
                        jellyfinImageTag = null, sourceKind = "local", sourceLabel = "Test", addedAt = "", updatedAt = "",
                        missing = false, albumId = null))
                }
                ownsMediaFixture = true
            }

            awaitStage("notification permission") {
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    inst.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)

                }
            }
            awaitStage("activity launch and WebView capture") {
                val resumed = CompletableFuture<MainActivity>()
                val app = context.applicationContext as Application
                val callbacks = object : Application.ActivityLifecycleCallbacks {
                    override fun onActivityCreated(a: Activity, state: Bundle?) {}
                    override fun onActivityStarted(a: Activity) {}
                    override fun onActivityResumed(a: Activity) { if (a is MainActivity) resumed.complete(a) }
                    override fun onActivityPaused(a: Activity) {}
                    override fun onActivityStopped(a: Activity) {}
                    override fun onActivitySaveInstanceState(a: Activity, state: Bundle) {}
                    override fun onActivityDestroyed(a: Activity) {}
                }
                lifecycle = callbacks
                onUi("register lifecycle") { app.registerActivityLifecycleCallbacks(callbacks) }
                context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                try { activity = resumed.get(30, TimeUnit.SECONDS) }
                catch (e: TimeoutException) {
                    val stacks = Thread.getAllStackTraces().filterKeys { it.name == "main" || it.name.contains("Instr") }
                        .entries.joinToString("\n") { (thread, stack) -> "${thread.name} (${thread.state}):\n" + stack.joinToString("\n") { "  at $it" } }
                    Log.e(TAG, "Activity resume timed out; diagnostic stacks:\n$stacks")
                    throw AssertionError("Activity resume timed out after 30s", e)
                }
                web = onUi("capture WebView") { activity!!.bridge.webView }
            }

            awaitStage("initial page bridge readiness") { await("document.querySelector('#library-search')") }

            awaitStage("playlist snapshot and isolated fixture append") {
                val snapshotResult = js("JSON.stringify({present:localStorage.getItem('$playlistKey')!==null,value:localStorage.getItem('$playlistKey')})", "snapshot playlist storage")
                val snapshotJson = JSONObject(org.json.JSONTokener(snapshotResult).nextValue() as String)
                playlistKeyWasPresent = snapshotJson.getBoolean("present")
                if (playlistKeyWasPresent) playlistSnapshot = snapshotJson.getString("value")
                val playlistJson = JSONObject.quote(playlistSnapshot ?: "[]")
                val write = js("""(()=>{const k='$playlistKey', a=JSON.parse($playlistJson); if(!Array.isArray(a)) throw Error('playlist storage is not an array'); if(a.some(p=>p.id==='$playlistId')) throw Error('fixture playlist id already exists'); a.push({id:'$playlistId',name:'Fixture '+ 'ExtraordinarilyLongPlaylistName'.repeat(8),trackIds:['$id'],createdAt:1}); localStorage.setItem(k,JSON.stringify(a)); return localStorage.getItem(k)})()""", "append playlist fixture")
                val written = org.json.JSONTokener(write).nextValue() as String
                check(written.contains("zz-phone-ui-playlist")) { "Fixture playlist was not written" }
                ownsPlaylistFixture = true
                pageTimeOriginBeforeReload = js("performance.timeOrigin", "capture current page generation").toDouble()
                js("location.reload()", "reload with playlist fixture")
            }
            awaitStage("page ready after playlist reload") {
                val oldTimeOrigin = checkNotNull(pageTimeOriginBeforeReload)
                await("performance.timeOrigin !== $oldTimeOrigin && document.readyState === 'complete' && document.querySelector('#library-search') && !document.querySelector('.boot')")
            }
            awaitStage("library track rendered") { await("document.querySelector('.track-row')") }

            awaitStage("playlist layout assertion") {
                js("document.querySelector('[aria-label=\"Playlists\"]').click()", "open playlists")
                await("Array.from(document.querySelectorAll('sc-playlists-view .mini-title')).some(e=>e.textContent.includes('ExtraordinarilyLongPlaylistName') && e.closest('li').clientWidth > 0)")
                val metrics = js("JSON.stringify((()=>{let m=document.querySelector('main'),r=Array.from(document.querySelectorAll('sc-playlists-view .mini-title')).find(e=>e.textContent.includes('ExtraordinarilyLongPlaylistName')).closest('li'); return {mainClient:m.clientWidth,mainScroll:m.scrollWidth,rowClient:r.clientWidth,rowScroll:r.scrollWidth}})())", "read playlist layout")
                Log.i(TAG, "playlist metrics: $metrics")
                val sizes = JSONObject(org.json.JSONTokener(metrics).nextValue() as String)
                assertTrue("playlist overflow: $sizes", sizes.getInt("rowClient") > 0 && sizes.getInt("mainScroll") <= sizes.getInt("mainClient") && sizes.getInt("rowScroll") <= sizes.getInt("rowClient"))
            }
            awaitStage("return to library") { js("document.querySelector('[aria-label=\"Library\"]').click()") ; await("document.querySelector('#library-search')") }

            awaitStage("search interaction") {
                js("document.querySelector('#library-search').value='Fixture'; document.querySelector('#library-search').dispatchEvent(new Event('input',{bubbles:true})); document.querySelectorAll('.mode-tabs [role=tab]')[1].click()", "search interaction")
                await("document.querySelector('.search-results .album-card')")
            }

            fun swipe(selector: String, direction: Int, expectedTab: Int, tapTabAfter: Int? = null) {
                await("document.querySelector('$selector')")
                js("document.querySelector('$selector').scrollIntoView({block:'center', behavior:'instant'})", "scroll swipe target into view")
                await("(()=>{const e=document.querySelector('$selector'), r=e?.getBoundingClientRect(); return r && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()", 5_000)
                val raw = js("JSON.stringify((()=>{const r=document.querySelector('$selector').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,viewport:innerHeight,dpr:devicePixelRatio}})())", "read swipe bounds")
                val rect = JSONObject(org.json.JSONTokener(raw).nextValue() as String)
                val loc = IntArray(2)
                onUi("WebView screen location") { web!!.getLocationOnScreen(loc) }
                val density = context.resources.displayMetrics.density
                val x = loc[0] + rect.getDouble("x").toFloat() * density
                val y = loc[1] + rect.getDouble("y").toFloat() * density
                val distance = 80 * density * direction
                val tabRect = if (tapTabAfter != null) JSONObject(org.json.JSONTokener(js("JSON.stringify((()=>{const r=document.querySelectorAll('.mode-tabs [role=tab]')[$tapTabAfter].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())")).nextValue() as String) else null
                Log.i(TAG, "swipe selector=$selector bounds=$raw screen=($x,$y) distance=$distance")
                js("window.__phoneTouchAbort?.abort(); window.__phoneTouchAbort=new AbortController(); window.__phoneTouches=[]; for(const t of ['touchstart','touchmove','touchend','touchcancel','click']) window.addEventListener(t,e=>{const p=e.changedTouches?.[0]||e; window.__phoneTouches.push({type:e.type,time:Math.round(e.timeStamp),trusted:e.isTrusted,x:p.clientX,y:p.clientY,target:e.target?.className,action:getComputedStyle(e.target).touchAction,tab:Array.from(document.querySelectorAll('.mode-tabs [role=tab]')).findIndex(t=>t.getAttribute('aria-selected')==='true')})},{capture:true,signal:window.__phoneTouchAbort.signal})", "capture touch events")
                val down = SystemClock.uptimeMillis()
                fun motion(action: Int, px: Float, py: Float = y) {
                    val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, px, py, 0)
                    try { inst.sendPointerSync(event) } finally { event.recycle() }
                }
                motion(MotionEvent.ACTION_DOWN, x)
                SystemClock.sleep(20); motion(MotionEvent.ACTION_MOVE, x + 2 * density * direction, y + 10 * density)
                for (i in 1..8) { SystemClock.sleep(20); motion(MotionEvent.ACTION_MOVE, x + distance * i / 8, y + (10 + i) * density) }
                motion(MotionEvent.ACTION_UP, x + distance, y + 18 * density)
                if (tabRect != null) {
                    val tx = loc[0] + tabRect.getDouble("x").toFloat() * density
                    val ty = loc[1] + tabRect.getDouble("y").toFloat() * density
                    val tapDown = SystemClock.uptimeMillis()
                    for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                        val event = MotionEvent.obtain(tapDown, SystemClock.uptimeMillis(), action, tx, ty, 0)
                        try { inst.sendPointerSync(event) } finally { event.recycle() }
                    }
                }
                Log.i(TAG, "touch events: ${js("JSON.stringify(window.__phoneTouches)")}")
                Log.i(TAG, "last touch events: ${js("JSON.stringify(window.__phoneTouches.slice(-4))")}")
                if (tapTabAfter != null) {
                    assertEquals("swipe must change tabs before the separate tap", "true", js("window.__phoneTouches.filter(e=>e.type==='touchstart')[1]?.tab === $expectedTab"))
                }
                await("document.querySelectorAll('.mode-tabs [role=tab]')[${tapTabAfter ?: expectedTab}].getAttribute('aria-selected') === 'true'", 3_000)
                assertEquals("swipe opened detail", "false", js("Boolean(document.querySelector('.detail'))"))
            }
            awaitStage("album to artist swipe") { swipe(".search-results .album-card", -1, 2) }
            awaitStage("artist to album swipe") { swipe(".search-results .artist-card", 1, 1) }
            awaitStage("album to tracks swipe") { swipe(".search-results .album-card", 1, 0) }
            awaitStage("track to albums swipe and immediate tab tap") { swipe(".track-row", -1, 1, 2) }


        } finally {
            if (ownsPlaylistFixture && web != null) {
                try {
                    stage("START restore original playlist storage")
                    val keyJson = JSONObject.quote(playlistKey)
                    val originalJson = JSONObject.quote(playlistSnapshot ?: "")
                    js("if ($playlistKeyWasPresent) localStorage.setItem($keyJson,$originalJson) else localStorage.removeItem($keyJson)", "restore original playlist storage")
                    stage("DONE restore original playlist storage")
                } catch (t: Throwable) { Log.e(TAG, "Failed restoring playlist storage", t) }
            }
            try { onUi("finish activity") { activity?.finish(); lifecycle?.let { (context.applicationContext as Application).unregisterActivityLifecycleCallbacks(it) } } } catch (t: Throwable) { Log.e(TAG, "Activity cleanup failed", t) }
            if (ownsMediaFixture) runBlocking { db.mediaItemDao().deleteById(id) }
            if (ownsMediaFixture) file.delete()
        }
    }

    private companion object { const val TAG = "PhoneWebViewRegression" }
}
