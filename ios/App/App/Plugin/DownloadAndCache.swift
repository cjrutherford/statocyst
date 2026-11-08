import Foundation
import CryptoKit

struct DownloadCancelledError: Error {}

protocol DownloadEvents: AnyObject {
    func isCancelled() -> Bool
    func progress(received: Int64, total: Int64?)
    func waiting()
    func retrying(attempt: Int, reason: String)
}

extension DownloadEvents {
    func waiting() {}
    func retrying(attempt: Int, reason: String) {}
}

final class ClosureDownloadEvents: DownloadEvents {
    private let cancelledCheck: () -> Bool
    private let onWaiting: () -> Void
    private let onRetrying: (Int, String) -> Void
    private let onProgress: (Int64, Int64?) -> Void

    init(
        cancelledCheck: @escaping () -> Bool = { false },
        onWaiting: @escaping () -> Void = {},
        onRetrying: @escaping (Int, String) -> Void = { _, _ in },
        onProgress: @escaping (Int64, Int64?) -> Void
    ) {
        self.cancelledCheck = cancelledCheck
        self.onWaiting = onWaiting
        self.onRetrying = onRetrying
        self.onProgress = onProgress
    }

    func isCancelled() -> Bool { cancelledCheck() }
    func progress(received: Int64, total: Int64?) { onProgress(received, total) }
    func waiting() { onWaiting() }
    func retrying(attempt: Int, reason: String) { onRetrying(attempt, reason) }
}

/**
 * Durable state for the download queue and the background URLSession resume data.
 *
 * Both values live in UserDefaults so a relaunch can rebuild the queue before any
 * UI listener exists. Resume data is opaque to us; it is only ever handed back to
 * `URLSessionDownloadTask` for the same track.
 */
enum DownloadStore {
    static let pendingKey = "statocyst.downloads.pending.v1"
    static let resumeKey = "statocyst.downloads.resume.v1"

    struct PendingEntry: Codable {
        var trackId: String
        var state: String
        var receivedBytes: Int64
        var totalBytes: Int64?
        var attempt: Int
        var error: String?
    }

    private static let lock = NSLock()

    static func loadPending() -> [PendingEntry] {
        lock.lock()
        defer { lock.unlock() }
        return loadPendingLocked()
    }

    static func pendingReceivedBytes(trackId: String) -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        return loadPendingLocked().first(where: { $0.trackId == trackId })?.receivedBytes ?? 0
    }

    static func savePending(_ entries: [PendingEntry]) {
        lock.lock()
        defer { lock.unlock() }
        if entries.isEmpty {
            UserDefaults.standard.removeObject(forKey: pendingKey)
            return
        }
        guard let data = try? JSONEncoder().encode(entries) else { return }
        UserDefaults.standard.set(data, forKey: pendingKey)
    }

    static func clearPending() {
        lock.lock()
        defer { lock.unlock() }
        UserDefaults.standard.removeObject(forKey: pendingKey)
    }

    static func saveResumeData(_ data: Data, trackId: String) {
        guard !data.isEmpty, !trackId.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        var map = loadResumeMapLocked()
        map[trackId] = data
        writeResumeMapLocked(map)
    }

    static func resumeData(trackId: String) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return loadResumeMapLocked()[trackId]
    }

    static func clearResumeData(trackId: String) {
        lock.lock()
        defer { lock.unlock() }
        var map = loadResumeMapLocked()
        if map.removeValue(forKey: trackId) != nil {
            writeResumeMapLocked(map)
        }
    }

    static func clearAllResumeData() {
        lock.lock()
        defer { lock.unlock() }
        UserDefaults.standard.removeObject(forKey: resumeKey)
    }

    private static func loadPendingLocked() -> [PendingEntry] {
        guard let data = UserDefaults.standard.data(forKey: pendingKey),
              let entries = try? JSONDecoder().decode([PendingEntry].self, from: data) else {
            return []
        }
        return entries
    }

    private static func loadResumeMapLocked() -> [String: Data] {
        guard let data = UserDefaults.standard.data(forKey: resumeKey),
              let map = try? JSONDecoder().decode([String: Data].self, from: data) else {
            return [:]
        }
        return map
    }

    private static func writeResumeMapLocked(_ map: [String: Data]) {
        if map.isEmpty {
            UserDefaults.standard.removeObject(forKey: resumeKey)
        } else if let data = try? JSONEncoder().encode(map) {
            UserDefaults.standard.set(data, forKey: resumeKey)
        }
    }
}

final class DownloadManager {
    struct Outcome {
        let entity: DownloadEntity
        let alreadyPresent: Bool
    }

    static let shared = DownloadManager()

    private static let trackLockMapLock = NSLock()
    private static var trackLocks: [String: NSLock] = [:]

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
        // Serialises direct `downloadTrack` calls with the native queue for the
        // same track. A waiting caller re-checks the verified file once it wins
        // the lock, so it normally becomes an `alreadyPresent` result.
        let trackLock = Self.lock(for: trackId)
        trackLock.lock()
        defer { trackLock.unlock() }
        if events.isCancelled() { throw DownloadCancelledError() }

