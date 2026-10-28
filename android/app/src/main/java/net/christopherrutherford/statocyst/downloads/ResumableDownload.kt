package net.christopherrutherford.statocyst.downloads

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection

/** Thrown when the user cancelled a download; never retried and never reported as a failure. */
class DownloadCancelled : RuntimeException("Download cancelled")

/** Callbacks from a running download. Defaults make every hook optional. */
interface DownloadEvents {
    fun cancelled(): Boolean = false
    fun online(): Boolean = true
    fun waiting() {}
    fun retrying(attempt: Int, reason: String) {}
    fun progress(received: Long, total: Long?) {}
}

/**
 * Fetches one HTTP resource into [target], surviving transient failures.
 *
 * - A dropped connection, timeout, 5xx or 429 is retried with backoff, and the
 *   next attempt resumes from the bytes already on disk (`Range`).
 * - Attempts only count against the limit when no progress was made, so a large
 *   file can ride out many short network drops.
 * - While there is no network the download waits instead of burning attempts.
 * - 401/403 and other client errors are fatal and never retried.
 */
object ResumableDownload {
    val BACKOFF_MS = longArrayOf(2_000, 5_000, 15_000, 30_000)
    private const val PROGRESS_INTERVAL_MS = 200L

    fun fetch(
        open: (rangeStart: Long) -> HttpURLConnection,
        target: File,
        events: DownloadEvents,
        maxAttempts: Int = 5,
        pause: (Long) -> Unit = ::sleepInSlices,
        clock: () -> Long = System::currentTimeMillis,
    ) {
        var attempt = 0
        while (true) {
            checkCancelled(events)
            while (!events.online()) {
                events.waiting()
                pause(2_000)
                checkCancelled(events)
            }
            val before = target.length()
            try {
                attemptOnce(open, target, events, clock)
                return
            } catch (error: IOException) {
                if (target.length() > before) attempt = 0
                attempt += 1
                if (attempt >= maxAttempts) throw error
                events.retrying(attempt, error.message ?: error.javaClass.simpleName)
                pause(BACKOFF_MS[minOf(attempt - 1, BACKOFF_MS.size - 1)])
            }
        }
    }

    private fun attemptOnce(
        open: (Long) -> HttpURLConnection,
        target: File,
        events: DownloadEvents,
        clock: () -> Long,
    ) {
        val start = target.length()
        val connection = open(start)
        try {
            val code = try {
                connection.responseCode
            } catch (error: IOException) {
                // HttpURLConnection reports a bare 401 (no WWW-Authenticate) as an IOException.
                if (error.message?.contains("authentication challenge", ignoreCase = true) == true) {
                    throw SecurityException("The stored session was rejected")
                }
                throw error
            }
            if (code == 401 || code == 403) throw SecurityException("The stored session was rejected")
            if (code == 416 && start > 0) {
                // Either the part is already the whole file, or it is stale: start over.
                val total = totalFromContentRange(connection.getHeaderField("Content-Range"))
                if (total == start) return
                target.delete()
                throw IOException("Restarting a stale partial download")
            }
            if (code == 429 || code in 500..599) throw IOException("The server returned HTTP $code")
            if (code !in 200..299) throw IllegalStateException("The server returned HTTP $code")

            val resuming = start > 0 && code == 206
            if (start > 0 && !resuming) target.delete()
            val offset = if (resuming) start else 0L
            val length = connection.contentLengthLong.takeIf { it >= 0 }
            val total = if (resuming) {
                totalFromContentRange(connection.getHeaderField("Content-Range")) ?: length?.plus(offset)
            } else {
                length
            }

            var received = offset
            var lastReport = 0L
            connection.inputStream.use { input ->
                FileOutputStream(target, resuming).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        checkCancelled(events)
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        received += read
                        val now = clock()
                        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
                            lastReport = now
                            events.progress(received, total)
                        }
                    }
                    output.flush()
                }
            }
            if (total != null && target.length() < total) {
                throw IOException("The connection closed after ${target.length()} of $total bytes")
            }
            events.progress(target.length(), total ?: target.length())
        } finally {
            connection.disconnect()
        }
    }

    private fun checkCancelled(events: DownloadEvents) {
        if (events.cancelled()) throw DownloadCancelled()
    }

    // "bytes 100-999/1000" and the 416 form "bytes star/1000" both give 1000; an unknown total gives null.
    internal fun totalFromContentRange(header: String?): Long? =
        header?.substringAfterLast('/')?.trim()?.toLongOrNull()

    private fun sleepInSlices(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }
}
