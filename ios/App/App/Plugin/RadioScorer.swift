import Foundation

/**
 * Local "song radio": ranks the library by how alike each track is to a seed, from
 * metadata only (no network, no audio analysis). Mirrors the Kotlin and TypeScript
 * scorers so radio queues behave identically on iOS, Android, and desktop.
 */
enum RadioScorer {
    static let DEFAULT_LIMIT = 50
    private static let SAME_ARTIST = 40
    private static let SAME_ALBUM_ARTIST = 10
    private static let SAME_ALBUM = 25
    private static let SHARED_GENRE = 30
    private static let YEAR_CLOSE = 10
    private static let YEAR_NEAR = 5
    private static let FAVORITE = 5
    private static let MAX_RUN_BY_ARTIST = 2

    private static func norm(_ text: String?) -> String {
        guard let text = text, !text.isEmpty else { return "" }
        let lowered = text.lowercased()
        let scalars = lowered.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) {
                return Character(scalar)
            }
            return " "
        }
        let parts = String(scalars).components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        return parts.joined(separator: " ")
    }

    private static func genres(_ text: String?) -> Set<String> {
        guard let text = text, !text.isEmpty else { return [] }
        let separators = CharacterSet(charactersIn: ",;/|")
        let items = text.components(separatedBy: separators).map { norm($0) }.filter { !$0.isEmpty }
        return Set(items)
    }

    private static func jitter(seedId: String, id: String) -> Int {
        let combined = "\(seedId)|\(id)"
        var hash: Int32 = 0
        for byte in combined.utf8 {
            hash = hash &* 31 &+ Int32(byte)
        }
        return Int(abs(Int64(hash)) % 5)
    }

    static func score(seed: MediaItemEntity, candidate c: MediaItemEntity, favorite: Bool) -> Int {
        var s = 0
        let artist = norm(seed.artist)
        let cArtist = norm(c.artist)
        if !artist.isEmpty && artist == cArtist { s += SAME_ARTIST }
        let albumArtist = norm(seed.albumArtist)
        if !albumArtist.isEmpty && albumArtist == norm(c.albumArtist) && artist != cArtist {
            s += SAME_ALBUM_ARTIST
        }
        let album = norm(seed.album)
        if !album.isEmpty && album == norm(c.album) { s += SAME_ALBUM }
        if !genres(seed.genre).intersection(genres(c.genre)).isEmpty { s += SHARED_GENRE }
        if let sy = seed.year, let cy = c.year, sy > 0, cy > 0 {
            let d = abs(sy - cy)
            if d <= 3 { s += YEAR_CLOSE }
            else if d <= 10 { s += YEAR_NEAR }
        }
        if favorite { s += FAVORITE }
        return s
    }

    static func build(
        seed: MediaItemEntity,
        library: [MediaItemEntity],
        favorites: Set<String> = [],
        limit: Int = DEFAULT_LIMIT,
        exclude: Set<String> = []
    ) -> [String] {
        let ranked = library
            .filter { $0.id != seed.id && !$0.missing && !exclude.contains($0.id) }
            .map { item -> (MediaItemEntity, Int) in
                let sc = score(seed: seed, candidate: item, favorite: favorites.contains(item.id)) * 10
                    + jitter(seedId: seed.id, id: item.id)
                return (item, sc)
            }
            .sorted { a, b in
                if a.1 != b.1 { return a.1 > b.1 }
                return a.0.id < b.0.id
            }
            .map { $0.0 }
        return diversify(ranked, limit: limit).map { $0.id }
    }

    private static func diversify(_ ranked: [MediaItemEntity], limit: Int) -> [MediaItemEntity] {
        guard limit > 0, !ranked.isEmpty else { return [] }
        var artists: [String: String] = [:]
        func artistOf(_ item: MediaItemEntity) -> String {
            if let cached = artists[item.id] { return cached }
            let computed = norm(item.artist)
            artists[item.id] = computed
            return computed
        }
        var out: [MediaItemEntity] = []
        out.reserveCapacity(min(limit, ranked.count))
        var lastArtist: String?
        var run = 0
        var head = 0
        var taken = Array(repeating: false, count: ranked.count)
        while out.count < limit && head < ranked.count {
            while head < ranked.count && taken[head] { head += 1 }
            if head >= ranked.count { break }
            var pick = head
            if let last = lastArtist, run >= MAX_RUN_BY_ARTIST {
                var i = head
                while i < ranked.count && (taken[i] || artistOf(ranked[i]) == last) { i += 1 }
                if i < ranked.count { pick = i }
            }
            taken[pick] = true
            let item = ranked[pick]
            let artist = artistOf(item)
            run = (artist == lastArtist) ? (run + 1) : 1
            lastArtist = artist
            out.append(item)
        }
        return out
    }
}

struct RadioResult {
    let trackIds: [String]
    let source: String
}

final class RadioBuilder {
    private let db: StatocystDatabase

    init(db: StatocystDatabase = .shared) {
        self.db = db
    }

    func build(seedId: String, limit: Int = RadioScorer.DEFAULT_LIMIT) -> RadioResult? {
        let library = db.getAllMediaItems()
        guard let seed = library.first(where: { $0.id == seedId }) else { return nil }
        let favorites = Set(db.getFavorites().map { $0.trackId })
        let knownIds = Set(library.map { $0.id })
        let remote = seed.sourceKind.hasPrefix("jellyfin")
            ? instantMix(seed: seed, known: knownIds, limit: limit)
            : []
        let local: [String]
        if remote.count >= limit {
            local = []
        } else {
            local = RadioScorer.build(
                seed: seed,
                library: library,
                favorites: favorites,
                limit: limit - remote.count,
                exclude: Set(remote)
            )
        }
        let source: String
        if remote.isEmpty {
            source = "local"
        } else if local.isEmpty {
            source = "jellyfin"
        } else {
            source = "mixed"
        }
        let remoteFiltered = remote.filter { $0 != seedId }
        return RadioResult(trackIds: [seedId] + remoteFiltered + local, source: source)
    }

    private func instantMix(seed: MediaItemEntity, known: Set<String>, limit: Int) -> [String] {
        let itemId = seed.path.isEmpty ? String(seed.id.dropFirst(seed.id.hasPrefix("jf-") ? 3 : 0)) : seed.path
        guard let session = JellyfinSessions.forTrack(seed), !session.userId.isEmpty else {
            return []
        }
        do {
            let rawIds = try JellyfinClient.instantMix(
                baseUrl: session.url,
                userId: session.userId,
                token: session.token,
                itemId: itemId,
                limit: limit * 2
            )
            var seen: Set<String> = []
            var out: [String] = []
            for rawId in rawIds {
                let candidateId = "jf-\(rawId)"
                if candidateId != "jf-\(itemId)" && known.contains(candidateId) && seen.insert(candidateId).inserted {
                    out.append(candidateId)
                    if out.count >= limit { break }
                }
            }
            return out
        } catch {
            return []
        }
    }
}