        guard let track = db.getMediaItemById(trackId) else {
            throw NSError(domain: "DownloadManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "The track does not exist"])
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        if let _ = verifiedFile(trackId), let existing = db.getDownload(trackId) {
            DownloadStore.clearResumeData(trackId: trackId)
            return Outcome(entity: existing, alreadyPresent: true)
        }

        let ext = (track.ext.isEmpty ? (track.format ?? "bin") : track.ext).lowercased()
        let finalURL = directory.appendingPathComponent("\(trackId).\(ext)")
        let partURL = directory.appendingPathComponent("\(trackId).\(ext).part")
        let podcastRemote = track.sourceKind == "podcast" &&
            (URL(string: track.path)?.scheme?.lowercased().hasPrefix("http") ?? false)
        let isRemote = track.sourceKind.hasPrefix("jellyfin") || podcastRemote

        // If an earlier run moved a complete background download into the staging
        // path but died before hashing/moving it, finish that work before fetching
        // the whole track again.
        if isRemote, track.sizeBytes > 0,
           let attrs = try? FileManager.default.attributesOfItem(atPath: partURL.path),
           let stagedSize = attrs[.size] as? Int64,
           stagedSize == track.sizeBytes,
           let entity = try? finalizePart(trackId: trackId, partURL: partURL, container: track.format ?? track.ext) {
            DownloadStore.clearResumeData(trackId: trackId)
            events.progress(received: entity.sizeBytes, total: entity.sizeBytes)
            return Outcome(entity: entity, alreadyPresent: false)
        }

        try? FileManager.default.removeItem(at: finalURL)
        if !isRemote {
            // Local imports cannot be resumed; a stale part file would only confuse the copy.
            try? FileManager.default.removeItem(at: partURL)
        }

        do {
            if isRemote {
                try copyRemote(track: track, trackId: trackId, target: partURL, events: events)
            } else {
                try copyLocal(track: track, target: partURL, events: events)
            }
            let entity = try finalizePart(trackId: trackId, partURL: partURL, container: track.format ?? track.ext)
            DownloadStore.clearResumeData(trackId: trackId)
            events.progress(received: entity.sizeBytes, total: entity.sizeBytes)
            return Outcome(entity: entity, alreadyPresent: false)
        } catch {
            if !isRemote {
                try? FileManager.default.removeItem(at: partURL)
            }
            // Remote failures keep the resume data and any completed part file so a retry can continue.
            throw error
        }
    }

    /**
     * Verifies a completed `.part` file, moves it into its final download path and
     * records it in the database. Shared by the synchronous transfer path and by
     * background-session tasks that finish while no caller is waiting.
     */
    @discardableResult
    func finalizePart(trackId: String, partURL: URL, container: String?) throws -> DownloadEntity {
        let attrs = try FileManager.default.attributesOfItem(atPath: partURL.path)
        let size = (attrs[.size] as? Int64) ?? 0
        guard size > 0 else {
            throw NSError(domain: "DownloadManager", code: 500, userInfo: [NSLocalizedDescriptionKey: "Downloaded file is empty"])
        }
        let digest = try sha256(of: partURL)
        let finalURL = finalURL(forPart: partURL)
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
            container: container,
            verified: true,
            createdAt: now
        )
        db.upsertDownload(entity)
        return entity
    }

