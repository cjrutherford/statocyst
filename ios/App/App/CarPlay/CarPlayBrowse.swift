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
    var isPodcast: Bool = false
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
    /// Local catalog row whose artwork should be shown on the car row.
    let artworkTrackId: String?

    init(
        id: String,
        title: String,
        subtitle: String?,
        destination: Destination,
        artworkTrackId: String? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.destination = destination
        self.artworkTrackId = artworkTrackId
    }
}

/// Versioned snapshot published by the phone renderer for CarPlay and AAOS.
struct CarPlayMix: Decodable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let trackIds: [String]
    let reasons: [String: String]
}

struct CarPlayRecommendationSnapshot: Decodable, Equatable {
    let version: Int
    let generatedAt: String
    let mixes: [CarPlayMix]
}

struct CarPlayPlayed: Equatable {
    let trackId: String
    let playedAt: Int64
    let playCount: Int
}

/**
 * Native fallback for the four car mixes. Mirrors
 * libs/recommendation/src/lib/recommendation.ts and car-mixes.ts, with the shared
 * fixture at libs/recommendation/fixtures/car-recommendation-golden.json.
 *
 * CarPlay reads the phone snapshot when it is fresh; this builder is used when
 * the snapshot is missing or older than 24 hours.
 */
enum CarPlayRecommender {
    private static let favoriteWeight = 25.0
    private static let artistAffinityWeight = 30.0
    private static let genreAffinityWeight = 18.0
    private static let albumAffinityWeight = 8.0
    private static let seedSimilarity = 20.0
    private static let discovery = 4.0
    private static let rediscover = 6.0
    private static let recentWindowPenalty = 22.0
    private static let recentWeekPenalty = 10.0
    private static let recentExclusionDays = 0.5
    private static let maxPerArtist = 2
    private static let dayMs = 86_400_000.0
    private static let candidateLimit = 80
    private static let mixLimit = 12
    private static let staleAfterMs: Int64 = 24 * 60 * 60 * 1000

    private struct Candidate {
        let entity: MediaItemEntity
        let lastPlayedAt: Int64?
        let playCount: Int
    }

    private struct Reason {
        let code: String
        let label: String
        let weight: Double
        let order: Int
    }

    private struct Scored {
        let entity: MediaItemEntity
        let score: Double
        let reasons: [Reason]
    }

    private struct Profile {
        var artist: [String: Double] = [:]
        var genre: [String: Double] = [:]
        var album: [String: Double] = [:]
    }

    private static let generatedAtFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func isStale(_ snapshot: CarPlayRecommendationSnapshot, now: Date = Date()) -> Bool {
        guard let at = generatedAtFormatter.date(from: snapshot.generatedAt) else { return true }
        return now.timeIntervalSince1970 * 1000 - at.timeIntervalSince1970 * 1000 > Double(staleAfterMs)
    }

