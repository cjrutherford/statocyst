import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

@objc(StatocystPlugin)
public class StatocystPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "StatocystPlugin"
    public let jsName = "Statocyst"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listTracks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeTrack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "libraryStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playbackUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "radio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setQuality", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipNext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipPrevious", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playEntry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setShuffle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRepeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPlaybackState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dbCount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadTrack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enqueueDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retryFailedDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDownloadQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheClear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheReconcile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prefetchTracks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importPaths", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelImport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeServerData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discoverServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncCatalog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBrowseAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBrowseAllowed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getUserState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncUserState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "validateSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initiateQuickConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pollQuickConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loginWithQuickConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "diagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthChecks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportSupportBundle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getExternalArtwork", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setExternalArtwork", returnType: CAPPluginReturnPromise)
    ]

    private let db = StatocystDatabase.shared
    private let downloads = DownloadManager()
    private let cache = MediaCache()
    private let importer = LibraryImporter()
    private let playback = PlaybackManager.shared
    private let ioQueue = DispatchQueue(label: "com.hopefulaspirationsindustries.statocyst.plugin-io", qos: .userInitiated, attributes: .concurrent)

    private var downloadQueueListenerId: UUID?
    private var wasDownloadsFinished = false
    private var importCancelled = false
    private var pendingPickerCall: CAPPluginCall?
    private var pendingPickerIsFolder = false
    private var lifecycleObserverRegistered = false

    private static let DEFAULT_CACHE_BUDGET: Int64 = 2 * 1024 * 1024 * 1024
    private static let USER_STATE_SEEDED_KEY = "statocyst.user_state_seeded"

    public override func load() {
        super.load()
        LocalMediaServer.start()

        downloadQueueListenerId = DownloadCenter.shared.addListener { [weak self] snapshot in
            guard let self = self else { return }
            let payload = self.queueSnapshotDict(snapshot)
            // The center publishes from worker and URLSession delegate threads.
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.emit("downloadQueue", payload)
                if snapshot.finished && !self.wasDownloadsFinished {
                    self.notifyCacheChanged()
                }
                self.wasDownloadsFinished = snapshot.finished
            }
        }

        if !lifecycleObserverRegistered {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleAppDidBecomeActive(_:)),
                name: UIApplication.didBecomeActiveNotification,
                object: nil
            )
            lifecycleObserverRegistered = true
        }
        // A cold launch and a return from suspension both rebuild pending work from
        // the durable queue; the background session reconnects on the same call.
        DownloadCenter.shared.restorePending()

        playback.onStateChanged = { [weak self] state in
            guard let self = self else { return }
            self.emit("playerState", self.stateDict(state))
        }
        playback.onQueueChanged = { [weak self] queue in
            guard let self = self else { return }
            self.emit("playerQueue", self.queueDict(queue))
        }
        playback.onPositionChanged = { [weak self] pos, dur in
            self?.emit("playerPosition", ["positionMs": pos, "durationMs": dur])
        }
        playback.onFavoritesChanged = { [weak self] ids in
            self?.emit("favoritesChanged", ["favorites": ids])
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        if let id = downloadQueueListenerId {
            DownloadCenter.shared.removeListener(id)
        }
    }

    @objc private func handleAppDidBecomeActive(_ notification: Notification) {
        DownloadCenter.shared.restorePending()
    }

    // MARK: - Library

    @objc func listTracks(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let all = self.db.getAllMediaItems().filter { $0.mediaKind == "music" }
            let hidden = Duplicates.hiddenToKeeper(all)
            var aliases: [String: [String]] = [:]
            for (hiddenId, keeperId) in hidden {
                aliases[keeperId, default: []].append(hiddenId)
            }
            let visible = all.filter { hidden[$0.id] == nil }.map { track -> [String: Any] in
                var dict = self.trackDict(track)
                if let trackAliases = aliases[track.id], !trackAliases.isEmpty {
                    dict["aliases"] = trackAliases
                }
                return dict
            }
            call.resolve(["tracks": visible])
        }
    }

    @objc func removeTrack(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId"), !trackId.isEmpty else {
            call.reject("trackId required")
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            if let cached = self.cache.lookup(trackId) {
                try? FileManager.default.removeItem(at: cached)
                self.db.deleteCacheEntry(trackId)
            }
            DownloadCenter.shared.cancel(trackId: trackId)
            self.downloads.remove(trackId)
            let removed = self.importer.removeTrack(trackId)
            call.resolve(["removed": removed])
        }
    }

    @objc func libraryStats(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let tracks = Duplicates.collapse(self.db.getAllMediaItems().filter { $0.mediaKind == "music" })
            let duration = tracks.reduce(Int64(0)) { $0 + $1.durationMs }
            let albums = Set(tracks.map { $0.album }).count
            let artists = Set(tracks.map { $0.artist }).count
            let missing = tracks.filter { $0.missing }.count
            call.resolve([
                "tracks": tracks.count,
                "albums": albums,
                "artists": artists,
                "durationMs": duration,
                "missing": missing
            ])
        }
    }

    // MARK: - Playback & Radio

    @objc func playbackUrl(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId"), !trackId.isEmpty else {
            call.reject("trackId required")
            return
        }
        let budget = int64Param(call, "budgetBytes") ?? Self.DEFAULT_CACHE_BUDGET
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let resolved = self.playback.resolvePlaybackURL(trackId: trackId, budgetBytes: budget)
            call.resolve([
                "url": resolved.url as Any,
                "local": resolved.isLocal
            ])
        }
    }

    @objc func radio(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId"), !trackId.isEmpty else {
            call.reject("trackId required")
            return
        }
        let limit = min(200, max(1, call.getInt("limit") ?? 50))
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            guard let result = RadioBuilder(db: self.db).build(seedId: trackId, limit: limit) else {
                call.reject("Track not found")
                return
            }
            call.resolve([
                "trackIds": result.trackIds,
                "source": result.source
            ])
        }
    }

    @objc func setQuality(_ call: CAPPluginCall) {
        let q = call.getString("quality") ?? "lossless"
        DispatchQueue.main.async { [weak self] in
            self?.playback.setQuality(q)
            call.resolve()
        }
    }

    @objc func setQueue(_ call: CAPPluginCall) {
        let rawEntries = call.getArray("entries", JSObject.self) ?? []
        let slots: [PlaybackQueueSlot] = rawEntries.compactMap { obj in
            guard let entryId = obj["entryId"] as? String,
                  let trackId = obj["trackId"] as? String else { return nil }
            return PlaybackQueueSlot(entryId: entryId, trackId: trackId)
        }
        let currentEntryId = call.getString("currentEntryId")
        let startPositionMs = int64Param(call, "startPositionMs") ?? 0
        let play = call.getBool("play") ?? false
        let keepCurrent = call.getBool("keepCurrent") ?? false
        let budget = int64Param(call, "cacheBudgetBytes")
        let quality = call.getString("quality")

        DispatchQueue.main.async { [weak self] in
            self?.playback.setQueue(
                newEntries: slots,
                currentEntryId: currentEntryId,
                startPositionMs: startPositionMs,
                playImmediately: play,
                keepCurrent: keepCurrent,
                cacheBudgetBytes: budget,
                quality: quality
            )
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playback.play()
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playback.pause()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playback.stop()
            call.resolve()
        }
    }

    @objc func skipNext(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playback.skipNext()
            call.resolve()
        }
    }

    @objc func skipPrevious(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.playback.skipPrevious()
            call.resolve()
        }
    }

    @objc func playEntry(_ call: CAPPluginCall) {
        guard let entryId = call.getString("entryId"), !entryId.isEmpty else {
            call.reject("entryId required")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.playback.playEntry(entryId: entryId) {
                call.resolve()
            } else {
                call.reject("entry not found")
            }
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let positionMs = int64Param(call, "positionMs") ?? 0
        DispatchQueue.main.async { [weak self] in
            self?.playback.seekTo(positionMs: positionMs)
            call.resolve()
        }
    }

    @objc func setShuffle(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async { [weak self] in
            self?.playback.setShuffle(enabled)
            call.resolve()
        }
    }

    @objc func setRepeat(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "off"
        DispatchQueue.main.async { [weak self] in
            self?.playback.setRepeat(mode)
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let volume = call.getFloat("volume") ?? 1.0
        let muted = call.getBool("muted") ?? false
        DispatchQueue.main.async { [weak self] in
            self?.playback.setVolume(volume: volume, muted: muted)
            call.resolve()
        }
    }

    @objc func getPlaybackState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let current = self.playback.getPlaybackState()
            call.resolve([
                "state": self.stateDict(current.state),
                "queue": self.queueDict(current.queue)
            ])
        }
    }

    @objc func dbCount(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            call.resolve(["count": self.db.mediaItemCount()])
        }
    }

    // MARK: - Downloads & Rolling Cache

    @objc func downloadTrack(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId"), !trackId.isEmpty else {
            call.reject("trackId required")
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let outcome = try self.downloads.download(trackId: trackId) { received, total, done, err in
                    self.emit("downloadProgress", [
                        "trackId": trackId,
                        "receivedBytes": received,
                        "totalBytes": total as Any,
                        "done": done,
                        "error": err as Any
                    ])
                }
                call.resolve(self.downloadSummaryDict(outcome.entity))
                self.notifyCacheChanged()
            } catch {
                self.emit("downloadProgress", [
                    "trackId": trackId,
                    "receivedBytes": 0,
                    "totalBytes": NSNull(),
                    "done": true,
                    "error": error.localizedDescription
                ])
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func enqueueDownloads(_ call: CAPPluginCall) {
        let ids = (call.getArray("trackIds", String.self) ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !ids.isEmpty else {
            call.reject("trackIds required")
            return
        }
        let added = DownloadCenter.shared.enqueue(ids)
        var res = queueSnapshotDict(DownloadCenter.shared.snapshot())
        res["added"] = added
        call.resolve(res)
    }

    @objc func cancelDownloads(_ call: CAPPluginCall) {
        DownloadCenter.shared.cancelAll()
        call.resolve(queueSnapshotDict(DownloadCenter.shared.snapshot()))
    }

    @objc func retryFailedDownloads(_ call: CAPPluginCall) {
        let retried = DownloadCenter.shared.retryFailed()
        var res = queueSnapshotDict(DownloadCenter.shared.snapshot())
        res["added"] = retried
        call.resolve(res)
    }

    @objc func dismissDownloads(_ call: CAPPluginCall) {
        DownloadCenter.shared.dismiss()
        call.resolve(queueSnapshotDict(DownloadCenter.shared.snapshot()))
    }

    @objc func getDownloadQueue(_ call: CAPPluginCall) {
        call.resolve(queueSnapshotDict(DownloadCenter.shared.snapshot()))
    }

    @objc func removeDownload(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId"), !trackId.isEmpty else {
            call.reject("trackId required")
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            DownloadCenter.shared.cancel(trackId: trackId)
            let removed = self.downloads.remove(trackId)
            call.resolve(["removed": removed])
        }
    }

    @objc func listDownloads(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let list = self.downloads.list().map { self.downloadDict($0) }
            call.resolve(["downloads": list])
        }
    }

    @objc func downloadStats(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let st = self.downloads.stats()
            call.resolve(["count": st.count, "totalBytes": st.totalBytes])
        }
    }

    @objc func cacheStats(_ call: CAPPluginCall) {
        let budget = int64Param(call, "budgetBytes") ?? Self.DEFAULT_CACHE_BUDGET
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let st = self.cache.stats(requestedBudget: budget)
            call.resolve([
                "bytes": st.bytes,
                "budgetBytes": st.budgetBytes,
                "entries": st.entries,
                "pressure": st.pressure
            ])
        }
    }

    @objc func cacheClear(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            call.resolve(["removed": self.cache.clear()])
        }
    }

    @objc func cacheReconcile(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let rec = self.cache.reconcile()
            call.resolve([
                "removedEntries": rec.removedEntries,
                "removedOrphans": rec.removedOrphans
            ])
        }
    }

    @objc func prefetchTracks(_ call: CAPPluginCall) {
        let ids = call.getArray("trackIds", String.self) ?? []
        guard !ids.isEmpty else {
            call.resolve()
            return
        }
        let budget = int64Param(call, "budgetBytes") ?? Self.DEFAULT_CACHE_BUDGET
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            for id in ids.prefix(3) {
                if self.cache.budget(requestedBudget: budget) <= 0 { break }
                self.cache.prefetch(trackId: id, requestedBudget: budget)
            }
        }
        call.resolve()
    }

    // MARK: - Local File & Folder Import

    @objc func pickFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.bridge?.viewController else {
                call.resolve(self?.emptyImportDict(cancelled: true) ?? [:])
                return
            }
            self.pendingPickerCall = call
            self.pendingPickerIsFolder = false
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio])
            picker.allowsMultipleSelection = true
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.bridge?.viewController else {
                call.resolve(self?.emptyImportDict(cancelled: true) ?? [:])
                return
            }
            self.pendingPickerCall = call
            self.pendingPickerIsFolder = true
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.allowsMultipleSelection = false
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingPickerCall else { return }
        pendingPickerCall = nil
        call.resolve(emptyImportDict(cancelled: true))
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingPickerCall else { return }
        let isFolder = pendingPickerIsFolder
        pendingPickerCall = nil
        if urls.isEmpty {
            call.resolve(emptyImportDict(cancelled: true))
            return
        }
        runImport(call: call) { progress in
            if isFolder, let folderURL = urls.first {
                return self.importer.importFolder(folderURL, onProgress: progress)
            }
            return self.importer.importURLs(urls, onProgress: progress)
        }
    }

    @objc func importPaths(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        if paths.isEmpty {
            call.resolve(emptyImportDict(cancelled: true))
            return
        }
        runImport(call: call) { progress in
            self.importer.importPaths(paths, onProgress: progress)
        }
    }

    @objc func cancelImport(_ call: CAPPluginCall) {
        importCancelled = true
        call.resolve()
    }

    private func runImport(call: CAPPluginCall, work: @escaping ((Int, Int) -> Void) -> LibraryImporter.Summary) {
        importCancelled = false
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let summary = work { scanned, imported in
                self.emit("importProgress", [
                    "phase": "importing",
                    "scanned": scanned,
                    "imported": imported
                ])
            }
            let tracks = summary.imported.map { self.trackDict($0) }
            let rejected = summary.rejected.map { item in
                [
                    "path": item.path,
                    "code": item.code,
                    "message": item.code
                ]
            }
            call.resolve([
                "sourceId": LibraryImporter.SOURCE_ID,
                "sourceLabel": LibraryImporter.SOURCE_LABEL,
                "imported": summary.imported.count,
                "duplicates": summary.duplicates,
                "missing": summary.missing,
                "rejected": rejected,
                "tracks": tracks,
                "cancelled": summary.cancelled || self.importCancelled
            ])
        }
    }

    // MARK: - Jellyfin & Sessions

    @objc func saveSession(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let userId = call.getString("userId") ?? ""
        let token = call.getString("token") ?? ""
        let rawServerId = call.getString("serverId") ?? ""
        let serverId = rawServerId.isEmpty ? url : rawServerId
        guard !url.isEmpty, !token.isEmpty else {
            call.reject("url and token required")
            return
        }
        let previousToken = JellyfinSessions.get(serverId)?.token
        JellyfinSessions.save(JellyfinSession(serverId: serverId, url: url, userId: userId, token: token))
        if let previousToken = previousToken, previousToken != token {
            // Resume blobs still carry the replaced Authorization header.
            for id in db.idsByServer(serverId) {
                DownloadStore.clearResumeData(trackId: id)
            }
        }
        call.resolve()
    }

    @objc func removeSession(_ call: CAPPluginCall) {
        if let serverId = call.getString("serverId"), !serverId.isEmpty {
            JellyfinSessions.remove(serverId)
            // Resume blobs for this server carry the removed token.
            for id in db.idsByServer(serverId) {
                DownloadStore.clearResumeData(trackId: id)
            }
        }
        call.resolve()
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        JellyfinSessions.clear()
        // Resume blobs still carry the old Authorization header.
        DownloadStore.clearAllResumeData()
        call.resolve()
    }

    @objc func removeServerData(_ call: CAPPluginCall) {
        guard let serverId = call.getString("serverId"), !serverId.isEmpty else {
            call.reject("serverId required")
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            JellyfinSessions.remove(serverId)
            var ids = self.db.idsByServer(serverId)
            if !JellyfinSessions.any() {
                ids.append(contentsOf: self.db.unattributedRemoteIds())
            }
            for id in ids {
                DownloadCenter.shared.cancel(trackId: id)
                _ = self.downloads.remove(id)
            }
            self.db.deleteMediaItemsByIds(ids)
            call.resolve(["removed": ids.count])
        }
    }

    @objc func discoverServer(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.isEmpty else {
            call.reject("url required")
            return
        }
        ioQueue.async {
            do {
                let info = try JellyfinClient.discover(baseUrl: url)
                call.resolve([
                    "id": info.id,
                    "name": info.name,
                    "version": info.version,
                    "url": info.baseUrl
                ])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func login(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let username = call.getString("username") ?? ""
        let password = call.getString("password") ?? ""
        guard !url.isEmpty, !username.isEmpty else {
            call.reject("url and username required")
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let auth = try JellyfinClient.authenticate(baseUrl: url, username: username, password: password)
                call.resolve(self.authDict(auth))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func syncCatalog(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let userId = call.getString("userId") ?? ""
        let token = call.getString("token") ?? ""
        let rawServerId = call.getString("serverId") ?? ""
        let serverId = rawServerId.isEmpty ? url : rawServerId
        let rawServerName = (call.getString("serverName") ?? "").trimmingCharacters(in: .whitespaces)
        let serverName = rawServerName.isEmpty ? "Jellyfin" : rawServerName
        guard !url.isEmpty, !userId.isEmpty, !token.isEmpty else {
            call.reject("url, userId, and token required")
            return
        }

        ioQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                var imported = 0
                var startIndex = 0
                let pageSize = 200
                var total = 0
                var seen: Set<String> = []
                repeat {
                    let (items, totalCount) = try JellyfinClient.listAudioItems(
                        baseUrl: url,
                        userId: userId,
                        token: token,
                        startIndex: startIndex,
                        limit: pageSize
                    )
                    total = totalCount
                    if items.isEmpty { break }
                    for item in items {
                        let entity = self.scopedToServer(self.jellyfinEntity(item: item, serverId: serverId, serverName: serverName))
                        self.db.upsertMediaItem(entity)
                        seen.insert(entity.id)
                        imported += 1
                    }
                    startIndex += items.count
                } while startIndex < total

                var removed = 0
                if !seen.isEmpty && startIndex >= total {
                    let gone = self.db.idsByServer(serverId).filter { !seen.contains($0) }
                    for id in gone {
                        DownloadCenter.shared.cancel(trackId: id)
                        _ = self.downloads.remove(id)
                        if let cached = self.cache.lookup(id) {
                            try? FileManager.default.removeItem(at: cached)
                            self.db.deleteCacheEntry(id)
                        }
                    }
                    self.db.deleteMediaItemsByIds(gone)
                    removed = gone.count
                }
                call.resolve([
                    "imported": imported,
                    "total": total,
                    "removed": removed
                ])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func validateSession(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let token = call.getString("token") ?? ""
        guard !url.isEmpty, !token.isEmpty else {
            call.reject("url and token required")
            return
        }
        let serverId = call.getString("serverId") ?? ""
        let explicitItemId = call.getString("itemId")

        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let itemId: String?
            if let explicit = explicitItemId, !explicit.isEmpty {
                itemId = explicit
            } else {
                let remote = self.db.getAllMediaItems().filter { $0.sourceKind == "jellyfin" }
                let match = remote.first(where: { !serverId.isEmpty && $0.serverId == serverId })
                    ?? remote.first(where: { $0.serverId.isEmpty })
                if let m = match {
                    itemId = m.path.isEmpty ? String(m.id.dropFirst(m.id.hasPrefix("jf-") ? 3 : 0)) : m.path
                } else {
                    itemId = nil
                }
            }
            guard let validItemId = itemId else {
                call.resolve(["valid": NSNull()])
                return
            }
            let valid = JellyfinClient.probeStream(baseUrl: url, itemId: validItemId, token: token)
            call.resolve([
                "valid": valid,
                "itemId": validItemId
            ])
        }
    }

    @objc func initiateQuickConnect(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.isEmpty else {
            call.reject("url required")
            return
        }
        ioQueue.async {
            do {
                let initRes = try JellyfinClient.initiateQuickConnect(baseUrl: url)
                call.resolve([
                    "secret": initRes.secret,
                    "code": initRes.code
                ])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func pollQuickConnect(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let secret = call.getString("secret") ?? ""
        guard !url.isEmpty, !secret.isEmpty else {
            call.reject("url and secret required")
            return
        }
        ioQueue.async {
            let authenticated = JellyfinClient.quickConnectStatus(baseUrl: url, secret: secret)
            call.resolve(["authenticated": authenticated])
        }
    }

    @objc func loginWithQuickConnect(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let secret = call.getString("secret") ?? ""
        guard !url.isEmpty, !secret.isEmpty else {
            call.reject("url and secret required")
            return
        }
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let auth = try JellyfinClient.authenticateWithQuickConnect(baseUrl: url, secret: secret)
                call.resolve(self.authDict(auth))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - User State & Browse Access

    @objc func getBrowseAccess(_ call: CAPPluginCall) {
        call.resolve([
            "allowed": [String](),
            "denied": [String]()
        ])
    }

    @objc func setBrowseAllowed(_ call: CAPPluginCall) {
        call.resolve([
            "allowed": [String](),
            "denied": [String]()
        ])
    }

    @objc func getUserState(_ call: CAPPluginCall) {
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let seeded = UserDefaults.standard.bool(forKey: Self.USER_STATE_SEEDED_KEY)
            let favorites = self.db.getFavorites().map { $0.trackId }
            call.resolve([
                "seeded": seeded,
                "favorites": favorites
            ])
        }
    }

    @objc func syncUserState(_ call: CAPPluginCall) {
        let favorites = call.getArray("favorites", String.self) ?? []
        let rawPlaylists = call.getArray("playlists", JSObject.self) ?? []
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let favRows = favorites.enumerated().map { FavoriteEntity(trackId: $0.element, position: $0.offset) }
            var plRows: [PlaylistEntity] = []
            var ptRows: [PlaylistTrackEntity] = []

            for (i, obj) in rawPlaylists.enumerated() {
                guard let id = obj["id"] as? String, !id.isEmpty else { continue }
                let name = (obj["name"] as? String) ?? "Playlist"
                let createdAt = (obj["createdAt"] as? NSNumber)?.int64Value ?? 0
                plRows.append(PlaylistEntity(id: id, name: name, createdAt: createdAt, position: i))
                if let trackIds = obj["trackIds"] as? [String] {
                    for (j, tid) in trackIds.enumerated() {
                        ptRows.append(PlaylistTrackEntity(playlistId: id, position: j, trackId: tid))
                    }
                }
            }
            self.db.replaceUserState(favorites: favRows, playlists: plRows, playlistTracks: ptRows)
            UserDefaults.standard.set(true, forKey: Self.USER_STATE_SEEDED_KEY)
            call.resolve([
                "favorites": favRows.count,
                "playlists": plRows.count
            ])
        }
    }

    // MARK: - Diagnostics & External Artwork

    @objc func appInfo(_ call: CAPPluginCall) {
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.9.0"
        let buildNumber = Int((Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "27") ?? 27
        let systemVersion = UIDevice.current.systemVersion
        let deviceModel = UIDevice.current.model
        call.resolve([
            "name": "Statocyst",
            "version": version,
            "versionCode": buildNumber,
            "platform": "ios",
            "ios": systemVersion,
            "device": "Apple \(deviceModel)",
            "dataPath": StatocystDatabase.appDataDirectory().path
        ])
    }

    @objc func diagnostics(_ call: CAPPluginCall) {
        let budget = int64Param(call, "budgetBytes") ?? Self.DEFAULT_CACHE_BUDGET
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let snap = Diagnostics.snapshot(db: self.db, cache: self.cache, cacheBudgetBytes: budget)
            call.resolve([
                "databasePath": snap.databasePath,
                "logPath": snap.logPath,
                "databaseBytes": snap.databaseBytes,
                "cacheBytes": snap.cacheBytes,
                "schemaVersion": snap.schemaVersion,
                "integrity": snap.integrity,
                "queueEntries": snap.queueEntries,
                "trackCount": snap.trackCount
            ])
        }
    }

    @objc func healthChecks(_ call: CAPPluginCall) {
        let budget = int64Param(call, "budgetBytes") ?? Self.DEFAULT_CACHE_BUDGET
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            let checks = Diagnostics.health(db: self.db, cache: self.cache, downloads: self.downloads, cacheBudgetBytes: budget)
            let list = checks.map { c in
                [
                    "id": c.id,
                    "label": c.label,
                    "status": c.status,
                    "detail": c.detail
                ]
            }
            call.resolve(["checks": list])
        }
    }

    @objc func exportSupportBundle(_ call: CAPPluginCall) {
        let budget = int64Param(call, "budgetBytes") ?? Self.DEFAULT_CACHE_BUDGET
        ioQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let fileURL = try SupportBundle(db: self.db, downloads: self.downloads, cache: self.cache)
                    .write(cacheBudgetBytes: budget)
                let bytes = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int64) ?? 0
                self.shareFile(fileURL)
                call.resolve([
                    "path": fileURL.path,
                    "bytes": bytes
                ])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func getExternalArtwork(_ call: CAPPluginCall) {
        call.resolve(["enabled": ExternalArt.enabled()])
    }

    @objc func setExternalArtwork(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        ExternalArt.setEnabled(enabled)
        call.resolve(["enabled": enabled])
    }

    // MARK: - Formatting & Helpers

    private func int64Param(_ call: CAPPluginCall, _ key: String) -> Int64? {
        if let val = call.options[key] as? NSNumber {
            return val.int64Value
        }
        if let str = call.getString(key), let v = Int64(str) {
            return v
        }
        return nil
    }

    private func emit(_ event: String, _ payload: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners(event, data: payload)
        }
    }

    private func notifyCacheChanged() {
        emit("cacheChanged", [:])
    }

    private func shareFile(_ fileURL: URL) {
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else { return }
            let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            if let popover = activity.popoverPresentationController {
                popover.sourceView = vc.view
                popover.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            vc.present(activity, animated: true)
        }
    }

    private func stateDict(_ s: PlaybackStatePayload) -> [String: Any] {
        return [
            "state": s.state,
            "entryId": s.entryId as Any,
            "trackId": s.trackId as Any,
            "positionMs": s.positionMs,
            "durationMs": s.durationMs,
            "shuffle": s.shuffle,
            "repeat": s.repeatMode,
            "error": s.error as Any
        ]
    }

    private func queueDict(_ q: PlaybackQueuePayload) -> [String: Any] {
        let entries = q.entries.map { ["entryId": $0.entryId, "trackId": $0.trackId] }
        return [
            "entries": entries,
            "currentEntryId": q.currentEntryId as Any
        ]
    }

    private func queueSnapshotDict(_ snap: DownloadQueueSnapshot) -> [String: Any] {
        let entries = snap.entries.map { e -> [String: Any] in
            [
                "trackId": e.trackId,
                "state": e.state.rawValue,
                "receivedBytes": e.receivedBytes,
                "totalBytes": e.totalBytes as Any,
                "attempt": e.attempt,
                "error": e.error as Any
            ]
        }
        return [
            "total": snap.total,
            "done": snap.done,
            "failed": snap.failed,
            "pending": snap.pending,
            "finished": snap.finished,
            "receivedBytes": snap.receivedBytes,
            "totalBytes": snap.totalBytes as Any,
            "sizesKnown": snap.sizesKnown,
            "entries": entries
        ]
    }

    private func trackDict(_ t: MediaItemEntity) -> [String: Any] {
        return [
            "id": t.id,
            "title": t.title,
            "artist": t.artist,
            "album": t.album,
            "albumArtist": t.albumArtist as Any,
            "durationMs": t.durationMs,
            "sourceKind": t.sourceKind,
            "sourceLabel": t.sourceLabel,
            "sourceId": t.sourceId,
            "trackNo": t.trackNo as Any,
            "year": t.year as Any,
            "genre": t.genre as Any,
            "format": t.format as Any,
            "sizeBytes": t.sizeBytes,
            "bitrate": t.bitrate as Any,
            "jellyfinImageTag": t.jellyfinImageTag as Any,
            "albumId": t.albumId as Any,
            "mediaKind": t.mediaKind,
            "artworkUrl": artworkFor(t) as Any,
            "artistArtworkUrl": NSNull(),
            "missing": t.missing
        ]
    }

    private func artworkFor(_ t: MediaItemEntity) -> String? {
        guard t.sourceKind.hasPrefix("jellyfin") else { return nil }
        let itemId = (t.albumId?.isEmpty == false) ? t.albumId! : String(t.id.dropFirst(t.id.hasPrefix("jf-") ? 3 : 0))
        let tag = (t.albumId?.isEmpty == false) ? (t.jellyfinImageTag ?? "") : ""
        return LocalMediaServer.artUri(itemId: itemId, tag: tag)
    }

    private func downloadDict(_ d: DownloadEntity) -> [String: Any] {
        return [
            "trackId": d.trackId,
            "localPath": d.localPath,
            "sizeBytes": d.sizeBytes,
            "sha256": d.sha256,
            "container": d.container as Any,
            "verified": d.verified,
            "createdAt": d.createdAt
        ]
    }

    private func downloadSummaryDict(_ d: DownloadEntity) -> [String: Any] {
        return [
            "trackId": d.trackId,
            "sizeBytes": d.sizeBytes,
            "sha256": d.sha256,
            "verified": d.verified
        ]
    }

    private func authDict(_ auth: JellyfinAuthResult) -> [String: Any] {
        return [
            "serverId": auth.serverId,
            "userId": auth.userId,
            "userName": auth.userName,
            "accessToken": auth.accessToken
        ]
    }

    private func emptyImportDict(cancelled: Bool) -> [String: Any] {
        return [
            "sourceId": NSNull(),
            "sourceLabel": NSNull(),
            "imported": 0,
            "duplicates": 0,
            "missing": 0,
            "rejected": [[String: Any]](),
            "tracks": [[String: Any]](),
            "cancelled": cancelled
        ]
    }

    private func scopedToServer(_ entity: MediaItemEntity) -> MediaItemEntity {
        let itemId = entity.path
        var hash: UInt32 = 0
        for byte in entity.serverId.utf8 {
            hash = hash &* 31 &+ UInt32(byte)
        }
        let tag = String(hash, radix: 16)
        var scoped = entity
        scoped.id = "jf-\(tag)-\(itemId)"
        scoped.pathKey = "jellyfin:\(tag):\(itemId)"
        let plain = db.getMediaItemById(entity.id)
        let ownedByOther = plain != nil && !plain!.serverId.isEmpty && plain!.serverId != entity.serverId
        if ownedByOther || db.getMediaItemById(scoped.id) != nil {
            return scoped
        }
        return entity
    }

    private func jellyfinEntity(item: [String: Any], serverId: String, serverName: String) -> MediaItemEntity {
        let sources = item["MediaSources"] as? [[String: Any]]
        let source = sources?.first
        let now = ISO8601DateFormatter().string(from: Date())
        let id = (item["Id"] as? String) ?? ""
        let name = (item["Name"] as? String) ?? "Untitled"
        let artists = item["Artists"] as? [String]
        let albumArtist = (item["AlbumArtist"] as? String) ?? "Unknown artist"
        let artist = artists?.first ?? albumArtist
        let album = (item["Album"] as? String) ?? "Unknown album"
        let container = (source?["Container"] as? String) ?? "audio"
        let codec = source?["Codec"] as? String
        let bitrate = (source?["Bitrate"] as? Int).flatMap { $0 > 0 ? $0 : nil }
        let sizeBytes = (source?["Size"] as? NSNumber)?.int64Value ?? 0
        let ticks = (item["RunTimeTicks"] as? NSNumber)?.int64Value ?? 0
        let durationMs = ticks / 10_000
        let genres = (item["Genres"] as? [String])?.joined(separator: ", ")
        let imageTags = item["ImageTags"] as? [String: Any]
        let primaryTag = (item["AlbumPrimaryImageTag"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (imageTags?["Primary"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let albumId = (item["AlbumId"] as? String).flatMap { $0.isEmpty ? nil : $0 }

        return MediaItemEntity(
            id: "jf-\(id)",
            sourceId: "jellyfin",
            path: id,
            pathKey: "jellyfin:\(id)",
            fileName: name,
            ext: container,
            sizeBytes: sizeBytes,
            mtimeMs: 0,
            title: name,
            artist: artist,
            album: album,
            albumArtist: albumArtist,
            trackNo: item["IndexNumber"] as? Int,
            discNo: item["ParentIndexNumber"] as? Int,
            year: item["ProductionYear"] as? Int,
            genre: genres,
            durationMs: durationMs,
            bitrate: bitrate,
            sampleRate: nil,
            channels: nil,
            codec: codec,
            format: container,
            artworkPath: nil,
            jellyfinImageTag: primaryTag,
            sourceKind: "jellyfin",
            sourceLabel: serverName,
            addedAt: now,
            updatedAt: now,
            missing: false,
            albumId: albumId,
            serverId: serverId
        )
    }
}
