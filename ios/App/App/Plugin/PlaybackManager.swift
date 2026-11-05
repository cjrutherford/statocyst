import Foundation
import AVFoundation
import MediaPlayer
import UIKit

struct PlaybackQueueSlot: Codable, Equatable {
    let entryId: String
    let trackId: String
}

struct PlaybackStatePayload {
    var state: String
    var entryId: String?
    var trackId: String?
    var positionMs: Int64
    var durationMs: Int64
    var shuffle: Bool
    var repeatMode: String
    var error: String?
}

struct PlaybackQueuePayload {
    var entries: [PlaybackQueueSlot]
    var currentEntryId: String?
}

/**
 * Authoritative native audio engine for iOS.
 *
 * Uses AVPlayer + AVAudioSession (.playback) so audio continues when the screen
 * locks or the app is backgrounded, and bridges Lock Screen / Control Center /
 * CarPlay transport controls via MPNowPlayingInfoCenter and MPRemoteCommandCenter.
 */
final class PlaybackManager: NSObject {
    static let shared = PlaybackManager()

    var onStateChanged: ((PlaybackStatePayload) -> Void)?
    var onQueueChanged: ((PlaybackQueuePayload) -> Void)?
    var onPositionChanged: ((Int64, Int64) -> Void)?
    var onFavoritesChanged: (([String]) -> Void)?

    private let db = StatocystDatabase.shared
    private let downloads = DownloadManager()
    private let cache = MediaCache()

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?

    private var entries: [PlaybackQueueSlot] = []
    private var currentIndex: Int = -1
    private var shuffleEnabled: Bool = false
    private var repeatMode: String = "off" // "off" | "all" | "one"
    private var currentError: String? = nil
    private var desiredPlay: Bool = false
    private var qualityPreference: String = "lossless"
    private var cacheBudgetBytes: Int64 = 2 * 1024 * 1024 * 1024

    private static let QUEUE_PREF_KEY = "statocyst.native_playback_queue"

