import Foundation

/**
 * The same recording held by more than one Jellyfin server.
 *
 * Two remote tracks are the same recording when title, artist and album match
 * (ignoring case and spacing), they sit on different servers, and their lengths
 * agree to within a few seconds. Local files and tracks from one server are never
 * merged, so two genuine copies on one server stay separate.
 */
enum Duplicates {
    static let DURATION_TOLERANCE_MS: Int64 = 3_000

    static func key(_ track: MediaItemEntity) -> String? {
        guard track.sourceKind.hasPrefix("jellyfin"), !track.serverId.isEmpty else { return nil }
        let title = normalize(track.title)
        guard !title.isEmpty else { return nil }
        return "\(title)|\(normalize(track.artist))|\(normalize(track.album))"
    }

    static func collapse(_ tracks: [MediaItemEntity]) -> [MediaItemEntity] {
        let hidden = hiddenToKeeper(tracks)
        guard !hidden.isEmpty else { return tracks }
        return tracks.filter { hidden[$0.id] == nil }
    }

    static func hiddenToKeeper(_ tracks: [MediaItemEntity]) -> [String: String] {
        var hidden: [String: String] = [:]
        var groups: [String: [MediaItemEntity]] = [:]
        for track in tracks {
            if let k = key(track) {
                groups[k, default: []].append(track)
            }
        }
        for (_, group) in groups {
            let distinctServers = Set(group.map { $0.serverId })
            if distinctServers.count < 2 { continue }
            let ordered = group.sorted { a, b in
                if a.serverId != b.serverId { return a.serverId < b.serverId }
                return a.id < b.id
            }
            for keeper in ordered {
                if hidden[keeper.id] != nil { continue }
                var claimed: Set<String> = [keeper.serverId]
                for other in ordered {
                    if other.id == keeper.id || hidden[other.id] != nil || claimed.contains(other.serverId) {
                        continue
                    }
                    if !sameLength(keeper, other) { continue }
                    hidden[other.id] = keeper.id
                    claimed.insert(other.serverId)
                }
            }
        }
        return hidden
    }

    static func alternatesOf(_ track: MediaItemEntity, candidates: [MediaItemEntity]) -> [MediaItemEntity] {
        guard let k = key(track) else { return [] }
        var seen: Set<String> = [track.serverId]
        let matching = candidates
            .filter { $0.id != track.id && key($0) == k && sameLength(track, $0) }
            .sorted { a, b in
                if a.serverId != b.serverId { return a.serverId < b.serverId }
                return a.id < b.id
            }
        var out: [MediaItemEntity] = []
        for item in matching {
            if seen.insert(item.serverId).inserted {
                out.append(item)
            }
        }
        return out
    }

    private static func sameLength(_ a: MediaItemEntity, _ b: MediaItemEntity) -> Bool {
        return a.durationMs <= 0 || b.durationMs <= 0 || abs(a.durationMs - b.durationMs) <= DURATION_TOLERANCE_MS
    }

    private static func normalize(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = trimmed.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        return parts.joined(separator: " ")
    }
}
