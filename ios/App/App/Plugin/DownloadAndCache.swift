import Foundation
import CryptoKit

struct DownloadCancelledError: Error {}

protocol DownloadEvents: AnyObject {
    func isCancelled() -> Bool
    func progress(received: Int64, total: Int64?)
}

final class ClosureDownloadEvents: DownloadEvents {
    private let cancelledCheck: () -> Bool
    private let onProgress: (Int64, Int64?) -> Void

    init(cancelledCheck: @escaping () -> Bool = { false }, onProgress: @escaping (Int64, Int64?) -> Void) {
        self.cancelledCheck = cancelledCheck
        self.onProgress = onProgress
    }

    func isCancelled() -> Bool { cancelledCheck() }
    func progress(received: Int64, total: Int64?) { onProgress(received, total) }
}

final class DownloadManager {
    struct Outcome {
        let entity: DownloadEntity
        let alreadyPresent: Bool
    }

    private let db: StatocystDatabase
    let directory: URL

    init(db: StatocystDatabase = .shared) {
        self.db = db
        self.directory = StatocystDatabase.appDataDirectory().appendingPathComponent("downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func download(
        trackId: String,
        onProgress: @escaping (Int64, Int64?, Bool, String?) -> Void
    ) throws -> Outcome {
        let events = ClosureDownloadEvents { received, total in
            onProgress(received, total, false, nil)
        }
        return try download(trackId: trackId, events: events)
    }

    func download(trackId: String, events: DownloadEvents) throws -> Outcome {
        guard let track = db.getMediaItemById(trackId) else {
            throw NSError(domain: "DownloadManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "The track does not exist"])
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        if let _ = verifiedFile(trackId), let existing = db.getDownload(trackId) {
            return Outcome(entity: existing, alreadyPresent: true)
        }

        let ext = (track.ext.isEmpty ? (track.format ?? "bin") : track.ext).lowercased()
        let finalURL = directory.appendingPathComponent("\(trackId).\(ext)")
        let partURL = directory.appendingPathComponent("\(trackId).\(ext).part")

        try? FileManager.default.removeItem(at: finalURL)
        try? FileManager.default.removeItem(at: partURL)

        do {
            if track.sourceKind.hasPrefix("jellyfin") {
                try copyRemote(track: track, target: partURL, events: events)
            } else {
                try copyLocal(track: track, target: partURL, events: events)
            }
            let attrs = try FileManager.default.attributesOfItem(atPath: partURL.path)
            let size = (attrs[.size] as? Int64) ?? 0
            guard size > 0 else {
                throw NSError(domain: "DownloadManager", code: 500, userInfo: [NSLocalizedDescriptionKey: "Downloaded file is empty"])
            }
            let digest = try sha256(of: partURL)
            if FileManager.default.fileExists(atPath: finalURL.path) {
                try? FileManager.default.removeItem(at: finalURL)
            }
            try FileManager.default.moveItem(at: partURL, to: finalURL)

            let now = ISO8601DateFormatter().string(from: Date())
            let entity = DownloadEntity(
                trackId: trackId,
                localPath: finalURL.path,
                sizeBytes: size,
                sha256: digest,
                container: track.format ?? track.ext,
                verified: true,
                createdAt: now
            )
            db.upsertDownload(entity)
            events.progress(received: size, total: size)
            return Outcome(entity: entity, alreadyPresent: false)
        } catch {
            try? FileManager.default.removeItem(at: partURL)
            throw error
        }
    }

    @discardableResult
    func remove(_ trackId: String) -> Bool {
        let record = db.getDownload(trackId)
        if let record = record {
            try? FileManager.default.removeItem(atPath: record.localPath)
        }
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for f in files where f.lastPathComponent.hasPrefix("\(trackId).") {
                try? FileManager.default.removeItem(at: f)
            }
        }
        let deleted = db.deleteDownload(trackId) > 0
        return deleted || record != nil
    }

    func list() -> [DownloadEntity] {
        return liveRecords()
    }

    func stats() -> (count: Int, totalBytes: Int64) {
        let records = liveRecords()
        let total = records.reduce(Int64(0)) { $0 + $1.sizeBytes }
        return (records.count, total)
    }

    func verifiedFile(_ trackId: String) -> URL? {
        guard let record = db.getDownload(trackId), record.verified else { return nil }
        let url = URL(fileURLWithPath: record.localPath)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue,
              let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64),
              size == record.sizeBytes, size > 0 else {
            return nil
        }
        return url
    }

    private func liveRecords() -> [DownloadEntity] {
        return db.getAllDownloads().filter { record in
            let url = URL(fileURLWithPath: record.localPath)
            var isDir: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && !isDir.boolValue
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0
            let intact = record.verified && exists && size == record.sizeBytes && size > 0
            if !intact {
                _ = db.deleteDownload(record.trackId)
                try? FileManager.default.removeItem(at: url)
            }
            return intact
        }
    }

    private func copyRemote(track: MediaItemEntity, target: URL, events: DownloadEvents) throws {
        guard let session = JellyfinSessions.forTrack(track) else {
            throw NSError(domain: "DownloadManager", code: 401, userInfo: [NSLocalizedDescriptionKey: "The server is not signed in"])
        }
        let itemId = track.path.isEmpty ? String(track.id.dropFirst(track.id.hasPrefix("jf-") ? 3 : 0)) : track.path
        let urlStr = JellyfinAuth.streamUrl(serverUrl: session.url, itemId: itemId)
        guard let url = URL(string: urlStr) else {
            throw NSError(domain: "DownloadManager", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid stream URL"])
        }
        try fetchStream(url: url, token: session.token, target: target, events: events)
    }

    private func copyLocal(track: MediaItemEntity, target: URL, events: DownloadEvents) throws {
        let source = URL(fileURLWithPath: track.path)
        guard FileManager.default.fileExists(atPath: source.path) else {
            throw NSError(domain: "DownloadManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "The source file is missing"])
        }
        if events.isCancelled() { throw DownloadCancelledError() }
        try FileManager.default.copyItem(at: source, to: target)
        let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64) ?? 0
        events.progress(received: size, total: size)
    }

    private func sha256(of fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

func fetchStream(url: URL, token: String, target: URL, events: DownloadEvents) throws {
    var req = URLRequest(url: url, timeoutInterval: 60)
    req.setValue("*/*", forHTTPHeaderField: "Accept")
    req.setValue(JellyfinAuth.header(token: token), forHTTPHeaderField: "Authorization")

    let sem = DispatchSemaphore(value: 0)
    var downloadError: Error?

    let task = URLSession.shared.downloadTask(with: req) { tempURL, response, error in
        defer { sem.signal() }
        if events.isCancelled() {
            downloadError = DownloadCancelledError()
            return
        }
        if let error = error {
            downloadError = error
            return
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            downloadError = NSError(domain: "DownloadManager", code: code, userInfo: [NSLocalizedDescriptionKey: "Download failed (HTTP \(code))"])
            return
        }
        guard let tempURL = tempURL else {
            downloadError = NSError(domain: "DownloadManager", code: 500, userInfo: [NSLocalizedDescriptionKey: "Missing temporary file"])
            return
        }
        do {
            if FileManager.default.fileExists(atPath: target.path) {
                try? FileManager.default.removeItem(at: target)
            }
            try FileManager.default.moveItem(at: tempURL, to: target)
            let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64) ?? 0
            events.progress(received: size, total: size)
        } catch {
            downloadError = error
        }
    }
    task.resume()
    sem.wait()

    if let err = downloadError {
        throw err
    }
}

// MARK: - DownloadQueue & DownloadCenter

enum DownloadQueueState: String {
    case queued, active, retrying, waiting, failed, done

    var isPending: Bool {
        return self != .failed && self != .done
    }
}

struct DownloadQueueEntry {
    var trackId: String
    var state: DownloadQueueState
    var receivedBytes: Int64
    var totalBytes: Int64?
    var attempt: Int
    var error: String?
}

struct DownloadQueueSnapshot {
    let entries: [DownloadQueueEntry]

    var total: Int { entries.count }
    var done: Int { entries.filter { $0.state == .done }.count }
    var failed: Int { entries.filter { $0.state == .failed }.count }
    var pending: Int { entries.filter { $0.state.isPending }.count }
    var finished: Bool { !entries.isEmpty && pending == 0 }
    var receivedBytes: Int64 { entries.reduce(0) { $0 + $1.receivedBytes } }
    var totalBytes: Int64? {
        let known = entries.compactMap { $0.totalBytes }
        return known.isEmpty ? nil : known.reduce(0, +)
    }
    var sizesKnown: Bool {
        entries.allSatisfy { $0.state == .done || $0.totalBytes != nil }
    }
}

final class DownloadCenter {
    static let shared = DownloadCenter()

    private let lock = NSLock()
    private var entries: [DownloadQueueEntry] = []
    private var cancelledIds: Set<String> = []
    private var listeners: [UUID: (DownloadQueueSnapshot) -> Void] = [:]
    private let workerQueue = DispatchQueue(label: "com.hopefulaspirationsindustries.statocyst.downloads", qos: .utility)
    private let manager = DownloadManager()

    private init() {}

    @discardableResult
    func addListener(_ listener: @escaping (DownloadQueueSnapshot) -> Void) -> UUID {
        let id = UUID()
        lock.lock()
        listeners[id] = listener
        lock.unlock()
        return id
    }

    func removeListener(_ id: UUID) {
        lock.lock()
        listeners.removeValue(forKey: id)
        lock.unlock()
    }

    func snapshot() -> DownloadQueueSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return DownloadQueueSnapshot(entries: entries)
    }

    func enqueue(_ trackIds: [String]) -> Int {
        var added: [String] = []
        lock.lock()
        if !entries.isEmpty && !entries.contains(where: { $0.state.isPending }) {
            entries.removeAll { $0.state == .done }
        }
        for id in trackIds where !id.isEmpty {
            if let idx = entries.firstIndex(where: { $0.trackId == id }) {
                if entries[idx].state != .failed { continue }
                entries[idx] = DownloadQueueEntry(trackId: id, state: .queued, receivedBytes: 0, totalBytes: nil, attempt: 0, error: nil)
            } else {
                entries.append(DownloadQueueEntry(trackId: id, state: .queued, receivedBytes: 0, totalBytes: nil, attempt: 0, error: nil))
            }
            cancelledIds.remove(id)
            added.append(id)
        }
        lock.unlock()

        if !added.isEmpty {
            publish()
            for id in added {
                workerQueue.async { [weak self] in
                    self?.runOne(id)
                }
            }
        }
        return added.count
    }

    func retryFailed() -> Int {
        lock.lock()
        let failedIds = entries.filter { $0.state == .failed }.map { $0.trackId }
        lock.unlock()
        return enqueue(failedIds)
    }

    func cancelAll() {
        lock.lock()
        for entry in entries where entry.state.isPending {
            cancelledIds.insert(entry.trackId)
        }
        entries.removeAll { $0.state == .queued }
        lock.unlock()
        publish()
    }

    func dismiss() {
        lock.lock()
        entries.removeAll { !$0.state.isPending }
        lock.unlock()
        publish()
    }

    private func runOne(_ trackId: String) {
        lock.lock()
        guard let idx = entries.firstIndex(where: { $0.trackId == trackId }) else {
            lock.unlock()
            return
        }
        if cancelledIds.contains(trackId) {
            cancelledIds.remove(trackId)
            entries.remove(at: idx)
            lock.unlock()
            publish()
            return
        }
        entries[idx].state = .active
        entries[idx].error = nil
        lock.unlock()
        publish()

        let events = ClosureDownloadEvents(
            cancelledCheck: { [weak self] in
                guard let self = self else { return true }
                self.lock.lock()
                defer { self.lock.unlock() }
                return self.cancelledIds.contains(trackId)
            },
            onProgress: { [weak self] received, total in
                guard let self = self else { return }
                self.lock.lock()
                if let i = self.entries.firstIndex(where: { $0.trackId == trackId }) {
                    self.entries[i].receivedBytes = received
                    self.entries[i].totalBytes = total
                }
                self.lock.unlock()
                self.publish()
            }
        )

        do {
            let outcome = try manager.download(trackId: trackId, events: events)
            lock.lock()
            if let i = entries.firstIndex(where: { $0.trackId == trackId }) {
                entries[i].state = .done
                entries[i].receivedBytes = outcome.entity.sizeBytes
                entries[i].totalBytes = outcome.entity.sizeBytes
                entries[i].error = nil
            }
            lock.unlock()
        } catch is DownloadCancelledError {
            lock.lock()
            cancelledIds.remove(trackId)
            entries.removeAll { $0.trackId == trackId }
            lock.unlock()
        } catch {
            lock.lock()
            if let i = entries.firstIndex(where: { $0.trackId == trackId }) {
                entries[i].state = .failed
                entries[i].error = error.localizedDescription
            }
            lock.unlock()
        }
        publish()
    }

    private func publish() {
        let snap = snapshot()
        lock.lock()
        let currentListeners = Array(listeners.values)
        lock.unlock()
        for listener in currentListeners {
            listener(snap)
        }
    }
}

// MARK: - MediaCache

final class MediaCache {
    struct Stats {
        let bytes: Int64
        let entries: Int
        let budgetBytes: Int64
        let pressure: Bool
    }

    private let db: StatocystDatabase
    let directory: URL
    private static let lock = NSLock()
    private static var inFlight: Set<String> = []

    init(db: StatocystDatabase = .shared) {
        self.db = db
        self.directory = StatocystDatabase.appDataDirectory().appendingPathComponent("cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func lookup(_ trackId: String) -> URL? {
        guard let record = db.getCacheEntry(trackId) else { return nil }
        let url = URL(fileURLWithPath: record.localPath)
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && !isDir.boolValue
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0
        guard exists, size == record.sizeBytes, size > 0 else {
            db.deleteCacheEntry(trackId)
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        db.touchCacheEntry(trackId, timestampMs: Int64(Date().timeIntervalSince1970 * 1000))
        return url
    }

    func stats(requestedBudget: Int64) -> Stats {
        let (budget, pressure) = effectiveBudget(requested: requestedBudget)
        let bytes = db.totalCacheBytes()
        let count = db.cacheEntryCount()
        return Stats(bytes: bytes, entries: count, budgetBytes: budget, pressure: pressure)
    }

    func budget(requestedBudget: Int64) -> Int64 {
        return effectiveBudget(requested: requestedBudget).0
    }

    @discardableResult
    func prefetch(trackId: String, requestedBudget: Int64) -> URL? {
        if let existing = lookup(trackId) { return existing }
        Self.lock.lock()
        let inserted = Self.inFlight.insert(trackId).inserted
        Self.lock.unlock()
        guard inserted else { return nil }
        defer {
            Self.lock.lock()
            Self.inFlight.remove(trackId)
            Self.lock.unlock()
        }

        guard let track = db.getMediaItemById(trackId),
              track.sourceKind.hasPrefix("jellyfin"),
              let session = JellyfinSessions.forTrack(track) else {
            return nil
        }

        let effective = budget(requestedBudget: requestedBudget)
        guard effective > 0 else { return nil }

        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = (track.ext.isEmpty ? (track.format ?? "bin") : track.ext).lowercased()
        let finalURL = directory.appendingPathComponent("\(trackId).\(ext)")
        let partURL = directory.appendingPathComponent("\(trackId).\(ext).part")

        let itemId = track.path.isEmpty ? String(track.id.dropFirst(track.id.hasPrefix("jf-") ? 3 : 0)) : track.path
        guard let url = URL(string: JellyfinAuth.streamUrl(serverUrl: session.url, itemId: itemId)) else {
            return nil
        }

        var overBudget = false
        let events = ClosureDownloadEvents(
            cancelledCheck: { overBudget },
            onProgress: { received, total in
                if received > effective || (total != nil && total! > effective) {
                    overBudget = true
                }
            }
        )

        do {
            try fetchStream(url: url, token: session.token, target: partURL, events: events)
            let size = (try? FileManager.default.attributesOfItem(atPath: partURL.path)[.size] as? Int64) ?? 0
            guard size > 0, size <= effective else {
                try? FileManager.default.removeItem(at: partURL)
                return nil
            }
            if FileManager.default.fileExists(atPath: finalURL.path) {
                try? FileManager.default.removeItem(at: finalURL)
            }
            try FileManager.default.moveItem(at: partURL, to: finalURL)
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            db.upsertCacheEntry(
                CacheEntryEntity(
                    trackId: trackId,
                    localPath: finalURL.path,
                    sizeBytes: size,
                    container: track.format ?? track.ext,
                    createdAt: now,
                    lastAccessAt: now
                )
            )
            trimToBudget(effective)
            return finalURL
        } catch {
            try? FileManager.default.removeItem(at: partURL)
            return nil
        }
    }

    func trimToBudget(_ budget: Int64) {
        var total = db.totalCacheBytes()
        guard total > budget else { return }
        let entries = db.getAllCacheEntries()
        for entry in entries {
            if total <= budget { break }
            try? FileManager.default.removeItem(atPath: entry.localPath)
            db.deleteCacheEntry(entry.trackId)
            total -= entry.sizeBytes
        }
    }

    func clear() -> Int {
        let entries = db.getAllCacheEntries()
        var removed = 0
        for entry in entries {
            try? FileManager.default.removeItem(atPath: entry.localPath)
            db.deleteCacheEntry(entry.trackId)
            removed += 1
        }
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for f in files {
                try? FileManager.default.removeItem(at: f)
            }
        }
        return removed
    }

    func reconcile() -> (removedEntries: Int, removedOrphans: Int) {
        let entries = db.getAllCacheEntries()
        let knownPaths = Set(entries.map { URL(fileURLWithPath: $0.localPath).standardizedFileURL.path })
        var removedEntries = 0
        for entry in entries {
            let url = URL(fileURLWithPath: entry.localPath)
            var isDir: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && !isDir.boolValue
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0
            if !exists || size != entry.sizeBytes {
                try? FileManager.default.removeItem(at: url)
                db.deleteCacheEntry(entry.trackId)
                removedEntries += 1
            }
        }
        var removedOrphans = 0
        if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for f in files {
                let norm = f.standardizedFileURL.path
                if !knownPaths.contains(norm) {
                    if (try? FileManager.default.removeItem(at: f)) != nil {
                        removedOrphans += 1
                    }
                }
            }
        }
        return (removedEntries, removedOrphans)
    }

    private func effectiveBudget(requested: Int64) -> (Int64, Bool) {
        let clamped = max(0, requested)
        let free = freeDiskSpaceBytes()
        guard free > 0 else { return (clamped, false) }
        let floor: Int64 = 64 * 1024 * 1024
        let fromFree = max(floor, free / 4)
        if clamped <= fromFree {
            return (clamped, false)
        }
        return (min(clamped, fromFree), true)
    }

    func freeDiskSpaceBytes() -> Int64 {
        let path = StatocystDatabase.appDataDirectory().path
        if let attrs = try? FileManager.default.attributesOfFileSystem(forPath: path),
           let free = attrs[.systemFreeSize] as? Int64 {
            return free
        }
        return -1
    }
}
