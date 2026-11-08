import Foundation
import AVFoundation
import MediaPlayer
import Network
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
    private var currentErrorIsNetwork: Bool = false
    private var desiredPlay: Bool = false
    private var qualityPreference: String = "lossless"
    private var cacheBudgetBytes: Int64 = 2 * 1024 * 1024 * 1024
    private var playbackRate: Double = 1.0
    private var lastPodcastResumeWriteMs: Int64 = 0

    private let networkMonitor = NWPathMonitor()
    private let networkMonitorQueue = DispatchQueue(label: "com.hopefulaspirationsindustries.statocyst.network")
    private var networkAvailable: Bool = true
    private var networkInterface: NWInterface.InterfaceType?
    private var isRecovering: Bool = false
    private var recoveryAttempt: Int = 0
    private var recoveryWorkItem: DispatchWorkItem?
    private var recoveryPositionMs: Int64 = 0
    private var currentUsesTranscode: Bool = false
    private var currentIsLocal: Bool = false
    private var stallWorkItem: DispatchWorkItem?

    private static let QUEUE_PREF_KEY = "statocyst.native_playback_queue"
    private static let QUALITY_PREF_KEY = "statocyst.playback_quality"
    private static let RECOVERY_BACKOFF_SECONDS: [TimeInterval] = [2, 5, 10, 20, 30, 30, 30, 30]
    private static let RECOVERY_WATCHDOG_SECONDS: TimeInterval = 15
    private static let TRANSCODE_START_MS: Int64 = 5_000
    private static let STALL_SECONDS: TimeInterval = 6
    private static let TRANSCODE_BITS_PER_SECOND: Int64 = 192_000

    private override init() {
        super.init()
        qualityPreference = UserDefaults.standard.string(forKey: Self.QUALITY_PREF_KEY) == "auto" ? "auto" : "lossless"
        configureAudioSession()
        configureRemoteCommandCenter()
        configurePlayerObservers()
        configureNetworkMonitor()
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
            endRecovery()
            endStallWatch()
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
            if self.player.timeControlStatus == .playing {
                self.recoveryPositionMs = self.currentPositionMs()
                self.persistPodcastResumeIfNeeded()
            }
            if self.desiredPlay || self.player.timeControlStatus == .playing {
                self.onPositionChanged?(self.currentPositionMs(), self.currentDurationMs())
                self.updateNowPlayingElapsed()
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch self.player.timeControlStatus {
                case .playing:
                    self.currentError = nil
                    self.currentErrorIsNetwork = false
                    self.endRecovery()
                    self.endStallWatch()
                case .waitingToPlayAtSpecifiedRate:
                    if self.desiredPlay {
                        self.scheduleStallWatch()
                    }
                case .paused:
                    break
                @unknown default:
                    break
                }
                self.emitState()
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
        UserDefaults.standard.set(qualityPreference, forKey: Self.QUALITY_PREF_KEY)
        if isRecovering {
            recoveryAttempt = 0
            scheduleRecovery(immediate: networkAvailable)
        }
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

        endRecovery()
        endStallWatch()
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
        if let item = player.currentItem, item.status == .failed {
            if currentErrorIsNetwork || isNetworkFailure(item.error) {
                desiredPlay = true
                currentError = nil
                currentErrorIsNetwork = true
                isRecovering = true
                recoveryAttempt = 0
                recoveryPositionMs = max(currentPositionMs(), recoveryPositionMs)
                endStallWatch()
                scheduleRecovery(immediate: networkAvailable)
                emitState()
                return
            }
            loadCurrentItem(startPositionMs: 0, autoplay: true)
            return
        }
        if player.currentItem == nil {
            loadCurrentItem(startPositionMs: 0, autoplay: true)
            return
        }
        if currentStateName() == "ended" {
            recoveryPositionMs = 0
            player.seek(to: .zero)
        }
        try? AVAudioSession.sharedInstance().setActive(true)
        desiredPlay = true
        player.play()
        player.rate = Float(playbackRate)
        emitState()
    }

    func setRate(_ rate: Double) {
        playbackRate = min(3.0, max(0.5, rate))
        if desiredPlay && player.currentItem != nil {
            player.rate = Float(playbackRate)
        }
        emitState()
    }

    func currentRate() -> Double {
        return playbackRate
    }

    func pause() {
        desiredPlay = false
        endRecovery()
        endStallWatch()
        player.pause()
        emitState()
    }

    func stop() {
        endRecovery()
        endStallWatch()
        desiredPlay = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        entries.removeAll()
        currentIndex = -1
        currentError = nil
        currentErrorIsNetwork = false
        currentUsesTranscode = false
        currentIsLocal = false
        recoveryPositionMs = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        persistQueue()
        emitQueue()
        emitState()
    }

    func skipNext() {
        guard !entries.isEmpty else { return }
        endRecovery()
        endStallWatch()
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
        endRecovery()
        endStallWatch()
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
        endRecovery()
        endStallWatch()
        currentIndex = idx
        persistQueue()
        loadCurrentItem(startPositionMs: 0, autoplay: true)
        emitQueue()
        return true
    }

    func seekTo(positionMs: Int64) {
        let clamped = max(0, positionMs)
        if isRecovering {
            recoveryPositionMs = clamped
            scheduleRecovery(immediate: networkAvailable)
            emitState()
            return
        }
        if currentUsesTranscode && clamped > Self.TRANSCODE_START_MS {
            // A transcode cannot be joined part-way through; asking the server for
            // the original at the seek target is the reliable path.
            _ = loadCurrentItem(startPositionMs: clamped, autoplay: desiredPlay, preferTranscode: false)
            emitState()
            return
        }
        recoveryPositionMs = clamped
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
        return resolvePlaybackURL(trackId: trackId, budgetBytes: budgetBytes, preferTranscode: false)
    }

    private func resolvePlaybackURL(
        trackId: String,
        budgetBytes: Int64,
        preferTranscode: Bool
    ) -> (url: String?, isLocal: Bool) {
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
            if budgetBytes > 0 {
                DispatchQueue.global(qos: .utility).async { [weak self] in
                    self?.cache.prefetch(trackId: trackId, requestedBudget: budgetBytes)
                }
            }
            if preferTranscode && qualityPreference == "auto" {
                return (
                    JellyfinAuth.transcodeUrl(
                        serverUrl: session.url,
                        itemId: itemId,
                        bitsPerSecond: Self.TRANSCODE_BITS_PER_SECOND
                    ),
                    false
                )
            }
            return (JellyfinAuth.streamUrl(serverUrl: session.url, itemId: itemId), false)
        } else if track.sourceKind == "podcast" {
            guard let url = URL(string: track.path),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https" else {
                return (nil, false)
            }
            return (track.path, false)
        } else {
            let fileURL = URL(fileURLWithPath: track.path)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue else {
                return (nil, false)
            }
            return (LocalMediaServer.localUri(for: fileURL), true)
        }
    }

    @discardableResult
    private func loadCurrentItem(startPositionMs: Int64, autoplay: Bool, preferTranscode: Bool = false) -> Bool {
        currentError = nil
        currentErrorIsNetwork = false
        endStallWatch()
        if let endObserver = endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        statusObservation?.invalidate()
        statusObservation = nil
        recoveryPositionMs = max(0, startPositionMs)

        guard let slot = currentSlot else {
            player.replaceCurrentItem(with: nil)
            currentIsLocal = false
            currentUsesTranscode = false
            emitState()
            return false
        }

        let track = db.getMediaItemById(slot.trackId)
        let wantsTranscode = preferTranscode && qualityPreference == "auto"
        let resolved = resolvePlaybackURL(
            trackId: slot.trackId,
            budgetBytes: cacheBudgetBytes,
            preferTranscode: wantsTranscode
        )
        guard let urlString = resolved.url, let url = URL(string: urlString) else {
            currentError = "MEDIA_UNAVAILABLE"
            currentErrorIsNetwork = false
            desiredPlay = false
            currentIsLocal = false
            currentUsesTranscode = false
            player.replaceCurrentItem(with: nil)
            emitState()
            return false
        }

        currentIsLocal = resolved.isLocal
        currentUsesTranscode = wantsTranscode && !resolved.isLocal && (track?.sourceKind.hasPrefix("jellyfin") ?? false)

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
                guard let self = self, self.player.currentItem === observedItem else { return }
                if observedItem.status == .failed {
                    let failure = observedItem.error
                    if self.isNetworkFailure(failure) {
                        self.endStallWatch()
                        self.beginRecovery(reason: failure?.localizedDescription)
                    } else {
                        self.currentError = failure?.localizedDescription ?? "PLAYER_ERROR"
                        self.currentErrorIsNetwork = false
                        self.desiredPlay = false
                        self.endRecovery()
                        self.endStallWatch()
                    }
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
            player.rate = Float(playbackRate)
        } else {
            player.pause()
        }
        updateNowPlayingMetadata()
        emitState()
        prefetchNeighbors()
        return true
    }

    private func handleItemEnded() {
        endRecovery()
        endStallWatch()
        if repeatMode == "one" {
            recoveryPositionMs = 0
            player.seek(to: .zero)
            player.play()
            player.rate = Float(playbackRate)
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

    private func persistPodcastResumeIfNeeded() {
        guard let slot = currentSlot,
              let track = db.getMediaItemById(slot.trackId),
              track.sourceKind == "podcast" else { return }
        let position = currentPositionMs()
        guard abs(position - lastPodcastResumeWriteMs) >= 5_000 else { return }
        lastPodcastResumeWriteMs = position
        PodcastRepository.shared.setResumeForMedia(mediaItemId: slot.trackId, positionMs: position)
    }

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
        if isRecovering {
            if !desiredPlay { return "paused" }
            return networkAvailable ? "buffering" : "waiting-network"
        }
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

    // MARK: - Network & Playback Recovery

    private func configureNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.handleNetworkPath(path)
            }
        }
        networkMonitor.start(queue: networkMonitorQueue)
    }

    private func handleNetworkPath(_ path: NWPath) {
        let wasAvailable = networkAvailable
        let previousInterface = networkInterface
        networkAvailable = path.status == .satisfied
        networkInterface = interfaceType(of: path)

        guard networkAvailable else { return }

        if isRecovering {
            // A returning network wakes recovery immediately instead of waiting
            // out the remaining backoff.
            recoveryAttempt = 0
            scheduleRecovery(immediate: true)
            return
        }

        if !wasAvailable, currentErrorIsNetwork, player.currentItem != nil {
            beginRecovery(reason: currentError)
            return
        }

        let interfaceChanged = previousInterface != nil
            && networkInterface != nil
            && previousInterface != networkInterface
        if (interfaceChanged || !wasAvailable), currentError == nil, desiredPlay,
           player.currentItem != nil, !currentIsLocal {
            reloadCurrentItemAtCurrentPosition()
        }
    }

    private func interfaceType(of path: NWPath) -> NWInterface.InterfaceType? {
        if path.usesInterfaceType(.wifi) { return .wifi }
        if path.usesInterfaceType(.cellular) { return .cellular }
        if path.usesInterfaceType(.wiredEthernet) { return .wiredEthernet }
        if path.usesInterfaceType(.other) { return .other }
        return nil
    }

    private func isNetworkFailure(_ error: Error?) -> Bool {
        guard let error = error else { return !networkAvailable }
        var current: NSError? = error as NSError
        var depth = 0
        while let ns = current, depth < 5 {
            if ns.domain == NSURLErrorDomain {
                switch ns.code {
                case NSURLErrorNotConnectedToInternet,
                     NSURLErrorNetworkConnectionLost,
                     NSURLErrorTimedOut,
                     NSURLErrorCannotFindHost,
                     NSURLErrorCannotConnectToHost,
                     NSURLErrorDNSLookupFailed,
                     NSURLErrorSecureConnectionFailed,
                     NSURLErrorInternationalRoamingOff,
                     NSURLErrorDataNotAllowed,
                     NSURLErrorCallIsActive,
                     NSURLErrorResourceUnavailable,
                     NSURLErrorCannotLoadFromNetwork,
                     NSURLErrorBackgroundSessionWasDisconnected:
                    return true
                default:
                    break
                }
            }
            current = ns.userInfo[NSUnderlyingErrorKey] as? NSError
            depth += 1
        }
        // AVFoundation sometimes wraps transport failures in an opaque error; if
        // the path is down, the safest classification is a network failure.
        return !networkAvailable
    }

    /**
     * Called when the current item failed for a network reason. The queue and the
     * item are left in place; only the source URL is re-resolved on each attempt.
     * Backoff is capped and does not advance the queue. A network return wakes the
     * loop immediately, so a ten-minute outage resumes at the same position.
     */
    private func beginRecovery(reason: String?) {
        guard player.currentItem != nil, currentSlot != nil else { return }

        if isRecovering {
            recoveryPositionMs = max(currentPositionMs(), recoveryPositionMs)
            scheduleRecovery(immediate: networkAvailable)
            emitState()
            return
        }

        guard desiredPlay else {
            currentError = reason ?? "PLAYBACK_ERROR"
            currentErrorIsNetwork = true
            emitState()
            return
        }

        isRecovering = true
        currentError = nil
        currentErrorIsNetwork = true
        recoveryAttempt = 0
        recoveryPositionMs = max(currentPositionMs(), recoveryPositionMs)
        player.pause()
        endStallWatch()
        scheduleRecovery(immediate: networkAvailable)
        emitState()
    }

    private func scheduleRecovery(immediate: Bool, delay: TimeInterval? = nil) {
        guard isRecovering else { return }
        recoveryWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.isRecovering else { return }
            self.recoveryWorkItem = nil
            if !self.networkAvailable {
                self.scheduleRecovery(immediate: false, delay: 2)
                return
            }
            self.attemptRecovery()
        }
        recoveryWorkItem = work
        let wait = delay ?? (immediate ? 0 : nextRecoveryDelay())
        DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: work)
    }

    private func nextRecoveryDelay() -> TimeInterval {
        let index = min(max(recoveryAttempt, 0), Self.RECOVERY_BACKOFF_SECONDS.count - 1)
        return Self.RECOVERY_BACKOFF_SECONDS[index]
    }

    private func attemptRecovery() {
        guard isRecovering else { return }
        guard networkAvailable else {
            scheduleRecovery(immediate: false, delay: 2)
            return
        }
        guard player.currentItem != nil, currentSlot != nil else {
            finishRecovery(message: "MEDIA_UNAVAILABLE")
            return
        }

        let position = max(currentPositionMs(), recoveryPositionMs)
        recoveryPositionMs = position
        recoveryAttempt += 1
        let preferTranscode = shouldPreferTranscode(positionMs: position)
        if loadCurrentItem(startPositionMs: position, autoplay: true, preferTranscode: preferTranscode) {
            desiredPlay = true
            scheduleRecoveryWatchdog()
        } else {
            // Keep the intent to play and the current position; the next attempt
            // may resolve once the session or network is available again.
            desiredPlay = true
            currentError = nil
            currentErrorIsNetwork = true
            scheduleRecovery(immediate: false)
        }
        emitState()
    }

    private func scheduleRecoveryWatchdog() {
        recoveryWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.isRecovering else { return }
            self.recoveryWorkItem = nil
            if self.player.timeControlStatus == .playing {
                self.endRecovery()
                self.emitState()
                return
            }
            if !self.networkAvailable {
                self.scheduleRecovery(immediate: false, delay: 2)
                return
            }
            self.scheduleRecovery(immediate: false)
        }
        recoveryWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.RECOVERY_WATCHDOG_SECONDS, execute: work)
    }

    private func finishRecovery(message: String) {
        isRecovering = false
        recoveryAttempt = 0
        recoveryWorkItem?.cancel()
        recoveryWorkItem = nil
        currentError = message
        currentErrorIsNetwork = true
        player.pause()
        emitState()
    }

    private func endRecovery() {
        isRecovering = false
        recoveryAttempt = 0
        recoveryWorkItem?.cancel()
        recoveryWorkItem = nil
    }

    private func shouldPreferTranscode(positionMs: Int64) -> Bool {
        guard qualityPreference == "auto", !currentIsLocal, positionMs <= Self.TRANSCODE_START_MS else {
            return false
        }
        guard let slot = currentSlot, let track = db.getMediaItemById(slot.trackId) else { return false }
        return track.sourceKind.hasPrefix("jellyfin")
    }

    private func reloadCurrentItemAtCurrentPosition() {
        guard currentSlot != nil else { return }
        let position = max(currentPositionMs(), recoveryPositionMs)
        recoveryPositionMs = position
        let preferTranscode = shouldPreferTranscode(positionMs: position)
        _ = loadCurrentItem(startPositionMs: position, autoplay: desiredPlay, preferTranscode: preferTranscode)
        emitState()
    }

    private func scheduleStallWatch() {
        guard stallWorkItem == nil else { return }
        guard qualityPreference == "auto", !currentIsLocal, !currentUsesTranscode else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.stallWorkItem = nil
            guard self.desiredPlay, !self.currentIsLocal, !self.currentUsesTranscode else { return }
            guard self.qualityPreference == "auto" else { return }
            guard self.player.currentItem?.status != .failed else { return }
            guard self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate else { return }
            let position = self.currentPositionMs()
            guard position <= Self.TRANSCODE_START_MS else { return }
            _ = self.loadCurrentItem(startPositionMs: position, autoplay: true, preferTranscode: true)
            self.emitState()
        }
        stallWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.STALL_SECONDS, execute: work)
    }

    private func endStallWatch() {
        stallWorkItem?.cancel()
        stallWorkItem = nil
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