    static func snapshot(
        tracks: [MediaItemEntity],
        favorites: Set<String>,
        recent: [CarPlayPlayed],
        now: Date = Date()
    ) -> CarPlayRecommendationSnapshot {
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        let byId = Dictionary(uniqueKeysWithValues: tracks.filter { !$0.missing }.map { ($0.id, $0) })
        var recentById: [String: CarPlayPlayed] = [:]
        for entry in recent where byId[entry.trackId] != nil {
            if let existing = recentById[entry.trackId], existing.playedAt >= entry.playedAt { continue }
            recentById[entry.trackId] = entry
        }
        let candidates = tracks.filter { !$0.missing }.map { track in
            Candidate(
                entity: track,
                lastPlayedAt: recentById[track.id]?.playedAt,
                playCount: recentById[track.id]?.playCount ?? 0
            )
        }
        let ranked = Array(
            rank(
                candidates: candidates,
                byId: byId,
                favorites: favorites,
                recent: recent,
                nowMs: nowMs
            ).prefix(candidateLimit)
        )

        let rediscoverIds = Set(tracks.filter { track in
            if track.missing { return false }
            if favorites.contains(track.id) && recentById[track.id] == nil { return true }
            guard let playedAt = recentById[track.id]?.playedAt else { return false }
            return nowMs - playedAt > 30 * 86_400_000
        }.map { $0.id })

        let rediscoverTracks = ranked.filter { rediscoverIds.contains($0.entity.id) }
            .prefix(mixLimit)
        let deepCuts = ranked.filter { entry in
            entry.reasons.contains { $0.code == "artist-affinity" || $0.code == "album-affinity" }
        }.prefix(mixLimit)

        let rankedIndex = Dictionary(uniqueKeysWithValues: ranked.enumerated().map { ($1.entity.id, $0) })
        let favoriteTracks = favorites
            .compactMap { byId[$0] }
            .sorted { a, b in
                let left = rankedIndex[a.id] ?? Int.max
                let right = rankedIndex[b.id] ?? Int.max
                if left != right { return left < right }
                if a.title != b.title { return a.title < b.title }
                return a.id < b.id
            }
            .prefix(mixLimit)

        let mixes = [
            makeMix(
                id: "daily-drift",
                title: "Daily drift",
                subtitle: "Favorites + today's plays",
                trackIds: ranked.prefix(mixLimit).map { $0.entity.id },
                reasons: Dictionary(uniqueKeysWithValues: ranked.prefix(mixLimit).map {
                    ($0.entity.id, $0.reasons.first?.label ?? "Picked for you")
                })
            ),
            makeMix(
                id: "rediscover",
                title: "Rediscover",
                subtitle: "Not played in 30+ days",
                trackIds: rediscoverTracks.map { $0.entity.id },
                reasons: Dictionary(uniqueKeysWithValues: rediscoverTracks.map {
                    ($0.entity.id, "Not played in a while")
                })
            ),
            makeMix(
                id: "deep-cuts",
                title: "Deep cuts",
                subtitle: "More from your top artists",
                trackIds: deepCuts.map { $0.entity.id },
                reasons: Dictionary(uniqueKeysWithValues: deepCuts.map {
                    ($0.entity.id, "More from your top artists")
                })
            ),
            makeMix(
                id: "favorites-radio",
                title: "Favorites radio",
                subtitle: "One tap, already familiar",
                trackIds: favoriteTracks.map { $0.id },
                reasons: Dictionary(uniqueKeysWithValues: favoriteTracks.map {
                    ($0.id, "In your favorites")
                })
            ),
        ].compactMap { $0 }

        return CarPlayRecommendationSnapshot(
            version: 1,
            generatedAt: generatedAtFormatter.string(from: now),
            mixes: mixes
        )
    }

    private static func makeMix(
        id: String,
        title: String,
        subtitle: String,
        trackIds: [String],
        reasons: [String: String]
    ) -> CarPlayMix? {
        var seen = Set<String>()
        let unique = trackIds.filter { seen.insert($0).inserted }.prefix(mixLimit)
        guard !unique.isEmpty else { return nil }
        return CarPlayMix(
            id: id,
            title: title,
            subtitle: subtitle,
            trackIds: Array(unique),
            reasons: Dictionary(uniqueKeysWithValues: unique.map { ($0, reasons[$0] ?? "For you") })
        )
    }