    @discardableResult
    func finalizeBackgroundDownload(trackId: String, partURL: URL) throws -> DownloadEntity {
        guard let track = db.getMediaItemById(trackId) else {
            try? FileManager.default.removeItem(at: partURL)
            throw NSError(domain: "DownloadManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "The track does not exist"])
        }
        return try finalizePart(trackId: trackId, partURL: partURL, container: track.format ?? track.ext)
    }

    /// The deterministic staging path for a track, used when a background task finishes
    /// in a launch where no synchronous download call is waiting for it.
    func partFileURL(trackId: String) -> URL? {
        guard let track = db.getMediaItemById(trackId) else { return nil }
        let ext = (track.ext.isEmpty ? (track.format ?? "bin") : track.ext).lowercased()
        return directory.appendingPathComponent("\(trackId).\(ext).part")
    }

    @discardableResult
    func remove(_ trackId: String) -> Bool {
        BackgroundDownloadSession.shared.cancel(trackId: trackId, discardResumeData: true)
        DownloadStore.clearResumeData(trackId: trackId)
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

    private func copyRemote(track: MediaItemEntity, trackId: String, target: URL, events: DownloadEvents) throws {
        if track.sourceKind == "podcast" {
            guard let url = URL(string: track.path),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https" else {
                throw NSError(domain: "DownloadManager", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid podcast enclosure URL"])
            }
            var request = URLRequest(url: url, timeoutInterval: 60)
            request.setValue("*/*", forHTTPHeaderField: "Accept")
            try BackgroundDownloadSession.shared.download(
                trackId: trackId,
                request: request,
                target: target,
                events: events
            )
            return
        }
        guard let session = JellyfinSessions.forTrack(track) else {
            throw NSError(domain: "DownloadManager", code: 401, userInfo: [NSLocalizedDescriptionKey: "The server is not signed in"])
        }
        let itemId = track.path.isEmpty ? String(track.id.dropFirst(track.id.hasPrefix("jf-") ? 3 : 0)) : track.path
        let urlStr = JellyfinAuth.streamUrl(serverUrl: session.url, itemId: itemId)
        guard let url = URL(string: urlStr) else {
            throw NSError(domain: "DownloadManager", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid stream URL"])
        }

        var request = URLRequest(url: url, timeoutInterval: 60)
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.setValue(JellyfinAuth.header(token: session.token), forHTTPHeaderField: "Authorization")
        try BackgroundDownloadSession.shared.download(
            trackId: trackId,
            request: request,
            target: target,
            events: events
        )
    }

    private func finalURL(forPart partURL: URL) -> URL {
        let name = partURL.lastPathComponent
        let finalName = name.hasSuffix(".part") ? String(name.dropLast(5)) : name
        return directory.appendingPathComponent(finalName)
    }

    private static func lock(for trackId: String) -> NSLock {
        trackLockMapLock.lock()
        defer { trackLockMapLock.unlock() }
        if let existing = trackLocks[trackId] {
            return existing
        }
        let created = NSLock()
        trackLocks[trackId] = created
        return created
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

/**
 * Owns the app's single background `URLSession` for pinned downloads.
 *
 * A background download task is handed to `nsurlsessiond`, so it keeps moving while
 * the app is suspended. `URLSession` supplies opaque resume data when a task is
 * cancelled or interrupted; that data is stored in `DownloadStore` and passed back
 * to `downloadTask(withResumeData:)` on the next attempt. Tasks that outlive the
 * process are adopted by `taskDescription` when the session reconnects, and their
 * completed file is verified and recorded without needing a waiting caller.
 *
 * Transfer failures are classified Android-style: 401/403 and other unexpected
 * client responses are fatal; 429, 5xx and transport errors back off and resume.
 *
 * NOTE: full background-relaunch delivery also needs the AppDelegate
 * `application(_:handleEventsForBackgroundURLSession:completionHandler:)` hook.
 * This slice is scoped away from AppDelegate; a cold relaunch therefore reconnects
 * from plugin load and lets the system deliver outstanding task callbacks then.
 */
final class BackgroundDownloadSession: NSObject {
    static let shared = BackgroundDownloadSession()

    static let identifier = "com.hopefulaspirationsindustries.statocyst.downloads"
    private static let retryBackoff: [TimeInterval] = [2, 5, 15, 30]
    private static let maxAttemptsWithoutProgress = 5

    private final class Transfer {
        let trackId: String
        let target: URL
        let events: DownloadEvents
        let semaphore = DispatchSemaphore(value: 0)
        var taskIdentifier: Int = 0
        weak var task: URLSessionDownloadTask?
        var received: Int64 = 0
        var total: Int64?
        var httpStatus: Int?
        var responseError: Error?
        var resumeData: Data?
        var fileBytes: Int64 = 0
        var finalized = false
        var completed = false
        var cancelRequested = false
        var cancelledByUser = false
        var discardResumeData = false
        var lastProgressAt: TimeInterval = 0

        init(trackId: String, target: URL, events: DownloadEvents) {
            self.trackId = trackId
            self.target = target
            self.events = events
        }
    }

    private struct AttemptResult {
        let cancelled: Bool
        let bytes: Int64
        let bytesWritten: Int64
        let httpStatus: Int?
        let error: Error?
        let resumeData: Data?
        let finalized: Bool
    }

    private let lock = NSLock()
    private var transfers: [Int: Transfer] = [:]
    private var orphanProgressAt: [String: TimeInterval] = [:]
    private var session: URLSession!

    /**
     * Set by `AppDelegate.application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
     * The system waits for this to be called after the app is woken to deliver events
     * for a background session; not calling it can get the app terminated.
     */
    var backgroundEventsCompletionHandler: (() -> Void)?

    private override init() {
        super.init()

        let delegateQueue = OperationQueue()
        delegateQueue.name = "com.hopefulaspirationsindustries.statocyst.downloads.delegate"
        delegateQueue.maxConcurrentOperationCount = 1

        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.waitsForConnectivity = true
        config.httpMaximumConnectionsPerHost = 3
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 7 * 24 * 60 * 60
        session = URLSession(configuration: config, delegate: self, delegateQueue: delegateQueue)
    }

    /// Creating the session with the stable identifier reconnects it to tasks that
    /// the system kept running while the previous process was gone.
    func reconnect() {
        _ = session
        // Fetches the restored task list and lets the system deliver any pending
        // delegate callbacks for work that outlived the previous process.
        session.getAllTasks { _ in }
    }

    @discardableResult
    func download(
        trackId: String,
        request: URLRequest,
        target: URL,
        events: DownloadEvents
    ) throws -> Int64 {
        var attempt = 0
        var restartedFromScratch = false
        var announcedRestart = false
        let priorReceived = DownloadStore.pendingReceivedBytes(trackId: trackId)

        while true {
            if events.isCancelled() { throw DownloadCancelledError() }

            if let adopted = adoptExistingTask(trackId: trackId, target: target, events: events) {
                if events.isCancelled() {
                    cancel(trackId: trackId)
                    throw DownloadCancelledError()
                }
                let result = waitForCompletion(adopted)
                if let bytes = try handle(
                    result: result,
                    trackId: trackId,
                    events: events,
                    attempt: &attempt,
                    restartedFromScratch: &restartedFromScratch
                ) {
                    return bytes
                }
                continue
            }

            let storedResumeData = DownloadStore.resumeData(trackId: trackId)
            if storedResumeData == nil, priorReceived > 0, !announcedRestart, !restartedFromScratch {
                // There was progress on a previous process but the platform did not
                // give us resume data. Say so instead of silently dropping those bytes.
                announcedRestart = true
                events.retrying(
                    attempt: 1,
                    reason: "The interrupted download could not be resumed; restarting from the beginning."
                )
            }

            let task: URLSessionDownloadTask
            if let resumeData = storedResumeData {
                task = session.downloadTask(withResumeData: resumeData)
            } else {
                task = session.downloadTask(with: request)
            }
            task.taskDescription = trackId

            let transfer = Transfer(trackId: trackId, target: target, events: events)
            transfer.task = task
            transfer.taskIdentifier = task.taskIdentifier
            lock.lock()
            transfers[task.taskIdentifier] = transfer
            lock.unlock()

            if events.isCancelled() {
                lock.lock()
                transfers.removeValue(forKey: task.taskIdentifier)
                lock.unlock()
                task.cancel()
                throw DownloadCancelledError()
            }
            task.resume()
            let result = waitForCompletion(transfer)
            if let bytes = try handle(
                result: result,
                trackId: trackId,
                events: events,
                attempt: &attempt,
                restartedFromScratch: &restartedFromScratch
            ) {
                return bytes
            }
        }
    }

    func cancel(trackId: String, discardResumeData: Bool = false) {
        var cancellations: [(Transfer, URLSessionDownloadTask)] = []
        lock.lock()
        for (_, transfer) in transfers where transfer.trackId == trackId {
            transfer.cancelledByUser = true
            if discardResumeData {
                transfer.discardResumeData = true
            }
            if !transfer.cancelRequested, let task = transfer.task {
                transfer.cancelRequested = true
                cancellations.append((transfer, task))
            }
        }
        lock.unlock()

        for (transfer, task) in cancellations {
            task.cancel(byProducingResumeData: { [weak self] data in
                if let data = data, !data.isEmpty, !transfer.discardResumeData {
                    DownloadStore.saveResumeData(data, trackId: transfer.trackId)
                }
                self?.finish(transfer, error: nil, resumeData: transfer.discardResumeData ? nil : data)
            })
        }
    }

    // MARK: - Attempt handling

    private func waitForCompletion(_ transfer: Transfer) -> AttemptResult {
        transfer.semaphore.wait()
        lock.lock()
        let result = AttemptResult(
            cancelled: transfer.cancelledByUser,
            bytes: transfer.fileBytes,
            bytesWritten: transfer.received,
            httpStatus: transfer.httpStatus,
            error: transfer.responseError,
            resumeData: transfer.resumeData,
            finalized: transfer.finalized
        )
        lock.unlock()
        return result
    }

    private func handle(
        result: AttemptResult,
        trackId: String,
        events: DownloadEvents,
        attempt: inout Int,
        restartedFromScratch: inout Bool
    ) throws -> Int64? {
        if result.cancelled || events.isCancelled() {
            if let data = result.resumeData, !data.isEmpty {
                DownloadStore.saveResumeData(data, trackId: trackId)
            }
            throw DownloadCancelledError()
        }

        if let status = result.httpStatus, !(200...299).contains(status) {
            if status == 401 || status == 403 {
                DownloadStore.clearResumeData(trackId: trackId)
                throw NSError(
                    domain: "DownloadManager",
                    code: status,
                    userInfo: [NSLocalizedDescriptionKey: "The stored Jellyfin session was rejected (HTTP \(status)); sign in again to retry."]
                )
            }
            if status == 416 {
                DownloadStore.clearResumeData(trackId: trackId)
                if !restartedFromScratch {
                    restartedFromScratch = true
                    events.retrying(attempt: 0, reason: "The server could not resume the partial download; restarting from the beginning.")
                    return nil
                }
                throw NSError(
                    domain: "DownloadManager",
                    code: 416,
                    userInfo: [NSLocalizedDescriptionKey: "The server rejected the requested download range (HTTP 416)."]
                )
            }
            if status == 429 || (500...599).contains(status) {
                saveResume(result.resumeData, trackId: trackId)
                let shouldRetry = try advance(
                    attempt: &attempt,
                    // The error page may have been "written"; it is not progress.
                    wroteBytes: 0,
                    events: events,
                    message: "The server returned HTTP \(status); retrying."
                )
                guard shouldRetry else {
                    throw NSError(
                        domain: "DownloadManager",
                        code: status,
                        userInfo: [NSLocalizedDescriptionKey: "Download failed after repeated attempts (HTTP \(status))."]
                    )
                }
                return nil
            }
            DownloadStore.clearResumeData(trackId: trackId)
            throw NSError(
                domain: "DownloadManager",
                code: status,
                userInfo: [NSLocalizedDescriptionKey: "Download failed (HTTP \(status))."]
            )
        }

        if let error = result.error {
            guard isRetryable(error) else {
                DownloadStore.clearResumeData(trackId: trackId)
                throw error
            }
            saveResume(result.resumeData, trackId: trackId)
            let shouldRetry = try advance(
                attempt: &attempt,
                wroteBytes: result.bytesWritten,
                events: events,
                message: (error as NSError).localizedDescription
            )
            if !shouldRetry {
                // Last chance: a resume blob that cannot be used must not strand the
                // download forever. Discard it, say so, and make one fresh attempt.
                if DownloadStore.resumeData(trackId: trackId) != nil && !restartedFromScratch {
                    DownloadStore.clearResumeData(trackId: trackId)
                    restartedFromScratch = true
                    attempt = 0
                    events.retrying(attempt: 0, reason: "The saved partial download could not be resumed; restarting from the beginning.")
                    return nil
                }
                throw error
            }
            return nil
        }

        if result.finalized && result.bytes > 0 {
            DownloadStore.clearResumeData(trackId: trackId)
            return result.bytes
        }

        throw NSError(domain: "DownloadManager", code: 500, userInfo: [NSLocalizedDescriptionKey: "The download finished without a file"])
    }

    private func saveResume(_ data: Data?, trackId: String) {
        if let data = data, !data.isEmpty {
            DownloadStore.saveResumeData(data, trackId: trackId)
        }
    }

    private func advance(
        attempt: inout Int,
        wroteBytes: Int64,
        events: DownloadEvents,
        message: String
    ) throws -> Bool {
        if wroteBytes > 0 {
            attempt = 0
        } else {
            attempt += 1
        }
        if attempt >= Self.maxAttemptsWithoutProgress {
            return false
        }
        events.retrying(attempt: max(attempt, 1), reason: message)
        try sleepCancellable(seconds: retryDelay(for: attempt), events: events)
        return true
    }

    private func retryDelay(for attempt: Int) -> TimeInterval {
        let index = min(max(attempt - 1, 0), Self.retryBackoff.count - 1)
        return Self.retryBackoff[index]
    }

    private func sleepCancellable(seconds: TimeInterval, events: DownloadEvents) throws {
        var remaining = max(0, seconds)
        while remaining > 0 {
            if events.isCancelled() { throw DownloadCancelledError() }
            let slice = min(0.25, remaining)
            Thread.sleep(forTimeInterval: slice)
            remaining -= slice
        }
    }

    private func isRetryable(_ error: Error) -> Bool {
        let ns = error as NSError
        guard ns.domain == NSURLErrorDomain else { return false }
        switch ns.code {
        case NSURLErrorTimedOut,
             NSURLErrorNetworkConnectionLost,
             NSURLErrorCannotFindHost,
             NSURLErrorCannotConnectToHost,
             NSURLErrorDNSLookupFailed,
             NSURLErrorResourceUnavailable,
             NSURLErrorNotConnectedToInternet,
             NSURLErrorSecureConnectionFailed,
             NSURLErrorInternationalRoamingOff,
             NSURLErrorCallIsActive,
             NSURLErrorDataNotAllowed,
             NSURLErrorCannotLoadFromNetwork,
             NSURLErrorBackgroundSessionWasDisconnected,
             NSURLErrorCancelled:
            return true
        default:
            return false
        }
    }

    private func adoptExistingTask(trackId: String, target: URL, events: DownloadEvents) -> Transfer? {
        let semaphore = DispatchSemaphore(value: 0)
        var adopted: Transfer?
        session.getAllTasks { [weak self] tasks in
            guard let self = self else {
                semaphore.signal()
                return
            }
            let match = tasks.compactMap { $0 as? URLSessionDownloadTask }.first { task in
                task.taskDescription == trackId && (task.state == .running || task.state == .suspended)
            }
            if let task = match {
                self.lock.lock()
                let alreadyOwned = self.transfers[task.taskIdentifier] != nil
                if !alreadyOwned {
                    let transfer = Transfer(trackId: trackId, target: target, events: events)
                    transfer.task = task
                    transfer.taskIdentifier = task.taskIdentifier
                    self.transfers[task.taskIdentifier] = transfer
                    adopted = transfer
                }
                self.lock.unlock()
                if !alreadyOwned {
                    task.resume()
                }
            }
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 5)
        return adopted
    }

    private func finish(_ transfer: Transfer, error: Error?, resumeData: Data?) {
        lock.lock()
        if transfer.completed {
            lock.unlock()
            return
        }
        transfer.completed = true
        if transfer.responseError == nil, let error = error {
            transfer.responseError = error
        }
        if let data = resumeData, !data.isEmpty {
            transfer.resumeData = data
        }
        lock.unlock()
        transfer.semaphore.signal()
    }

    private func move(_ source: URL, to target: URL) throws {
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: target.path) {
            try? FileManager.default.removeItem(at: target)
        }
        do {
            try FileManager.default.moveItem(at: source, to: target)
        } catch {
            try FileManager.default.copyItem(at: source, to: target)
            try? FileManager.default.removeItem(at: source)
        }
    }

    private func fileSize(_ url: URL) -> Int64 {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int64 else {
            return 0
        }
        return size
    }
}

extension BackgroundDownloadSession: URLSessionDownloadDelegate {
    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let trackId = downloadTask.taskDescription ?? ""
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : nil

        lock.lock()
        let transfer = transfers[downloadTask.taskIdentifier]
        lock.unlock()

        if let transfer = transfer {
            let cancelled = transfer.events.isCancelled()
            var shouldCancel = false
            var shouldReport = false

            lock.lock()
            transfer.received = totalBytesWritten
            transfer.total = total
            if cancelled {
                transfer.cancelledByUser = true
                if !transfer.cancelRequested {
                    transfer.cancelRequested = true
                    shouldCancel = true
                }
            }
            let now = Date().timeIntervalSince1970
            if now - transfer.lastProgressAt >= 0.25 {
                transfer.lastProgressAt = now
                shouldReport = true
            }
            lock.unlock()

            if shouldReport {
                transfer.events.progress(received: totalBytesWritten, total: total)
            }
            if shouldCancel, let task = transfer.task {
                task.cancel(byProducingResumeData: { [weak self] data in
                    if let data = data, !data.isEmpty, !transfer.discardResumeData {
                        DownloadStore.saveResumeData(data, trackId: transfer.trackId)
                    }
                    self?.finish(transfer, error: nil, resumeData: transfer.discardResumeData ? nil : data)
                })
            }
        } else if !trackId.isEmpty {
            // A task restored from a previous process, before any queue entry adopted it.
            var shouldReport = false
            lock.lock()
            let now = Date().timeIntervalSince1970
            if now - (orphanProgressAt[trackId] ?? 0) >= 0.25 {
                orphanProgressAt[trackId] = now
                shouldReport = true
            }
            lock.unlock()
            if shouldReport {
                DownloadCenter.shared.backgroundProgress(trackId: trackId, received: totalBytesWritten, total: total)
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode

        lock.lock()
        let transfer = transfers[downloadTask.taskIdentifier]
        lock.unlock()

        if let transfer = transfer {
            lock.lock()
            let cancelled = transfer.cancelledByUser
            lock.unlock()
            if cancelled {
                // A task that raced its cancellation must not resurrect the file.
                return
            }
            guard let status = status, (200...299).contains(status) else {
                lock.lock()
                transfer.httpStatus = status
                lock.unlock()
                return
            }
            do {
                try move(location, to: transfer.target)
                let size = fileSize(transfer.target)
                lock.lock()
                transfer.httpStatus = status
                transfer.fileBytes = size
                transfer.finalized = size > 0
                lock.unlock()
            } catch {
                lock.lock()
                transfer.responseError = error
                lock.unlock()
            }
            return
        }

        guard let trackId = downloadTask.taskDescription, !trackId.isEmpty else { return }
        guard let status = status, (200...299).contains(status) else {
            if let status = status, status == 401 || status == 403 {
                DownloadStore.clearResumeData(trackId: trackId)
                DownloadCenter.shared.backgroundFailed(
                    trackId: trackId,
                    error: "The stored Jellyfin session was rejected (HTTP \(status)); sign in again to retry."
                )
            } else if let status = status, status == 416 {
                DownloadStore.clearResumeData(trackId: trackId)
                DownloadCenter.shared.backgroundRetrying(
                    trackId: trackId,
                    reason: "The server could not resume the partial download; restarting from the beginning."
                )
            } else if let status = status, status == 429 || (500...599).contains(status) {
                DownloadCenter.shared.backgroundRetrying(
                    trackId: trackId,
                    reason: "The server returned HTTP \(status); retrying."
                )
            } else {
                DownloadCenter.shared.backgroundFailed(trackId: trackId, error: "Download failed (HTTP \(status ?? 0)).")
            }
            return
        }
        guard let partURL = DownloadManager.shared.partFileURL(trackId: trackId) else {
            DownloadCenter.shared.backgroundFailed(trackId: trackId, error: "The track no longer exists.")
            return
        }
        do {
            try move(location, to: partURL)
            let entity = try DownloadManager.shared.finalizeBackgroundDownload(trackId: trackId, partURL: partURL)
            DownloadStore.clearResumeData(trackId: trackId)
            DownloadCenter.shared.backgroundCompleted(trackId: trackId, sizeBytes: entity.sizeBytes)
        } catch {
            DownloadCenter.shared.backgroundFailed(trackId: trackId, error: error.localizedDescription)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        var resumeData: Data?
        if let error = error {
            resumeData = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        }

        lock.lock()
        let transfer = transfers.removeValue(forKey: task.taskIdentifier)
        lock.unlock()

        if let transfer = transfer {
            if let data = resumeData, !data.isEmpty, !transfer.discardResumeData {
                DownloadStore.saveResumeData(data, trackId: transfer.trackId)
            }
            finish(transfer, error: error, resumeData: transfer.discardResumeData ? nil : resumeData)
            return
        }

        guard let trackId = task.taskDescription, !trackId.isEmpty else { return }
        lock.lock()
        orphanProgressAt.removeValue(forKey: trackId)
        lock.unlock()
        if let data = resumeData, !data.isEmpty {
            DownloadStore.saveResumeData(data, trackId: trackId)
            DownloadCenter.shared.backgroundRetrying(trackId: trackId, reason: "The download was interrupted; it will resume.")
        } else if let error = error, (error as NSError).code != NSURLErrorCancelled {
            if isRetryable(error) {
                DownloadCenter.shared.backgroundRetrying(trackId: trackId, reason: error.localizedDescription)
            } else {
                DownloadCenter.shared.backgroundFailed(trackId: trackId, error: error.localizedDescription)
            }
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let handler = self.backgroundEventsCompletionHandler
            self.backgroundEventsCompletionHandler = nil
            handler?()
        }
    }
}

/// Streaming fetch used by the opportunistic rolling cache. Pinned downloads use
/// `BackgroundDownloadSession` so they survive suspension and can resume.
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

private extension DownloadQueueEntry {
    var storeEntry: DownloadStore.PendingEntry {
        return DownloadStore.PendingEntry(
            trackId: trackId,
            state: state.rawValue,
            receivedBytes: receivedBytes,
            totalBytes: totalBytes,
            attempt: attempt,
            error: error
        )
    }

    init(storeEntry: DownloadStore.PendingEntry) {
        self.trackId = storeEntry.trackId
        self.state = DownloadQueueState(rawValue: storeEntry.state) ?? .queued
        self.receivedBytes = storeEntry.receivedBytes
        self.totalBytes = storeEntry.totalBytes
        self.attempt = storeEntry.attempt
        self.error = storeEntry.error
    }
}

final class DownloadCenter {
    static let shared = DownloadCenter()

    private let lock = NSLock()
    private var entries: [DownloadQueueEntry] = []
    private var cancelledIds: Set<String> = []
    private var runningIds: Set<String> = []
    private var restartAfterFinish: Set<String> = []
    private var listeners: [UUID: (DownloadQueueSnapshot) -> Void] = [:]
    private var lastPersistedAt: TimeInterval = 0
    private let workerQueue = DispatchQueue(label: "com.hopefulaspirationsindustries.statocyst.downloads", qos: .utility)
    private let manager = DownloadManager.shared

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

    /**
     * Rebuilds the queue from UserDefaults after launch or after the app has been
     * suspended. Only pending work is restarted; failed rows stay visible so the
     * user can retry them. Calling this repeatedly is safe: rows already live in
     * this process are left alone.
     */
    func restorePending() {
        BackgroundDownloadSession.shared.reconnect()

        var restoredIds: [String] = []
        var restoredAny = false

        lock.lock()
        for saved in DownloadStore.loadPending() where !saved.trackId.isEmpty {
            if entries.contains(where: { $0.trackId == saved.trackId }) { continue }
            var entry = DownloadQueueEntry(storeEntry: saved)
            if entry.state == .done { continue }
            if entry.state.isPending {
                // An interrupted `.active` row is pending work now, not a failure.
                entry.state = .queued
                restoredIds.append(entry.trackId)
            }
            entries.append(entry)
            restoredAny = true
        }
        if restoredAny {
            persistPendingLocked(force: true)
        }
        lock.unlock()

        if restoredAny {
            publish()
        }
        for id in restoredIds {
            workerQueue.async { [weak self] in
                self?.runOne(id)
            }
        }
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
                let previous = entries[idx]
                entries[idx] = DownloadQueueEntry(
                    trackId: id,
                    state: .queued,
                    receivedBytes: previous.receivedBytes,
                    totalBytes: previous.totalBytes,
                    attempt: 0,
                    error: nil
                )
            } else {
                entries.append(DownloadQueueEntry(trackId: id, state: .queued, receivedBytes: 0, totalBytes: nil, attempt: 0, error: nil))
            }
            cancelledIds.remove(id)
            added.append(id)
        }
        persistPendingLocked(force: true)
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
        var cancelled: [String] = []
        lock.lock()
        for entry in entries where entry.state.isPending {
            cancelledIds.insert(entry.trackId)
            cancelled.append(entry.trackId)
        }
        // Remove every pending row now. Resume data already on disk lets a later
        // enqueue continue from the partial transfer instead of starting over.
        entries.removeAll { $0.state.isPending }
        persistPendingLocked(force: true)
        lock.unlock()

        for id in cancelled {
            BackgroundDownloadSession.shared.cancel(trackId: id)
        }
        publish()
    }

    func cancel(trackId: String) {
        lock.lock()
        let wasPending = entries.contains { $0.trackId == trackId && $0.state.isPending }
        if wasPending {
            cancelledIds.insert(trackId)
        }
        entries.removeAll { $0.trackId == trackId }
        persistPendingLocked(force: true)
        lock.unlock()

        BackgroundDownloadSession.shared.cancel(trackId: trackId)
        publish()
    }

    func dismiss() {
        var cleared: [String] = []
        lock.lock()
        cleared = entries.filter { !$0.state.isPending }.map { $0.trackId }
        entries.removeAll { !$0.state.isPending }
        persistPendingLocked(force: true)
        lock.unlock()

        for id in cleared {
            DownloadStore.clearResumeData(trackId: id)
        }
        publish()
    }

    // MARK: - Completion from a background task that outlived its caller

    func backgroundProgress(trackId: String, received: Int64, total: Int64?) {
        lock.lock()
        guard let i = entries.firstIndex(where: { $0.trackId == trackId }),
              entries[i].state != .done else {
            lock.unlock()
            return
        }
        if entries[i].state == .queued || entries[i].state == .retrying || entries[i].state == .waiting {
            entries[i].state = .active
        }
        entries[i].receivedBytes = max(entries[i].receivedBytes, received)
        if let total = total {
            entries[i].totalBytes = max(entries[i].totalBytes ?? 0, total)
        }
        persistPendingLocked()
        lock.unlock()
        publish()
    }

    func backgroundRetrying(trackId: String, reason: String) {
        lock.lock()
        var changed = false
        if let i = entries.firstIndex(where: { $0.trackId == trackId }), entries[i].state != .done {
            entries[i].state = .retrying
            entries[i].error = reason
            persistPendingLocked(force: true)
            changed = true
        }
        lock.unlock()
        guard changed else { return }
        publish()
        // The task's owning process may be gone, so its retry loop is gone too.
        // Start a fresh worker with the saved resume data.
        workerQueue.async { [weak self] in
            self?.runOne(trackId)
        }
    }

    func backgroundCompleted(trackId: String, sizeBytes: Int64) {
        lock.lock()
        var changed = false
        if let i = entries.firstIndex(where: { $0.trackId == trackId }) {
            entries[i].state = .done
            entries[i].receivedBytes = sizeBytes
            entries[i].totalBytes = sizeBytes
            entries[i].attempt = 0
            entries[i].error = nil
            persistPendingLocked(force: true)
            changed = true
        }
        lock.unlock()
        DownloadStore.clearResumeData(trackId: trackId)
        if changed { publish() }
    }

    func backgroundFailed(trackId: String, error: String) {
        lock.lock()
        var changed = false
        if let i = entries.firstIndex(where: { $0.trackId == trackId }), entries[i].state != .done {
            entries[i].state = .failed
            entries[i].error = error
            persistPendingLocked(force: true)
            changed = true
        }
        lock.unlock()
        if changed { publish() }
    }

    private func runOne(_ trackId: String) {
        lock.lock()
        guard let idx = entries.firstIndex(where: { $0.trackId == trackId }) else {
            cancelledIds.remove(trackId)
            restartAfterFinish.remove(trackId)
            lock.unlock()
            return
        }
        if entries[idx].state == .done {
            restartAfterFinish.remove(trackId)
            lock.unlock()
            return
        }
        if runningIds.contains(trackId) {
            // A cancel followed by an immediate re-enqueue can schedule a new row
            // before the previous worker has observed the cancellation. Start it
            // as soon as the old worker exits rather than polling.
            restartAfterFinish.insert(trackId)
            lock.unlock()
            return
        }
        if cancelledIds.contains(trackId) {
            cancelledIds.remove(trackId)
            entries.remove(at: idx)
            persistPendingLocked(force: true)
            lock.unlock()
            publish()
            return
        }
        runningIds.insert(trackId)
        entries[idx].state = .active
        entries[idx].attempt = 0
        entries[idx].error = nil
        persistPendingLocked(force: true)
        lock.unlock()
        publish()

        let events = ClosureDownloadEvents(
            cancelledCheck: { [weak self] in
                guard let self = self else { return true }
                self.lock.lock()
                defer { self.lock.unlock() }
                return self.cancelledIds.contains(trackId)
            },
            onRetrying: { [weak self] attempt, reason in
                guard let self = self else { return }
                self.lock.lock()
                if let i = self.entries.firstIndex(where: { $0.trackId == trackId }),
                   self.entries[i].state != .done {
                    self.entries[i].state = .retrying
                    self.entries[i].attempt = attempt
                    self.entries[i].error = reason
                    self.persistPendingLocked(force: true)
                }
                self.lock.unlock()
                self.publish()
            },
            onProgress: { [weak self] received, total in
                guard let self = self else { return }
                self.lock.lock()
                if let i = self.entries.firstIndex(where: { $0.trackId == trackId }),
                   self.entries[i].state != .done {
                    if self.entries[i].state == .retrying || self.entries[i].state == .waiting {
                        self.entries[i].state = .active
                    }
                    self.entries[i].receivedBytes = max(self.entries[i].receivedBytes, received)
                    if let total = total {
                        self.entries[i].totalBytes = max(self.entries[i].totalBytes ?? 0, total)
                    }
                    self.persistPendingLocked()
                }
                self.lock.unlock()
                self.publish()
            }
        )

        var shouldRestart = false
        do {
            let outcome = try manager.download(trackId: trackId, events: events)
            DownloadStore.clearResumeData(trackId: trackId)
            lock.lock()
            runningIds.remove(trackId)
            cancelledIds.remove(trackId)
            shouldRestart = restartAfterFinish.remove(trackId) != nil
            if let i = entries.firstIndex(where: { $0.trackId == trackId }) {
                entries[i].state = .done
                entries[i].receivedBytes = outcome.entity.sizeBytes
                entries[i].totalBytes = outcome.entity.sizeBytes
                entries[i].attempt = 0
                entries[i].error = nil
            }
            persistPendingLocked(force: true)
            lock.unlock()
        } catch is DownloadCancelledError {
            lock.lock()
            runningIds.remove(trackId)
            cancelledIds.remove(trackId)
            shouldRestart = restartAfterFinish.remove(trackId) != nil
            // A cancel followed by an immediate re-enqueue leaves a fresh `.queued`
            // row behind; the old worker must not delete that new request.
            entries.removeAll { $0.trackId == trackId && $0.state != .queued }
            persistPendingLocked(force: true)
            lock.unlock()
        } catch {
            lock.lock()
            runningIds.remove(trackId)
            cancelledIds.remove(trackId)
            shouldRestart = restartAfterFinish.remove(trackId) != nil
            if let i = entries.firstIndex(where: { $0.trackId == trackId }),
               entries[i].state != .queued {
                entries[i].state = .failed
                entries[i].error = error.localizedDescription
            }
            persistPendingLocked(force: true)
            lock.unlock()
        }
        publish()
        if shouldRestart {
            workerQueue.async { [weak self] in
                self?.runOne(trackId)
            }
        }
    }

    /// Must be called while `lock` is held. Progress writes are throttled; state
    /// transitions pass `force: true` so a sudden termination cannot lose them.
    private func persistPendingLocked(force: Bool = false) {
        let now = Date().timeIntervalSince1970
        if !force && now - lastPersistedAt < 0.75 { return }
        lastPersistedAt = now
        DownloadStore.savePending(entries.filter { $0.state != .done }.map { $0.storeEntry })
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
