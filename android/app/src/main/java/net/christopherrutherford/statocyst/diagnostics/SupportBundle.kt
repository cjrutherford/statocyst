package net.christopherrutherford.statocyst.diagnostics

import android.content.Context
import net.christopherrutherford.statocyst.cache.MediaCache
import net.christopherrutherford.statocyst.db.StatocystDatabase
import net.christopherrutherford.statocyst.downloads.DownloadManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Writes a local, redacted diagnostics bundle that a person can share with a
 * developer. The bundle never contains the Jellyfin access token, a password or
 * any listening history. Statocyst does not upload it: it is written to
 * app-private storage and handed to the Android share sheet by the plugin.
 */
class SupportBundle(
    private val context: Context,
    private val database: StatocystDatabase,
    private val downloads: DownloadManager,
    private val cache: MediaCache,
) {

    fun write(cacheBudgetBytes: Long): File {
        val directory = File(context.filesDir, "support")
        directory.mkdirs()
        val stamp = Instant.now().toString().replace(":", "-").replace(".", "-")
        val file = File(directory, "statocyst-support-$stamp.json")
        val snapshot = Diagnostics.snapshot(
            context = context,
            database = database,
            cache = cache,
            cacheBudgetBytes = cacheBudgetBytes,
            queueEntries = 0,
        )
        val health = Diagnostics.health(
            context = context,
            database = database,
            cache = cache,
            downloads = downloads,
            cacheBudgetBytes = cacheBudgetBytes,
        )

        val info = try {
            context.packageManager.getPackageInfo(context.packageName, 0)
        } catch (_: Exception) {
            null
        }

        val app = JSONObject()
            .put("name", "Statocyst")
            .put("version", info?.versionName ?: "0.1.0")
            .put(
                "versionCode",
                if (info == null) 0L else if (android.os.Build.VERSION.SDK_INT >= 28) {
                    info.longVersionCode
                } else {
                    info.versionCode.toLong()
                },
            )
            .put("platform", "android")
            .put("android", android.os.Build.VERSION.RELEASE)
            .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")

        val diagnostics = JSONObject()
            .put("databasePath", snapshot.databasePath)
            .put("databaseBytes", snapshot.databaseBytes)
            .put("cacheBytes", snapshot.cacheBytes)
            .put("schemaVersion", snapshot.schemaVersion)
            .put("integrity", snapshot.integrity)
            .put("queueEntries", snapshot.queueEntries)
            .put("trackCount", snapshot.trackCount)

        val settings = readSettings(cacheBudgetBytes)
        val healthJson = JSONArray()
        for (check in health) {
            healthJson.put(
                JSONObject()
                    .put("id", check.id)
                    .put("label", check.label)
                    .put("status", check.status)
                    .put("detail", check.detail),
            )
        }

        val downloadStats = try {
            downloads.stats()
        } catch (_: Exception) {
            null
        }
        val cacheStats = try {
            cache.stats(cacheBudgetBytes)
        } catch (_: Exception) {
            null
        }

        val bundle = JSONObject()
            .put("schema", 1)
            .put("generatedAt", Instant.now().toString())
            .put("app", app)
            .put("diagnostics", diagnostics)
            .put("settings", settings)
            .put("health", healthJson)
            .put(
                "storage",
                JSONObject()
                    .put("downloads", downloadStats?.let { JSONObject().put("count", it.first).put("totalBytes", it.second) })
                    .put(
                        "cache",
                        cacheStats?.let {
                            JSONObject()
                                .put("bytes", it.bytes)
                                .put("entries", it.entries)
                                .put("budgetBytes", it.budgetBytes)
                                .put("pressure", it.pressure)
                        },
                    ),
            )
            .put(
                "privacy",
                JSONObject()
                    .put("externalReporting", false)
                    .put("listeningHistory", settings.optBoolean("listeningHistory", false))
                    .put("note", "This bundle was written locally. Statocyst does not upload diagnostics."),
            )
        file.writeText(bundle.toString(2) + "\n")
        return file
    }

    /**
     * Settings from the same store the renderer uses (Capacitor Preferences).
     * An unset cache budget falls back to the effective budget in use, so the
     * bundle never reports "0 bytes" for a default the app is honouring.
     */
    private fun readSettings(effectiveBudgetBytes: Long): JSONObject {
        val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val storedBudget = prefs.getString("cacheBudgetBytes", null)?.toLongOrNull()
        return JSONObject()
            .put("theme", prefs.getString("theme", "system"))
            .put("density", prefs.getString("density", "comfortable"))
            .put("quality", prefs.getString("quality", "lossless"))
            .put(
                "cacheBudgetBytes",
                if (storedBudget != null && storedBudget > 0) storedBudget else effectiveBudgetBytes,
            )
            .put("listeningHistory", prefs.getString("listeningHistory", "false") == "true")
    }
}
