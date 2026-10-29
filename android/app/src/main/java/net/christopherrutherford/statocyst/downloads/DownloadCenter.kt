package net.christopherrutherford.statocyst.downloads

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * Owns the process-wide [DownloadQueue] and wires it to the real [DownloadManager],
 * the network state and persistence. The queue lives here, not in the WebView or
 * the plugin, so downloads keep going when the screen is off or the UI is gone.
 */
object DownloadCenter {
    private const val PREFS = "statocyst_downloads"
    private const val PENDING = "pending"

    @Volatile
    private var queue: DownloadQueue? = null

    fun queue(context: Context): DownloadQueue = queue ?: synchronized(this) {
        queue ?: create(context.applicationContext).also { queue = it }
    }

    /** Queues [trackIds] and makes sure the foreground service is running to keep the process alive. */
    fun enqueue(context: Context, trackIds: Collection<String>): Int {
        val added = queue(context).enqueue(trackIds)
        if (added > 0) DownloadService.start(context)
        return added
    }

    private fun create(app: Context): DownloadQueue {
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val manager = DownloadManager(app)
        val created = DownloadQueue(
            runner = { id, events -> manager.download(id, events) },
            persist = { ids -> prefs.edit().putString(PENDING, ids.joinToString("\n")).apply() },
            networkUp = { isOnline(app) },
        )
        val saved = prefs.getString(PENDING, null)?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
        if (saved.isNotEmpty()) {
            created.enqueue(saved)
            DownloadService.start(app)
        }
        return created
    }

    internal fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
