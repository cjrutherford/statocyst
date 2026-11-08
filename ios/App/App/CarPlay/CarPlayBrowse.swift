import Foundation

/**
 * Pure, plain-value browse model for the CarPlay audio scene.
 *
 * The CarPlay delegate projects SQLite rows into these values, then turns the
 * resulting rows into CPListItems. Keeping the grouping, ordering, detail text
 * and empty-state copy here means the template code stays thin and the browse
 * rules can be exercised without CarPlay, UIKit or a database.
 */
struct CarPlayTrack: Equatable {
    let id: String
    let title: String
    let artist: String
    let album: String
    let albumArtist: String?
    let durationMs: Int64
    let isDownloaded: Bool
    let isPodcast: Bool = false
}

struct CarPlayPlaylist: Equatable {
    let id: String
    let name: String
    let trackIds: [String]
}

struct CarPlaySection: Equatable {
    let header: String?
    let rows: [CarPlayRow]
}

struct CarPlayRow: Equatable {
    enum Destination: Equatable {
        case track(String)
        case group(title: String, trackIds: [String])
        case empty
    }

    let id: String
    let title: String
    let subtitle: String?
    let destination: Destination
}

enum CarPlayBrowse {
    // MARK: - Root categories

    static func library(tracks: [CarPlayTrack], isOffline: Bool) -> [CarPlaySection] {
        guard !tracks.isEmpty else {
            if isOffline {
                return [emptySection(
                    title: "You're offline",
                    detail: "No downloaded music is available. Download tracks on your phone before driving."
                )]
            }
            return [emptySection(
                title: "No music yet",
                detail: "Import files or sync Jellyfin on your phone."
            )]
        }
        return [CarPlaySection(header: "Tracks", rows: tracks.map { trackRow($0) })]
    }

    static func albums(tracks: [CarPlayTrack]) -> [CarPlaySection] {
        guard !tracks.isEmpty else {
            return [emptySection(
                title: "No albums yet",
                detail: "Import files or sync Jellyfin on your phone."
            )]
        }

        var groups: [String: AlbumGroup] = [:]
        for track in tracks {
            let title = display(track.album, fallback: "Unknown Album")
            let artist = display(track.albumArtist ?? track.artist, fallback: "Unknown Artist")
            let key = "\(normalize(artist))|\(normalize(title))"
            if var group = groups[key] {
                group.trackIds.append(track.id)
                groups[key] = group
            } else {
                groups[key] = AlbumGroup(key: key, title: title, artist: artist, trackIds: [track.id])
            }
        }

        let ordered = groups.values.sorted { lhs, rhs in
            let leftArtist = normalize(lhs.artist)
            let rightArtist = normalize(rhs.artist)
            if leftArtist != rightArtist { return leftArtist < rightArtist }
            let leftTitle = normalize(lhs.title)
            let rightTitle = normalize(rhs.title)
            if leftTitle != rightTitle { return leftTitle < rightTitle }
            return lhs.key < rhs.key
        }

        let rows = ordered.map { group in
            CarPlayRow(
                id: "album:\(group.key)",
                title: group.title,
                subtitle: "\(group.artist) · \(trackCount(group.trackIds.count))",
                destination: .group(title: group.title, trackIds: group.trackIds)
            )
        }
        return [CarPlaySection(header: "Albums", rows: rows)]
    }

    static func artists(tracks: [CarPlayTrack]) -> [CarPlaySection] {
        guard !tracks.isEmpty else {
            return [emptySection(
                title: "No artists yet",
                detail: "Import files or sync Jellyfin on your phone."
            )]
        }

        var groups: [String: ArtistGroup] = [:]
        for track in tracks {
            let name = display(track.artist, fallback: "Unknown Artist")
            let key = normalize(name)
            let albumKey = "\(normalize(track.albumArtist ?? track.artist))|\(normalize(display(track.album, fallback: "Unknown Album")))"
            if var group = groups[key] {
                group.trackIds.append(track.id)
                group.albumKeys.insert(albumKey)
                groups[key] = group
            } else {
                groups[key] = ArtistGroup(name: name, trackIds: [track.id], albumKeys: [albumKey])
            }
        }

        let ordered = groups.values.sorted { lhs, rhs in
            let left = normalize(lhs.name)
            let right = normalize(rhs.name)
            if left != right { return left < right }
            return lhs.name < rhs.name
        }

        let rows = ordered.map { group in
            CarPlayRow(
                id: "artist:\(normalize(group.name))",
                title: group.name,
                subtitle: "\(albumCount(group.albumKeys.count)) · \(trackCount(group.trackIds.count))",
                destination: .group(title: group.name, trackIds: group.trackIds)
            )
        }
        return [CarPlaySection(header: "Artists", rows: rows)]
    }

