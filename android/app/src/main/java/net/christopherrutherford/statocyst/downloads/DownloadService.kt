package net.christopherrutherford.statocyst.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Foreground service that keeps the process alive while [DownloadQueue] has
 * work, shows "n of m, x%" with a Cancel action, and stops when the queue drains.
 * START_STICKY lets the system bring it back after a kill; the queue then
 * restores its pending tracks from storage and resumes the partial files.
 */
class DownloadService : Service() {
    private val listener: (QueueSnapshot) -> Unit = ::onSnapshot
    private var foreground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val queue = DownloadCenter.queue(this)
        enterForeground(queue.snapshot())
        if (intent?.action == ACTION_CANCEL) queue.cancelAll()
        queue.removeListener(listener)
        queue.addListener(listener)
        onSnapshot(queue.snapshot())
        return START_STICKY
    }

    override fun onDestroy() {
        DownloadCenter.queue(this).removeListener(listener)
        super.onDestroy()
    }

    /** Android 15 caps dataSync services; stop cleanly and let the next enqueue or relaunch resume. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }

    private fun enterForeground(snapshot: QueueSnapshot) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(snapshot), type)
        foreground = true
    }

    private fun onSnapshot(snapshot: QueueSnapshot) {
        val nm = getSystemService(NotificationManager::class.java)
        if (snapshot.pending > 0) {
            nm.notify(NOTIFICATION_ID, notification(snapshot))
            return
        }
        DownloadCenter.queue(this).removeListener(listener)
        if (foreground) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
            foreground = false
        }
        if (snapshot.total > 0) nm.notify(NOTIFICATION_ID, notification(snapshot)) else nm.cancel(NOTIFICATION_ID)
        stopSelf()
    }

    private fun notification(snapshot: QueueSnapshot): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val b = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
        if (snapshot.pending > 0) {
            val number = snapshot.done + snapshot.failed + 1
            val waiting = snapshot.entries.any { it.state == DownloadState.WAITING }
            val retrying = snapshot.entries.any { it.state == DownloadState.RETRYING }
            b.setContentTitle("Downloading ${minOf(number, snapshot.total)} of ${snapshot.total}")
                .setContentText(
                    when {
                        waiting -> "Waiting for network"
                        retrying -> "Retrying after a connection problem"
                        snapshot.failed > 0 -> "${snapshot.failed} failed so far"
                        else -> "Keeping your music available offline"
                    },
                )
                .setOngoing(true)
                .addAction(
                    0,
                    "Cancel",
                    PendingIntent.getService(
                        this, 1, Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                )
            val total = snapshot.totalBytes
            if (total != null && total > 0 && snapshot.sizesKnown) {
                val percent = (snapshot.receivedBytes * 100 / total).toInt().coerceIn(0, 100)
                b.setProgress(100, percent, false).setContentInfo("$percent%")
            } else {
                b.setProgress(snapshot.total, snapshot.done + snapshot.failed, snapshot.done + snapshot.failed == 0)
            }
        } else {
            b.setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(if (snapshot.failed == 0) "Downloads finished" else "Downloads finished with errors")
                .setContentText("${snapshot.done} saved" + if (snapshot.failed > 0) ", ${snapshot.failed} failed" else "")
                .setAutoCancel(true)
        }
        return b.build()
    }

    companion object {
        private const val CHANNEL_ID = "statocyst_downloads"
        private const val NOTIFICATION_ID = 4107
        private const val ACTION_CANCEL = "net.christopherrutherford.statocyst.downloads.CANCEL"

        fun start(context: Context) {
            try {
                androidx.core.content.ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
            } catch (error: Exception) {
                // Starting a foreground service from the background can be refused; the queue
                // still runs while the process lives and is restored on the next launch.
                android.util.Log.w("DownloadService", "could not start", error)
            }
        }
    }
}