    private static func rank(
        candidates: [Candidate],
        byId: [String: MediaItemEntity],
        favorites: Set<String>,
        recent: [CarPlayPlayed],
        nowMs: Int64
    ) -> [Scored] {
        let seeds = recent
            .compactMap { byId[$0.trackId] }
            .reduce(into: [MediaItemEntity]()) { result, track in
                if !result.contains(where: { $0.id == track.id }) { result.append(track) }
            }
            .prefix(3)
        let signature = seeds.isEmpty
            ? "library"
            : seeds.map { $0.id }.sorted().joined(separator: "|")

        let affinityProfile = profile(byId: byId, favorites: favorites, recent: recent, nowMs: nowMs)
        let artistAffinity = normalized(affinityProfile.artist)
        let genreAffinity = normalized(affinityProfile.genre)
        let albumAffinity = normalized(affinityProfile.album)

        var scored: [Scored] = []
        for candidate in candidates {
            let track = candidate.entity
            let days: Double? = candidate.lastPlayedAt.map {
                max(0, Double(nowMs - $0) / dayMs)
            }
            if let days, days < recentExclusionDays { continue }

            var score = 0.0
            var reasons: [Reason] = []
            var order = 0
            func addReason(_ code: String, _ label: String, _ weight: Double) {
                reasons.append(Reason(code: code, label: label, weight: weight, order: order))
                order += 1
            }
            let favorite = favorites.contains(track.id)
            if favorite {
                score += favoriteWeight
                addReason("favorite", "In your favorites", favoriteWeight)
            }

            let artistWeight = artistAffinity[norm(track.artist)] ?? 0
            if artistWeight > 0 {
                let weight = artistWeight * artistAffinityWeight
                score += weight
                addReason(
                    "artist-affinity",
                    "More from \(track.artist.isEmpty ? "an artist you play" : track.artist)",
                    weight
                )
            }

            var bestGenre: (label: String, weight: Double)?
            for (label, key) in genresOf(track) {
                let weight = genreAffinity[key] ?? 0
                if weight > 0 && (bestGenre == nil || weight > bestGenre!.weight) {
                    bestGenre = (label, weight)
                }
            }
            if let bestGenre {
                let weight = bestGenre.weight * genreAffinityWeight
                score += weight
                addReason(
                    "genre-affinity",
                    "Matches your \(bestGenre.label) listening",
                    weight
                )
            }

            let albumWeight = albumAffinity[norm(track.album)] ?? 0
            if albumWeight > 0 {
                let weight = albumWeight * albumAffinityWeight
                score += weight
                addReason(
                    "album-affinity",
                    "From \(track.album.isEmpty ? "an album you play" : track.album)",
                    weight
                )
            }

            var bestSeed: (seed: MediaItemEntity, weight: Double)?
            for seed in seeds where seed.id != track.id {
                let weight = Double(RadioScorer.score(seed: seed, candidate: track, favorite: false)) / 80.0
                if weight > 0 && (bestSeed == nil || weight > bestSeed!.weight) {
                    bestSeed = (seed, weight)
                }
            }
            if let bestSeed {
                let weight = min(1, bestSeed.weight) * seedSimilarity
                score += weight
                addReason(
                    "seed-similarity",
                    "Similar to songs you played recently",
                    weight
                )
            }

            if let days {
                if days <= 2 {
                    score -= recentWindowPenalty
                } else if days <= 7 {
                    score -= recentWeekPenalty
                } else if days > 30 {
                    score += rediscover
                    addReason(
                        "rediscover",
                        favorite ? "A favorite you have not played lately" : "Not played in a while",
                        rediscover
                    )
                }
            } else if favorite {
                score += rediscover
                addReason("rediscover", "A favorite you have not played yet", rediscover)
            } else {
                score += discovery
                addReason("discovery", "New to you", discovery)
            }

            score += Double(jitter(signature, track.id))
            var ordered = reasons.sorted {
                if $0.weight != $1.weight { return $0.weight > $1.weight }
                return $0.order < $1.order
            }
            ordered = Array(ordered.prefix(2))
            if ordered.isEmpty {
                ordered = [Reason(code: "discovery", label: "A fresh pick from your library", weight: 0, order: 0)]
            }
            scored.append(
                Scored(
                    entity: track,
                    score: (score * 10).rounded() / 10,
                    reasons: ordered
                )
            )
        }

        scored.sort { a, b in
            if a.score != b.score { return a.score > b.score }
            return a.entity.id < b.entity.id
        }

        var picked: [Scored] = []
        var deferred: [Scored] = []
        var perArtist: [String: Int] = [:]
        for entry in scored {
            let artist = norm(entry.entity.artist)
            let count = perArtist[artist] ?? 0
            if !artist.isEmpty && count >= maxPerArtist {
                deferred.append(entry)
                continue
            }
            picked.append(entry)
            if !artist.isEmpty { perArtist[artist] = count + 1 }
            if picked.count == candidateLimit { break }
        }
        if picked.count < candidateLimit {
            for entry in deferred {
                picked.append(entry)
                if picked.count == candidateLimit { break }
            }
        }
        return picked
    }