    static func playlists(_ playlists: [CarPlayPlaylist]) -> [CarPlaySection] {
        guard !playlists.isEmpty else {
            return [emptySection(
                title: "No playlists yet",
                detail: "Create a playlist on your phone and sync it to see it here."
            )]
        }

        let rows = playlists.map { playlist in
            let name = display(playlist.name, fallback: "Playlist")
            return CarPlayRow(
                id: "playlist:\(playlist.id)",
                title: name,
                subtitle: trackCount(playlist.trackIds.count),
                destination: .group(title: name, trackIds: playlist.trackIds)
            )
        }
        return [CarPlaySection(header: "Playlists", rows: rows)]
    }

    static func downloaded(tracks: [CarPlayTrack]) -> [CarPlaySection] {
        let downloaded = tracks.filter { $0.isDownloaded }
        guard !downloaded.isEmpty else {
            return [emptySection(
                title: "No downloads",
                detail: "Download music on your phone for offline listening."
            )]
        }
        return [CarPlaySection(header: "Downloaded", rows: downloaded.map { trackRow($0) })]
    }

    // MARK: - Detail

    static func trackList(tracks: [CarPlayTrack]) -> [CarPlaySection] {
        guard !tracks.isEmpty else {
            return [emptySection(
                title: "Nothing to play",
                detail: "These tracks are not available in the local catalog."
            )]
        }
        return [CarPlaySection(header: nil, rows: tracks.map { trackRow($0) })]
    }

    // MARK: - Row construction

    private struct AlbumGroup {
        let key: String
        let title: String
        let artist: String
        var trackIds: [String]
    }

    private struct ArtistGroup {
        let name: String
        var trackIds: [String]
        var albumKeys: Set<String>
    }

    private static func trackRow(_ track: CarPlayTrack) -> CarPlayRow {
        if track.isPodcast {
            return CarPlayRow(
                id: "episode:\(track.id)",
                title: display(track.title, fallback: "Untitled episode"),
                subtitle: episodeSubtitle(track),
                destination: .track(track.id)
            )
        }
        var detail = display(track.artist, fallback: "Unknown Artist")
        let album = display(track.album, fallback: "")
        if !album.isEmpty {
            detail += " · \(album)"
        }
        if track.isDownloaded {
            detail += " · Downloaded"
        }
        return CarPlayRow(
            id: "track:\(track.id)",
            title: display(track.title, fallback: "Untitled"),
            subtitle: detail,
            destination: .track(track.id)
        )
    }

    private static func emptySection(title: String, detail: String) -> CarPlaySection {
        CarPlaySection(
            header: nil,
            rows: [CarPlayRow(id: "empty", title: title, subtitle: detail, destination: .empty)]
        )
    }

    // MARK: - Formatting

    private static func display(_ value: String, fallback: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }

    private static func normalize(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = trimmed.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        return parts.joined(separator: " ")
    }

    private static func trackCount(_ count: Int) -> String {
        return count == 1 ? "1 track" : "\(count) tracks"
    }

    private static func albumCount(_ count: Int) -> String {
        return count == 1 ? "1 album" : "\(count) albums"
    }

}

struct CarPlayPodcastFeed: Equatable {
    let id: String
    let title: String
    let author: String?
    let episodeTrackIds: [String]
}

extension CarPlayBrowse {
    static func podcasts(_ feeds: [CarPlayPodcastFeed]) -> [CarPlaySection] {
        guard !feeds.isEmpty else {
            return [emptySection(
                title: "No podcasts yet",
                detail: "Subscribe to a show on your phone to listen here."
            )]
        }
        let rows = feeds.map { feed in
            CarPlayRow(
                id: "podcast:\(feed.id)",
                title: display(feed.title, fallback: "Podcast"),
                subtitle: "\(display(feed.author ?? "", fallback: "Podcast")) · \(trackCount(feed.episodeTrackIds.count))",
                destination: .group(title: feed.title, trackIds: feed.episodeTrackIds)
            )
        }
        return [CarPlaySection(header: "Subscriptions", rows: rows)]
    }

    static func podcastEpisodes(_ feedTitle: String, tracks: [CarPlayTrack]) -> [CarPlaySection] {
        guard !tracks.isEmpty else {
            return [emptySection(
                title: "No episodes yet",
                detail: "Refresh the show on your phone to pull its episodes."
            )]
        }
        let rows = tracks.map { track in
            CarPlayRow(
                id: "episode:\(track.id)",
                title: display(track.title, fallback: "Untitled episode"),
                subtitle: episodeSubtitle(track),
                destination: .track(track.id)
            )
        }
        return [CarPlaySection(header: feedTitle, rows: rows)]
    }

    private static func episodeSubtitle(_ track: CarPlayTrack) -> String {
        var parts: [String] = []
        if track.isDownloaded { parts.append("Downloaded") }
        if track.durationMs > 0 {
            let minutes = track.durationMs / 60_000
            parts.append(minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) min")
        }
        return parts.isEmpty ? "Podcast episode" : parts.joined(separator: " · ")
    }
}
