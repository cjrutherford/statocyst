package net.christopherrutherford.statocyst.downloads

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.util.concurrent.ConcurrentHashMap

/**
 * Owns the process-wide [DownloadQueue] and wires it to the real [DownloadManager],
 * the network state and persistence. The queue lives here, not in the WebView or
 * the plugin, so downloads keep going when the screen is off or the UI is gone.
 *
 * Network policy is read live from the shared preferences the plugin writes, so a
 * "Wi-Fi only" queue waits on a metered link instead of spending the data cap.
 */
object DownloadCenter {
    private const val PREFS = "statocyst"
    private const val PENDING = "pending"
    private const val WIFI_ONLY = "download_wifi_only"
    private const val QUOTA = "download_quota_bytes"

    @Volatile
    private var queue: DownloadQueue? = null

    /** Quality chosen per track while it is queued. Persisted with the pending list. */
    private val profiles = ConcurrentHashMap<String, DownloadProfile>()

    fun queue(context: Context): DownloadQueue = queue ?: synchronized(this) {
        queue ?: create(context.applicationContext).also { queue = it }
    }

    /** Queues [trackIds] at [profile] and keeps the foreground service alive. */
    fun enqueue(
        context: Context,
        trackIds: Collection<String>,
        profile: DownloadProfile = DownloadProfile.ORIGINAL,
    ): Int {
        for (id in trackIds) profiles[id] = profile
        val added = queue(context).enqueue(trackIds)
        if (added > 0) DownloadService.start(context)
        return added
    }

    fun setPolicy(context: Context, wifiOnly: Boolean, quotaBytes: Long) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(WIFI_ONLY, wifiOnly)
            .putLong(QUOTA, quotaBytes)
            .apply()
    }

    fun wifiOnly(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(WIFI_ONLY, true)

    fun quotaBytes(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(QUOTA, 0L)

    private fun create(app: Context): DownloadQueue {
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val manager = DownloadManager(app)
        val created = DownloadQueue(
            runner = { id, events ->
                manager.download(id, profiles[id] ?: DownloadProfile.ORIGINAL, events)
            },
            persist = { ids ->
                // Persist the profile next to the id so a relaunch does not silently
                // turn a data-saver pin back into a lossless one.
                prefs.edit().putString(
                    PENDING,
                    ids.joinToString("\n") { id -> "$id|${(profiles[id] ?: DownloadProfile.ORIGINAL).wire}" },
                ).apply()
            },
            networkUp = { isOnline(app) && !blockedByWifi(app) },
            blockedReason = {
                when {
                    !isOnline(app) -> "Waiting for network"
                    blockedByWifi(app) -> "Waiting for Wi-Fi"
                    else -> null
                }
            },
        )
        val saved = prefs.getString(PENDING, null)?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
        val ids = saved.map { it.substringBefore('|') }.filter { it.isNotBlank() }
        for (line in saved) {
            val id = line.substringBefore('|')
            val profile = DownloadProfile.from(line.substringAfter('|', ""))
            if (id.isNotBlank()) profiles[id] = profile
        }
        if (ids.isNotEmpty()) {
            created.enqueue(ids)
            DownloadService.start(app)
        }
        return created
    }

    internal fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * True when the active link is not unmetered. A missing capability is treated
     * as metered: refusing to spend an unknown connection is the safer default.
     */
    internal fun isMetered(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    private fun blockedByWifi(context: Context): Boolean =
        wifiOnly(context) && isMetered(context)
}