    private override init() {
        super.init()
        configureAudioSession()
        configureRemoteCommandCenter()
        configurePlayerObservers()
        restorePersistedQueue()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            // Simulator or restricted environment; playback still proceeds when allowed.
        }
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeVal = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeVal) else {
            return
        }
        switch type {
        case .began:
            desiredPlay = false
            player.pause()
            emitState()
        case .ended:
            if let optVal = info[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optVal)
                if options.contains(.shouldResume) {
                    play()
                }
            }
        @unknown default:
            break
        }
    }

    private func configureRemoteCommandCenter() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.play()
            return .success
        }

        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.pause()
            return .success
        }

        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            if self.desiredPlay {
                self.pause()
            } else {
                self.play()
            }
            return .success
        }

        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.skipNext()
            return .success
        }

        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.skipPrevious()
            return .success
        }

        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self = self,
                  let posEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self.seekTo(positionMs: Int64((posEvent.positionTime * 1000.0).rounded()))
            return .success
        }

        center.likeCommand.isEnabled = true
        center.likeCommand.addTarget { [weak self] _ in
            guard let self = self, let slot = self.currentSlot else { return .noActionableNowPlayingItem }
            let updated = self.db.toggleFavorite(slot.trackId)
            self.updateNowPlayingMetadata()
            self.onFavoritesChanged?(updated)
            return .success
        }
    }

    private func configurePlayerObservers() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            if self.desiredPlay || self.player.timeControlStatus == .playing {
                self.onPositionChanged?(self.currentPositionMs(), self.currentDurationMs())
                self.updateNowPlayingElapsed()
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.emitState()
            }
        }
    }

    // MARK: - Queue & Transport

    private var currentSlot: PlaybackQueueSlot? {
        guard currentIndex >= 0 && currentIndex < entries.count else { return nil }
        return entries[currentIndex]
    }

    func setQuality(_ quality: String) {
        qualityPreference = (quality == "auto") ? "auto" : "lossless"
    }

    func setQueue(
        newEntries: [PlaybackQueueSlot],
        currentEntryId: String?,
        startPositionMs: Int64,
        playImmediately: Bool,
        keepCurrent: Bool,
        cacheBudgetBytes: Int64?,
        quality: String?
    ) {
        if let q = quality { setQuality(q) }
        if let b = cacheBudgetBytes, b > 0 { self.cacheBudgetBytes = b }

        let targetIdx = newEntries.firstIndex(where: { $0.entryId == currentEntryId })
        let playingEntryId = currentSlot?.entryId

        if keepCurrent,
           let playingEntryId = playingEntryId,
           playingEntryId == currentEntryId,
           let targetIdx = targetIdx {
            self.entries = newEntries
            self.currentIndex = targetIdx
            persistQueue()
            emitQueue()
            emitState()
            return
        }

        if newEntries.isEmpty {
            stop()
            return
        }

        self.entries = newEntries
        self.currentIndex = targetIdx ?? 0
        persistQueue()
        loadCurrentItem(startPositionMs: startPositionMs, autoplay: playImmediately)
        emitQueue()
    }

    func play() {
        if entries.isEmpty { return }
        if currentIndex < 0 || currentIndex >= entries.count {
            currentIndex = 0
        }
        if player.currentItem == nil {
            loadCurrentItem(startPositionMs: 0, autoplay: true)
            return
        }
        if currentStateName() == "ended" {
            player.seek(to: .zero)
        }
        try? AVAudioSession.sharedInstance().setActive(true)
        desiredPlay = true
        player.play()
        emitState()
    }

    func pause() {
        desiredPlay = false
        player.pause()
        emitState()
    }

    func stop() {
        desiredPlay = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        entries.removeAll()
        currentIndex = -1
        currentError = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        persistQueue()
        emitQueue()
        emitState()
    }

    func skipNext() {
        guard !entries.isEmpty else { return }
        if shuffleEnabled && entries.count > 1 {
            let candidates = entries.indices.filter { $0 != currentIndex }
            currentIndex = candidates.randomElement() ?? ((currentIndex + 1) % entries.count)
        } else if currentIndex + 1 < entries.count {
            currentIndex += 1
        } else {
            currentIndex = 0
        }
        persistQueue()
        loadCurrentItem(startPositionMs: 0, autoplay: true)
        emitQueue()
    }

    func skipPrevious() {
        guard !entries.isEmpty else { return }
        if currentPositionMs() > 3_000 {
            seekTo(positionMs: 0)
            if !desiredPlay { play() }
            return
        }
        if currentIndex > 0 {
            currentIndex -= 1
        } else if repeatMode == "all" {
            currentIndex = entries.count - 1
        } else {
            currentIndex = 0
        }
        persistQueue()
        loadCurrentItem(startPositionMs: 0, autoplay: true)
        emitQueue()
    }

    @discardableResult
    func playEntry(entryId: String) -> Bool {
        guard let idx = entries.firstIndex(where: { $0.entryId == entryId }) else { return false }
        currentIndex = idx
        persistQueue()
        loadCurrentItem(startPositionMs: 0, autoplay: true)
        emitQueue()
        return true
    }

    func seekTo(positionMs: Int64) {
        let clamped = max(0, positionMs)
        let target = CMTime(value: clamped, timescale: 1000)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            guard let self = self else { return }
            self.onPositionChanged?(self.currentPositionMs(), self.currentDurationMs())
            self.updateNowPlayingElapsed()
            self.emitState()
        }
    }

    func setShuffle(_ enabled: Bool) {
        shuffleEnabled = enabled
        persistQueue()
        emitState()
    }

    func setRepeat(_ mode: String) {
        switch mode {
        case "all", "one": repeatMode = mode
        default: repeatMode = "off"
        }
        persistQueue()
        emitState()
    }

    func setVolume(volume: Float, muted: Bool) {
        let clamped = max(0.0, min(1.0, volume))
        player.volume = muted ? 0.0 : clamped
        player.isMuted = muted
    }

    func getPlaybackState() -> (state: PlaybackStatePayload, queue: PlaybackQueuePayload) {
        return (currentStatePayload(), currentQueuePayload())
    }

    // MARK: - Item Resolution & Loading

    func resolvePlaybackURL(trackId: String, budgetBytes: Int64) -> (url: String?, isLocal: Bool) {
        let track = db.getMediaItemById(trackId)
        if let dlFile = downloads.verifiedFile(trackId), let uri = LocalMediaServer.localUri(for: dlFile) {
            return (uri, true)
        }
        if let cacheFile = cache.lookup(trackId), let uri = LocalMediaServer.localUri(for: cacheFile) {
            return (uri, true)
        }
        guard let track = track else { return (nil, false) }

        if track.sourceKind.hasPrefix("jellyfin") {
            let alternates = Duplicates.alternatesOf(track, candidates: db.jellyfinByTitle(track.title))
            for alt in alternates {
                if let f = downloads.verifiedFile(alt.id) ?? cache.lookup(alt.id),
                   let uri = LocalMediaServer.localUri(for: f) {
                    return (uri, true)
                }
            }
            guard let session = JellyfinSessions.forTrack(track) else { return (nil, false) }
            let itemId = track.path.isEmpty ? String(track.id.dropFirst(track.id.hasPrefix("jf-") ? 3 : 0)) : track.path
            let url = JellyfinAuth.streamUrl(serverUrl: session.url, itemId: itemId)
            if budgetBytes > 0 {
                DispatchQueue.global(qos: .utility).async { [weak self] in
                    self?.cache.prefetch(trackId: trackId, requestedBudget: budgetBytes)
                }
            }
            return (url, false)
        } else {
            let fileURL = URL(fileURLWithPath: track.path)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue else {
                return (nil, false)
            }
            return (LocalMediaServer.localUri(for: fileURL), true)
        }
    }

    private func loadCurrentItem(startPositionMs: Int64, autoplay: Bool) {
        currentError = nil
        if let endObserver = endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        statusObservation?.invalidate()
        statusObservation = nil

        guard let slot = currentSlot else {
            player.replaceCurrentItem(with: nil)
            emitState()
            return
        }

        let track = db.getMediaItemById(slot.trackId)
        let resolved = resolvePlaybackURL(trackId: slot.trackId, budgetBytes: cacheBudgetBytes)
        guard let urlString = resolved.url, let url = URL(string: urlString) else {
            currentError = "MEDIA_UNAVAILABLE"
            desiredPlay = false
            player.replaceCurrentItem(with: nil)
            emitState()
            return
        }

        let asset: AVURLAsset
        if !resolved.isLocal, let track = track, let session = JellyfinSessions.forTrack(track) {
            let headers = ["Authorization": JellyfinAuth.header(token: session.token)]
            asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        } else {
            asset = AVURLAsset(url: url)
        }

        let item = AVPlayerItem(asset: asset)
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] observedItem, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if observedItem.status == .failed {
                    self.currentError = observedItem.error?.localizedDescription ?? "PLAYER_ERROR"
                    self.desiredPlay = false
                }
                self.updateNowPlayingMetadata()
                self.emitState()
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.handleItemEnded()
        }

        desiredPlay = autoplay
        player.replaceCurrentItem(with: item)
        if startPositionMs > 0 {
            let target = CMTime(value: startPositionMs, timescale: 1000)
            player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
        }
        if autoplay {
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
        } else {
            player.pause()
        }
        updateNowPlayingMetadata()
        emitState()
        prefetchNeighbors()
    }

    private func handleItemEnded() {
        if repeatMode == "one" {
            player.seek(to: .zero)
            player.play()
            emitState()
            return
        }
        if shuffleEnabled && entries.count > 1 {
            let candidates = entries.indices.filter { $0 != currentIndex }
            currentIndex = candidates.randomElement() ?? 0
            persistQueue()
            loadCurrentItem(startPositionMs: 0, autoplay: true)
            emitQueue()
            return
        }
        if currentIndex + 1 < entries.count {
            currentIndex += 1
            persistQueue()
            loadCurrentItem(startPositionMs: 0, autoplay: true)
            emitQueue()
        } else if repeatMode == "all" && !entries.isEmpty {
            currentIndex = 0
            persistQueue()
            loadCurrentItem(startPositionMs: 0, autoplay: true)
            emitQueue()
        } else {
            desiredPlay = false
            emitState()
        }
    }

    private func prefetchNeighbors() {
        guard cacheBudgetBytes > 0, currentIndex >= 0 else { return }
        let nextIndices = (1...2).map { currentIndex + $0 }.filter { $0 < entries.count }
        let nextIds = nextIndices.map { entries[$0].trackId }
        guard !nextIds.isEmpty else { return }
        let budget = cacheBudgetBytes
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            for id in nextIds {
                if self.cache.budget(requestedBudget: budget) <= 0 { break }
                self.cache.prefetch(trackId: id, requestedBudget: budget)
            }
        }
    }

    // MARK: - State & Metadata Helpers

    private func currentPositionMs() -> Int64 {
        let sec = CMTimeGetSeconds(player.currentTime())
        guard sec.isFinite && sec > 0 else { return 0 }
        return Int64((sec * 1000.0).rounded())
    }

    private func currentDurationMs() -> Int64 {
        if let item = player.currentItem {
            let sec = CMTimeGetSeconds(item.duration)
            if sec.isFinite && sec > 0 {
                return Int64((sec * 1000.0).rounded())
            }
        }
        if let slot = currentSlot, let track = db.getMediaItemById(slot.trackId) {
            return track.durationMs
        }
        return 0
    }

    private func currentStateName() -> String {
        if currentError != nil { return "error" }
        if entries.isEmpty || currentSlot == nil { return "idle" }
        if let item = player.currentItem {
            let pos = currentPositionMs()
            let dur = currentDurationMs()
            if !desiredPlay && dur > 0 && pos >= dur - 200 {
                return "ended"
            }
            if item.status == .failed {
                return "error"
            }
        }
        switch player.timeControlStatus {
        case .playing:
            return "playing"
        case .waitingToPlayAtSpecifiedRate:
            return desiredPlay ? "buffering" : "paused"
        case .paused:
            return desiredPlay ? "buffering" : "paused"
        @unknown default:
            return "paused"
        }
    }

    private func currentStatePayload() -> PlaybackStatePayload {
        let slot = currentSlot
        return PlaybackStatePayload(
            state: currentStateName(),
            entryId: slot?.entryId,
            trackId: slot?.trackId,
            positionMs: currentPositionMs(),
            durationMs: currentDurationMs(),
            shuffle: shuffleEnabled,
            repeatMode: repeatMode,
            error: currentError
        )
    }

    private func currentQueuePayload() -> PlaybackQueuePayload {
        return PlaybackQueuePayload(
            entries: entries,
            currentEntryId: currentSlot?.entryId
        )
    }

    private func emitState() {
        onStateChanged?(currentStatePayload())
        updateNowPlayingElapsed()
    }

    private func emitQueue() {
        onQueueChanged?(currentQueuePayload())
    }

    private func updateNowPlayingMetadata() {
        guard let slot = currentSlot, let track = db.getMediaItemById(slot.trackId) else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyAlbumTitle: track.album,
            MPMediaItemPropertyPlaybackDuration: Double(max(currentDurationMs(), track.durationMs)) / 1000.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(currentPositionMs()) / 1000.0,
            MPNowPlayingInfoPropertyPlaybackRate: desiredPlay ? 1.0 : 0.0
        ]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPRemoteCommandCenter.shared().likeCommand.isActive = db.isFavorite(track.id)

        if track.sourceKind.hasPrefix("jellyfin") {
            let itemId = (track.albumId?.isEmpty == false) ? track.albumId! : String(track.id.dropFirst(track.id.hasPrefix("jf-") ? 3 : 0))
            let tag = (track.albumId?.isEmpty == false) ? (track.jellyfinImageTag ?? "") : ""
            DispatchQueue.global(qos: .utility).async {
                guard let imgURL = JellyfinArtwork.fetch(itemId: itemId, tag: tag, height: 600, serverId: track.serverId),
                      let data = try? Data(contentsOf: imgURL),
                      let image = UIImage(data: data) else { return }
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                DispatchQueue.main.async {
                    if var currentInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                        currentInfo[MPMediaItemPropertyArtwork] = artwork
                        MPNowPlayingInfoCenter.default().nowPlayingInfo = currentInfo
                    } else {
                        info[MPMediaItemPropertyArtwork] = artwork
                        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
                    }
                }
            }
        }
    }

    private func updateNowPlayingElapsed() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(currentPositionMs()) / 1000.0
        info[MPNowPlayingInfoPropertyPlaybackRate] = (currentStateName() == "playing") ? 1.0 : 0.0
        let dur = currentDurationMs()
        if dur > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = Double(dur) / 1000.0
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Queue Persistence

    private struct PersistedQueueState: Codable {
        let entries: [PlaybackQueueSlot]
        let currentIndex: Int
        let shuffle: Bool
        let repeatMode: String
    }

    private func persistQueue() {
        let state = PersistedQueueState(
            entries: entries,
            currentIndex: currentIndex,
            shuffle: shuffleEnabled,
            repeatMode: repeatMode
        )
        if let data = try? JSONEncoder().encode(state),
           let str = String(data: data, encoding: .utf8) {
            UserDefaults.standard.set(str, forKey: Self.QUEUE_PREF_KEY)
        }
    }

    private func restorePersistedQueue() {
        guard let str = UserDefaults.standard.string(forKey: Self.QUEUE_PREF_KEY),
              let data = str.data(using: .utf8),
              let saved = try? JSONDecoder().decode(PersistedQueueState.self, from: data) else {
            return
        }
        entries = saved.entries
        currentIndex = saved.currentIndex
        shuffleEnabled = saved.shuffle
        repeatMode = saved.repeatMode
    }
}
