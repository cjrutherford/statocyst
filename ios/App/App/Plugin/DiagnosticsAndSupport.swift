import Foundation
import UIKit

struct HealthCheckItem {
    let id: String
    let label: String
    let status: String
    let detail: String
}

struct DiagnosticsSnapshot {
    let databasePath: String
    let logPath: String
    let databaseBytes: Int64
    let cacheBytes: Int64
    let schemaVersion: Int
    let integrity: String
    let trackCount: Int
    let queueEntries: Int
}

enum Diagnostics {
    private static let MIN_FREE_BYTES: Int64 = 256 * 1024 * 1024

    static func snapshot(
        db: StatocystDatabase,
        cache: MediaCache,
        cacheBudgetBytes: Int64,
        queueEntries: Int = 0
    ) -> DiagnosticsSnapshot {
        let dbPath = db.databaseURL.path
        let dbBytes = (try? FileManager.default.attributesOfItem(atPath: dbPath)[.size] as? Int64) ?? 0
        let cacheBytes = cache.stats(requestedBudget: cacheBudgetBytes).bytes
        let trackCount = db.mediaItemCount()
        return DiagnosticsSnapshot(
            databasePath: dbPath,
            logPath: "",
            databaseBytes: dbBytes,
            cacheBytes: cacheBytes,
            schemaVersion: db.schemaVersion(),
            integrity: db.integrityCheck(),
            trackCount: trackCount,
            queueEntries: queueEntries
        )
    }

    static func health(
        db: StatocystDatabase,
        cache: MediaCache,
        downloads: DownloadManager,
        cacheBudgetBytes: Int64
    ) -> [HealthCheckItem] {
        var checks: [HealthCheckItem] = []

        let integrity = db.integrityCheck()
        checks.append(
            HealthCheckItem(
                id: "database-integrity",
                label: "Database integrity",
                status: integrity == "ok" ? "ok" : "fail",
                detail: integrity == "ok" ? "PRAGMA integrity_check passed" : "Integrity check returned \(integrity)"
            )
        )

        let version = db.schemaVersion()
        checks.append(
            HealthCheckItem(
                id: "schema",
                label: "Schema version",
                status: version >= 1 ? "ok" : "warn",
                detail: version >= 1 ? "Migration \(version) applied" : "No migrations recorded yet"
            )
        )

        checks.append(probeDataDirectory())

        let free = cache.freeDiskSpaceBytes()
        if free < 0 {
            checks.append(
                HealthCheckItem(
                    id: "disk-space",
                    label: "Free disk space",
                    status: "warn",
                    detail: "Could not read filesystem stats"
                )
            )
        } else if free < MIN_FREE_BYTES {
            checks.append(
                HealthCheckItem(
                    id: "disk-space",
                    label: "Free disk space",
                    status: "fail",
                    detail: "\(formatBytes(free)) free; below the 256 MiB minimum"
                )
            )
        } else if free < cacheBudgetBytes {
            checks.append(
                HealthCheckItem(
                    id: "disk-space",
                    label: "Free disk space",
                    status: "warn",
                    detail: "\(formatBytes(free)) free; below the \(formatBytes(cacheBudgetBytes)) cache budget"
                )
            )
        } else {
            checks.append(
                HealthCheckItem(
                    id: "disk-space",
                    label: "Free disk space",
                    status: "ok",
                    detail: "\(formatBytes(free)) free"
                )
            )
        }

        let dbBytes = (try? FileManager.default.attributesOfItem(atPath: db.databaseURL.path)[.size] as? Int64) ?? 0
        checks.append(
            HealthCheckItem(
                id: "database-size",
                label: "Database size",
                status: "ok",
                detail: "\(formatBytes(dbBytes)) at Statocyst"
            )
        )

        let dlStats = downloads.stats()
        checks.append(
            HealthCheckItem(
                id: "downloads",
                label: "Saved downloads",
                status: "ok",
                detail: "\(dlStats.count) track\(dlStats.count == 1 ? "" : "s") · \(formatBytes(dlStats.totalBytes))"
            )
        )

        let cStats = cache.stats(requestedBudget: cacheBudgetBytes)
        checks.append(
            HealthCheckItem(
                id: "cache",
                label: "Rolling cache",
                status: cStats.bytes > cStats.budgetBytes ? "warn" : "ok",
                detail: "\(formatBytes(cStats.bytes)) of \(formatBytes(cStats.budgetBytes))"
            )
        )

        let sessionCount = JellyfinSessions.all().count
        checks.append(
            HealthCheckItem(
                id: "session",
                label: "Jellyfin session",
                status: sessionCount == 0 ? "warn" : "ok",
                detail: sessionCount == 0
                    ? "No stored Jellyfin session"
                    : (sessionCount == 1 ? "Stored session present (not printed)" : "\(sessionCount) stored sessions present (not printed)")
            )
        )

        return checks
    }