    private static func profile(
        byId: [String: MediaItemEntity],
        favorites: Set<String>,
        recent: [CarPlayPlayed],
        nowMs: Int64
    ) -> Profile {
        var profile = Profile()
        for id in favorites.sorted() {
            guard let track = byId[id], !track.missing else { continue }
            add(&profile.artist, norm(track.artist), 2.5)
            for (_, key) in genresOf(track) { add(&profile.genre, key, 1.5) }
            add(&profile.album, norm(track.album), 0.3)
        }
        for entry in recent {
            guard let track = byId[entry.trackId], !track.missing else { continue }
            let weight = recencyWeight(entry.playedAt, nowMs) *
                (1 + min(1, log1p(Double(entry.playCount)) / 4))
            add(&profile.artist, norm(track.artist), weight)
            for (_, key) in genresOf(track) { add(&profile.genre, key, weight * 0.8) }
            add(&profile.album, norm(track.album), weight * 0.4)
        }
        return profile
    }

    private static func recencyWeight(_ playedAt: Int64, _ nowMs: Int64) -> Double {
        let days = max(0, Double(nowMs - playedAt) / dayMs)
        if days <= 7 { return 1 }
        if days <= 30 { return 0.65 }
        if days <= 90 { return 0.35 }
        return 0.15
    }

    private static func add(_ map: inout [String: Double], _ key: String, _ amount: Double) {
        guard !key.isEmpty else { return }
        map[key, default: 0] += amount
    }

    private static func normalized(_ map: [String: Double]) -> [String: Double] {
        guard let max = map.values.max(), max > 0 else { return [:] }
        return map.mapValues { $0 / max }
    }

    private static func genresOf(_ track: MediaItemEntity) -> [(label: String, key: String)] {
        (track.genre ?? "")
            .components(separatedBy: CharacterSet(charactersIn: ",;/|"))
            .map { (label: $0.trimmingCharacters(in: .whitespacesAndNewlines), key: norm($0)) }
            .filter { !$0.key.isEmpty }
    }

    private static func norm(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        let lowered = value.lowercased()
        let scalars = lowered.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) { return Character(scalar) }
            return " "
        }
        return String(scalars)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private static func jitter(_ signature: String, _ id: String) -> Int {
        var hash: Int32 = 0
        for unit in "\(signature)|\(id)".utf16 {
            hash = hash &* 31 &+ Int32(unit)
        }
        return Int(abs(Int64(hash)) % 4)
    }
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

    static func trackList(
        tracks: [CarPlayTrack],
        reasons: [String: String] = [:]
    ) -> [CarPlaySection] {
        guard !tracks.isEmpty else {
            return [emptySection(
                title: "Nothing to play",
                detail: "These tracks are not available in the local catalog."
            )]
        }
        return [
            CarPlaySection(
                header: nil,
                rows: tracks.map { trackRow($0, reason: reasons[$0.id]) }
            )
        ]
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

    private static func trackRow(_ track: CarPlayTrack, reason: String? = nil) -> CarPlayRow {
        if track.isPodcast {
            return CarPlayRow(
                id: "episode:\(track.id)",
                title: display(track.title, fallback: "Untitled episode"),
                subtitle: episodeSubtitle(track),
                destination: .track(track.id),
                artworkTrackId: track.id
            )
        }
        var detail = display(track.artist, fallback: "Unknown Artist")
        let album = display(track.album, fallback: "")
        if !album.isEmpty {
            detail += " · \(album)"
        }
        if let reason, !reason.isEmpty {
            detail += " · \(reason)"
        }
        if track.isDownloaded {
            detail += " · Downloaded"
        }
        return CarPlayRow(
            id: "track:\(track.id)",
            title: display(track.title, fallback: "Untitled"),
            subtitle: detail,
            destination: .track(track.id),
            artworkTrackId: track.id
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
