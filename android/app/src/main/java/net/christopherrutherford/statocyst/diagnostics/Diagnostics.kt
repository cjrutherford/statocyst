package net.christopherrutherford.statocyst.diagnostics

import android.content.Context
import android.os.StatFs
import net.christopherrutherford.statocyst.cache.MediaCache
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.downloads.DownloadManager
import java.io.File

data class HealthCheck(
    val id: String,
    val label: String,
    val status: String,
    val detail: String,
)

data class DiagnosticsSnapshot(
    val databasePath: String,
    val logPath: String,
    val databaseBytes: Long,
    val cacheBytes: Long,
    val schemaVersion: Int,
    val integrity: String,
    val trackCount: Int,
    val queueEntries: Int,
)

/**
 * Local-only diagnostics and health probes. Every probe is defensive: a failing
 * check becomes a readable `fail`/`warn` result rather than an exception, so the
 * Settings screen and an exported support bundle always have a full picture.
 * No check uploads anything.
 */
object Diagnostics {

    fun snapshot(
        context: Context,
        database: StatocystDatabase,
        cache: MediaCache,
        cacheBudgetBytes: Long,
        queueEntries: Int,
    ): DiagnosticsSnapshot {
        val databaseFile = context.getDatabasePath("statocyst.db")
        val cacheBytes = try {
            cache.stats(cacheBudgetBytes).bytes
        } catch (_: Exception) {
            0L
        }
        val trackCount = try {
            kotlinx.coroutines.runBlocking { database.mediaItemDao().count() }
        } catch (_: Exception) {
            0
        }
        return DiagnosticsSnapshot(
            databasePath = databaseFile.absolutePath,
            logPath = "",
            databaseBytes = databaseFile.length(),
            cacheBytes = cacheBytes,
            schemaVersion = schemaVersion(database),
            integrity = integrity(database),
            trackCount = trackCount,
            queueEntries = queueEntries,
        )
    }

    fun health(
        context: Context,
        database: StatocystDatabase,
        cache: MediaCache,
        downloads: DownloadManager,
        cacheBudgetBytes: Long,
    ): List<HealthCheck> {
        val checks = mutableListOf<HealthCheck>()

        val integrity = integrity(database)
        checks += HealthCheck(
            id = "database-integrity",
            label = "Database integrity",
            status = if (integrity == "ok") "ok" else "fail",
            detail = if (integrity == "ok") "PRAGMA integrity_check passed" else "Integrity check returned $integrity",
        )

        val version = schemaVersion(database)
        checks += HealthCheck(
            id = "schema",
            label = "Schema version",
            status = if (version >= 1) "ok" else "warn",
            detail = if (version >= 1) "Migration $version applied" else "No migrations recorded yet",
        )

        checks += probeDataDirectory(context)

        val free = try {
            StatFs(context.filesDir.absolutePath).availableBytes
        } catch (_: Exception) {
            -1L
        }
        checks += when {
            free < 0 -> HealthCheck(
                id = "disk-space",
                label = "Free disk space",
                status = "warn",
                detail = "Could not read filesystem stats",
            )
            free < MIN_FREE_BYTES -> HealthCheck(
                id = "disk-space",
                label = "Free disk space",
                status = "fail",
                detail = "${formatBytes(free)} free; below the 256 MiB minimum",
            )
            free < cacheBudgetBytes -> HealthCheck(
                id = "disk-space",
                label = "Free disk space",
                status = "warn",
                detail = "${formatBytes(free)} free; below the ${formatBytes(cacheBudgetBytes)} cache budget",
            )
            else -> HealthCheck(
                id = "disk-space",
                label = "Free disk space",
                status = "ok",
                detail = "${formatBytes(free)} free",
            )
        }

        val databaseFile = context.getDatabasePath("statocyst.db")
        checks += HealthCheck(
            id = "database-size",
            label = "Database size",
            status = "ok",
            detail = "${formatBytes(databaseFile.length())} at ${databaseFile.parentFile?.name ?: "app storage"}",
        )

        checks += try {
            val (count, bytes) = downloads.stats()
            HealthCheck(
                id = "downloads",
                label = "Saved downloads",
                status = "ok",
                detail = "$count track${if (count == 1) "" else "s"} · ${formatBytes(bytes)}",
            )
        } catch (error: Exception) {
            HealthCheck(
                id = "downloads",
                label = "Saved downloads",
                status = "warn",
                detail = "Could not read downloads: ${error.message ?: "unknown error"}",
            )
        }

        checks += try {
            val stats = cache.stats(cacheBudgetBytes)
            HealthCheck(
                id = "cache",
                label = "Rolling cache",
                status = if (stats.bytes > stats.budgetBytes) "warn" else "ok",
                detail = "${formatBytes(stats.bytes)} of ${formatBytes(stats.budgetBytes)}",
            )
        } catch (error: Exception) {
            HealthCheck(
                id = "cache",
                label = "Rolling cache",
                status = "warn",
                detail = "Could not read cache: ${error.message ?: "unknown error"}",
            )
        }

        val sessionCount = net.christopherrutherford.statocyst.jellyfin.JellyfinSessions.all(context).size
        checks += HealthCheck(
            id = "session",
            label = "Jellyfin session",
            status = if (sessionCount == 0) "warn" else "ok",
            detail = when (sessionCount) {
                0 -> "No stored Jellyfin session"
                1 -> "Stored session present (not printed)"
                else -> "$sessionCount stored sessions present (not printed)"
            },
        )

        return checks
    }

    private fun probeDataDirectory(context: Context): HealthCheck {
        val probe = File(context.filesDir, ".health-probe")
        return try {
            probe.writeText("statocyst-health-probe")
            val read = probe.readText()
            HealthCheck(
                id = "data-directory",
                label = "Data directory",
                status = if (read == "statocyst-health-probe") "ok" else "fail",
                detail = if (read == "statocyst-health-probe") "Writable and readable" else "Read-back mismatch",
            )
        } catch (error: Exception) {
            HealthCheck(
                id = "data-directory",
                label = "Data directory",
                status = "fail",
                detail = "Not writable: ${error.message ?: "unknown error"}",
            )
        } finally {
            probe.delete()
        }
    }

    private fun integrity(database: StatocystDatabase): String = try {
        database.openHelper.readableDatabase.query("PRAGMA integrity_check").use { cursor ->
            if (cursor.moveToFirst() && cursor.getString(0) == "ok") "ok" else "failed"
        }
    } catch (_: Exception) {
        "unknown"
    }

    private fun schemaVersion(database: StatocystDatabase): Int = try {
        database.openHelper.readableDatabase.version
    } catch (_: Exception) {
        0
    }

    private const val MIN_FREE_BYTES = 256L * 1024 * 1024

    fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val units = listOf("B", "KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit++
        }
        return if (value >= 10 || unit == 0) {
            "${Math.round(value)} ${units[unit]}"
        } else {
            String.format("%.1f %s", value, units[unit])
        }
    }
}
