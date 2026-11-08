import CarPlay
import Network
import UIKit

/**
 * CarPlay audio scene.
 *
 * Browse data comes from the same SQLite database as the phone UI. Playback is
 * delegated to PlaybackManager, whose MPRemoteCommandCenter registrations remain
 * the single transport authority used by Lock Screen, Control Center and
 * CarPlay's Now Playing template. The WebView is never involved.
 */
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate, CPInterfaceControllerDelegate {
    private let db = StatocystDatabase.shared
    private let downloads = DownloadManager()
    private let podcasts = PodcastRepository.shared

    private var interfaceController: CPInterfaceController?
    private var pathMonitor: NWPathMonitor?
    private var isOffline = false
    private var tracksById: [String: CarPlayTrack] = [:]
    private var lastTracksEmpty = false

    // MARK: - Scene lifecycle

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        connect(interfaceController)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        connect(interfaceController)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        disconnect(interfaceController)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        disconnect(interfaceController)
    }

    private func connect(_ controller: CPInterfaceController) {
        guard interfaceController !== controller else { return }
        interfaceController = controller
        controller.delegate = self
        startNetworkMonitor()
        configureNowPlaying()
        reloadBrowse()
        applyArtworkForCurrentTrack()
    }

    private func disconnect(_ controller: CPInterfaceController) {
        guard interfaceController === controller else { return }
        interfaceController = nil
        tracksById = [:]
        lastTracksEmpty = false
        stopNetworkMonitor()
    }

    // MARK: - Interface controller delegate

    func templateWillAppear(_ aTemplate: CPTemplate, animated: Bool) {
        guard aTemplate === CPNowPlayingTemplate.shared else { return }
        applyArtworkForCurrentTrack()
    }

    // MARK: - Root templates

    private func reloadBrowse() {
        guard let controller = interfaceController else { return }
        let snapshot = browseSnapshot()
        tracksById = snapshot.tracksById
        lastTracksEmpty = snapshot.library.isEmpty
        controller.setRootTemplate(makeRootTemplate(snapshot: snapshot), animated: false, completion: nil)
    }

    private struct BrowseCategory {
        let title: String
        let sections: [CarPlaySection]
        let queue: [String]
        let imageName: String
    }

    private func makeRootTemplate(snapshot: BrowseSnapshot) -> CPTabBarTemplate {
        let categories: [BrowseCategory] = [
            BrowseCategory(
                title: "Library",
                sections: CarPlayBrowse.library(tracks: snapshot.library, isOffline: isOffline),
                queue: snapshot.library.map { $0.id },
                imageName: "music.note.list"
            ),
            BrowseCategory(
                title: "Albums",
                sections: CarPlayBrowse.albums(tracks: snapshot.library),
                queue: [],
                imageName: "square.stack"
            ),
            BrowseCategory(
                title: "Artists",
                sections: CarPlayBrowse.artists(tracks: snapshot.library),
                queue: [],
                imageName: "person.2"
            ),
            BrowseCategory(
                title: "Playlists",
                sections: CarPlayBrowse.playlists(snapshot.playlists),
                queue: [],
                imageName: "list.bullet"
            ),
            BrowseCategory(
                title: "Podcasts",
                sections: CarPlayBrowse.podcasts(snapshot.podcasts),
                queue: [],
                imageName: "mic"
            ),
            BrowseCategory(
                title: "Downloaded",
                sections: CarPlayBrowse.downloaded(tracks: snapshot.downloaded),
                queue: snapshot.downloaded.map { $0.id },
                imageName: "arrow.down.circle"
            )
        ]

        let maximumTabs = max(1, CPTabBarTemplate.maximumTabCount)

        if categories.count <= maximumTabs {
            let templates: [CPTemplate] = categories.map { category -> CPTemplate in
                makeListTemplate(
                    title: category.title,
                    sections: category.sections,
                    queue: category.queue,
                    tabImageName: category.imageName
                )
            }
            return CPTabBarTemplate(templates: templates)
        }

        // Audio-entitled hosts currently allow four tabs. Keep every required
        // destination reachable by folding the overflow into a final More tab.
        let directCount = max(0, maximumTabs - 1)
        let direct = categories.prefix(directCount).map { category -> CPTemplate in
            makeListTemplate(
                title: category.title,
                sections: category.sections,
                queue: category.queue,
                tabImageName: category.imageName
            )
        }
        let overflow = Array(categories.dropFirst(directCount))
        var templates: [CPTemplate] = direct
        templates.append(makeMoreTemplate(overflow))
        return CPTabBarTemplate(templates: templates)
    }

    private func makeMoreTemplate(_ categories: [BrowseCategory]) -> CPListTemplate {
        let items: [CPListTemplateItem] = categories.map { category -> CPListTemplateItem in
            let item = CPListItem(text: category.title, detailText: nil)
            item.handler = { [weak self] _, completion in
                self?.pushCategory(category)
                completion()
            }
            return item
        }
        let more = CPListTemplate(title: "More", sections: [CPListSection(items: items)])
        more.tabTitle = "More"
        more.tabImage = UIImage(systemName: "ellipsis")
        return more
    }

    private func pushCategory(_ category: BrowseCategory) {
        let template = makeListTemplate(
            title: category.title,
            sections: category.sections,
            queue: category.queue,
            tabImageName: category.imageName
        )
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    private func makeListTemplate(
        title: String,
        sections: [CarPlaySection],
        queue: [String],
        tabImageName: String? = nil
    ) -> CPListTemplate {
        let cpSections = sections.map { section -> CPListSection in
            let items: [CPListTemplateItem] = section.rows.map { row -> CPListTemplateItem in
                makeItem(row, queue: queue)
            }
            return CPListSection(items: items, header: section.header, sectionIndexTitle: nil)
        }
        let template = CPListTemplate(title: title, sections: cpSections)
        template.tabTitle = title
        if let tabImageName = tabImageName {
            template.tabImage = UIImage(systemName: tabImageName)
        }
        return template
    }

    private func makeItem(_ row: CarPlayRow, queue: [String]) -> CPListItem {
        let item = CPListItem(text: row.title, detailText: row.subtitle)
        switch row.destination {
        case .empty:
            item.isEnabled = false
        case .track(let trackId):
            item.handler = { [weak self] _, completion in
                self?.startPlayback(trackId: trackId, queue: queue)
                completion()
            }
        case .group(let title, let trackIds):
            item.handler = { [weak self] _, completion in
                self?.pushTrackList(title: title, trackIds: trackIds)
                completion()
            }
        }
        return item
    }

    private func pushTrackList(title: String, trackIds: [String]) {
        let tracks = trackIds.compactMap { tracksById[$0] }
        let template = makeListTemplate(
            title: title,
            sections: CarPlayBrowse.trackList(tracks: tracks),
            queue: tracks.map { $0.id }
        )
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    // MARK: - Now Playing

    private func configureNowPlaying() {
        let nowPlaying = CPNowPlayingTemplate.shared
        nowPlaying.isUpNextButtonEnabled = false
        nowPlaying.isAlbumArtistButtonEnabled = false

        // Shuffle and repeat buttons are deliberately not installed. CarPlay
        // derives their selected state from MPRemoteCommandCenter's
        // changeShuffleMode/changeRepeatMode commands, which PlaybackManager
        // does not register. Transport remains owned by PlaybackManager.
    }

    private func pushNowPlaying() {
        // Audio-entitled hosts only allow list/grid templates as tab roots, so
        // the shared Now Playing template is pushed onto the active tab.
        guard let controller = interfaceController else { return }
        let nowPlaying = CPNowPlayingTemplate.shared
        guard !controller.templates.contains(where: { $0 === nowPlaying }) else { return }
        controller.pushTemplate(nowPlaying, animated: true, completion: nil)
    }

    private func applyArtworkForCurrentTrack() {
        guard let trackId = PlaybackManager.shared.getPlaybackState().state.trackId else { return }
        CarPlayArtwork.applyNowPlayingArtwork(trackId: trackId)
    }

    // MARK: - Playback

    private func startPlayback(trackId: String, queue: [String]) {
        guard let index = queue.firstIndex(of: trackId) else { return }
        let slots = queue.enumerated().map { offset, id in
            PlaybackQueueSlot(entryId: "carplay-\(offset)-\(id)", trackId: id)
        }
        let entryId = slots[index].entryId

        PlaybackManager.shared.setQueue(
            newEntries: slots,
            currentEntryId: entryId,
            startPositionMs: 0,
            playImmediately: true,
            keepCurrent: false,
            cacheBudgetBytes: nil,
            quality: nil
        )
        let state = PlaybackManager.shared.getPlaybackState().state
        guard state.state != "error" else { return }
        CarPlayArtwork.applyNowPlayingArtwork(trackId: trackId)
        pushNowPlaying()
    }

    // MARK: - Browse snapshot

    private struct BrowseSnapshot {
        let library: [CarPlayTrack]
        let downloaded: [CarPlayTrack]
        let playlists: [CarPlayPlaylist]
        let podcasts: [CarPlayPodcastFeed]
        let tracksById: [String: CarPlayTrack]
    }

    private func browseSnapshot() -> BrowseSnapshot {
        let all = db.getAllMediaItems().filter { $0.mediaKind == "music" }
        let visible = Duplicates.collapse(all)
        let entitiesById = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

        let validDownloads = downloads.list()
        let downloadedIds = Set(validDownloads.map { $0.trackId })
        let library = visible.map { track(from: $0, downloaded: downloadedIds.contains($0.id)) }

        var downloaded: [CarPlayTrack] = []
        var seenDownloads = Set<String>()
        for record in validDownloads {
            guard seenDownloads.insert(record.trackId).inserted,
                  let entity = entitiesById[record.trackId] else {
                continue
            }
            downloaded.append(track(from: entity, downloaded: true))
        }

        let playlistTrackRows = db.getAllPlaylistTracks()
        var playlistTrackIds: [String: [String]] = [:]
        for row in playlistTrackRows {
            playlistTrackIds[row.playlistId, default: []].append(row.trackId)
        }
        let playlists = db.getAllPlaylists().map { entity in
            CarPlayPlaylist(
                id: entity.id,
                name: entity.name,
                trackIds: playlistTrackIds[entity.id] ?? []
            )
        }

        var tracksById: [String: CarPlayTrack] = [:]
        for item in library {
            tracksById[item.id] = item
        }
        for item in downloaded {
            tracksById[item.id] = item
        }
        for (id, entity) in entitiesById where tracksById[id] == nil {
            tracksById[id] = track(from: entity, downloaded: downloadedIds.contains(id))
        }

        var podcastFeeds: [CarPlayPodcastFeed] = []
        for record in podcasts.listFeeds() {
            let episodes = podcasts.listEpisodes(feedId: record.feed.id)
            let episodeTracks = episodes.map { episode in
                let item = track(
                    from: episode.media,
                    downloaded: downloadedIds.contains(episode.media.id)
                )
                tracksById[item.id] = item
                return item
            }
            podcastFeeds.append(
                CarPlayPodcastFeed(
                    id: record.feed.id,
                    title: record.feed.title,
                    author: record.feed.author,
                    episodeTrackIds: episodeTracks.map { $0.id }
                )
            )
        }

        return BrowseSnapshot(
            library: library,
            downloaded: downloaded,
            playlists: playlists,
            podcasts: podcastFeeds,
            tracksById: tracksById
        )
    }

    private func track(from entity: MediaItemEntity, downloaded: Bool) -> CarPlayTrack {
        return CarPlayTrack(
            id: entity.id,
            title: entity.title,
            artist: entity.artist,
            album: entity.album,
            albumArtist: entity.albumArtist,
            durationMs: entity.durationMs,
            isDownloaded: downloaded,
            isPodcast: entity.mediaKind == "podcast"
        )
    }

    // MARK: - Connectivity

    private func startNetworkMonitor() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        let queue = DispatchQueue(
            label: "com.hopefulaspirationsindustries.statocyst.carplay-network",
            qos: .utility
        )
        monitor.pathUpdateHandler = { [weak self] path in
            let offline = path.status != .satisfied
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                guard offline != self.isOffline else { return }
                self.isOffline = offline
                if self.lastTracksEmpty {
                    self.reloadBrowse()
                }
            }
        }
        monitor.start(queue: queue)
        pathMonitor = monitor
    }

    private func stopNetworkMonitor() {
        pathMonitor?.cancel()
        pathMonitor = nil
    }
}