    private static func probeDataDirectory() -> HealthCheckItem {
        let dir = StatocystDatabase.appDataDirectory()
        let probe = dir.appendingPathComponent(".health-probe")
        defer { try? FileManager.default.removeItem(at: probe) }
        do {
            let expected = "statocyst-health-probe"
            try expected.write(to: probe, atomically: true, encoding: .utf8)
            let readBack = try String(contentsOf: probe, encoding: .utf8)
            let ok = (readBack == expected)
            return HealthCheckItem(
                id: "data-directory",
                label: "Data directory",
                status: ok ? "ok" : "fail",
                detail: ok ? "Writable and readable" : "Read-back mismatch"
            )
        } catch {
            return HealthCheckItem(
                id: "data-directory",
                label: "Data directory",
                status: "fail",
                detail: "Not writable: \(error.localizedDescription)"
            )
        }
    }

    static func formatBytes(_ bytes: Int64) -> String {
        if bytes <= 0 { return "0 B" }
        let units = ["B", "KB", "MB", "GB", "TB"]
        var value = Double(bytes)
        var unit = 0
        while value >= 1024 && unit < units.count - 1 {
            value /= 1024
            unit += 1
        }
        if value >= 10 || unit == 0 {
            return "\(Int(value.rounded())) \(units[unit])"
        }
        return String(format: "%.1f %@", value, units[unit])
    }
}

final class SupportBundle {
    private let db: StatocystDatabase
    private let downloads: DownloadManager
    private let cache: MediaCache

    init(db: StatocystDatabase = .shared, downloads: DownloadManager, cache: MediaCache) {
        self.db = db
        self.downloads = downloads
        self.cache = cache
    }

    func write(cacheBudgetBytes: Int64) throws -> URL {
        let dir = StatocystDatabase.appDataDirectory().appendingPathComponent("support", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: ".", with: "-")
        let fileURL = dir.appendingPathComponent("statocyst-support-\(stamp).json")

        let snap = Diagnostics.snapshot(db: db, cache: cache, cacheBudgetBytes: cacheBudgetBytes)
        let checks = Diagnostics.health(db: db, cache: cache, downloads: downloads, cacheBudgetBytes: cacheBudgetBytes)
        let dlStats = downloads.stats()
        let cStats = cache.stats(requestedBudget: cacheBudgetBytes)

        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.9.0"
        let buildNumber = Int((Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "27") ?? 27
        let systemVersion = UIDevice.current.systemVersion
        let deviceModel = UIDevice.current.model

        let bundleDict: [String: Any] = [
            "schema": 1,
            "generatedAt": ISO8601DateFormatter().string(from: Date()),
            "app": [
                "name": "Statocyst",
                "version": version,
                "versionCode": buildNumber,
                "platform": "ios",
                "ios": systemVersion,
                "device": "Apple \(deviceModel)"
            ],
            "diagnostics": [
                "databasePath": snap.databasePath,
                "databaseBytes": snap.databaseBytes,
                "cacheBytes": snap.cacheBytes,
                "schemaVersion": snap.schemaVersion,
                "integrity": snap.integrity,
                "queueEntries": snap.queueEntries,
                "trackCount": snap.trackCount
            ],
            "health": checks.map { c in
                [
                    "id": c.id,
                    "label": c.label,
                    "status": c.status,
                    "detail": c.detail
                ]
            },
            "storage": [
                "downloads": [
                    "count": dlStats.count,
                    "totalBytes": dlStats.totalBytes
                ],
                "cache": [
                    "bytes": cStats.bytes,
                    "entries": cStats.entries,
                    "budgetBytes": cStats.budgetBytes,
                    "pressure": cStats.pressure
                ]
            ],
            "privacy": [
                "externalReporting": false,
                "note": "This bundle was written locally. Statocyst does not upload diagnostics."
            ]
        ]

        let data = try JSONSerialization.data(withJSONObject: bundleDict, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }
}
