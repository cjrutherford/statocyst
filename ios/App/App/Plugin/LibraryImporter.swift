import Foundation
import AVFoundation

/**
 * On-device library import for iOS (Files app / UIDocumentPickerViewController).
 *
 * Audio files are copied into `Application Support/Statocyst/library` so security-scoped
 * URL grants from the document picker never expire on the catalog, and metadata is
 * read through AVURLAsset.
 */
final class LibraryImporter {
    static let SOURCE_ID = "local"
    static let SOURCE_LABEL = "This device"

    private static let EXTENSIONS: Set<String> = [
        "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wave", "alac", "wma", "aiff", "aif"
    ]

    struct Summary {
        var imported: [MediaItemEntity]
        var duplicates: Int
        var missing: Int
        var rejected: [(path: String, code: String)]
        var cancelled: Bool = false
    }

    private let db: StatocystDatabase
    let directory: URL

    init(db: StatocystDatabase = .shared) {
        self.db = db
        self.directory = StatocystDatabase.appDataDirectory().appendingPathComponent("library", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func importURLs(_ urls: [URL], onProgress: (Int, Int) -> Void) -> Summary {
        var imported: [MediaItemEntity] = []
        var rejected: [(String, String)] = []
        var duplicates = 0
        var missing = 0

        for (index, url) in urls.enumerated() {
            let scoped = url.startAccessingSecurityScopedResource()
            defer {
                if scoped { url.stopAccessingSecurityScopedResource() }
            }

            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
                let sub = importFolder(url, startScanned: index, onProgress: onProgress)
                imported.append(contentsOf: sub.imported)
                duplicates += sub.duplicates
                missing += sub.missing
                rejected.append(contentsOf: sub.rejected)
                continue
            }

            let name = url.lastPathComponent.isEmpty ? "audio" : url.lastPathComponent
            guard Self.isAudio(name) else {
                rejected.append((name, "UNSUPPORTED_FORMAT"))
                onProgress(index + 1, imported.count)
                continue
            }

            let pathKey = "file:\(url.standardizedFileURL.path)"
            if db.getMediaItemByPathKey(pathKey) != nil {
                duplicates += 1
                onProgress(index + 1, imported.count)
                continue
            }

            do {
                if let entity = try importSingleFile(url: url, name: name, pathKey: pathKey) {
                    imported.append(entity)
                } else {
                    missing += 1
                }
            } catch {
                rejected.append((name, error.localizedDescription))
            }
            onProgress(index + 1, imported.count)
        }

        return Summary(imported: imported, duplicates: duplicates, missing: missing, rejected: rejected)
    }

    func importFolder(_ folderURL: URL, startScanned: Int = 0, onProgress: (Int, Int) -> Void) -> Summary {
        let scoped = folderURL.startAccessingSecurityScopedResource()
        defer {
            if scoped { folderURL.stopAccessingSecurityScopedResource() }
        }

        var imported: [MediaItemEntity] = []
        var rejected: [(String, String)] = []
        var duplicates = 0
        var missing = 0
        var scanned = startScanned

        guard let enumerator = FileManager.default.enumerator(
            at: folderURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return Summary(imported: [], duplicates: 0, missing: 1, rejected: [])
        }

        for case let fileURL as URL in enumerator {
            let isFile = (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
            if !isFile { continue }
            scanned += 1
            let name = fileURL.lastPathComponent
            if !Self.isAudio(name) { continue }
            let pathKey = "file:\(fileURL.standardizedFileURL.path)"
            if db.getMediaItemByPathKey(pathKey) != nil {
                duplicates += 1
                onProgress(scanned, imported.count)
                continue
            }
            do {
                if let entity = try importSingleFile(url: fileURL, name: name, pathKey: pathKey) {
                    imported.append(entity)
                } else {
                    missing += 1
                }
            } catch {
                rejected.append((name, error.localizedDescription))
            }
            onProgress(scanned, imported.count)
        }

        return Summary(imported: imported, duplicates: duplicates, missing: missing, rejected: rejected)
    }

    func importPaths(_ paths: [String], onProgress: (Int, Int) -> Void) -> Summary {
        let urls = paths.map { URL(fileURLWithPath: $0) }
        return importURLs(urls, onProgress: onProgress)
    }

    @discardableResult
    func removeTrack(_ trackId: String) -> Bool {
        guard let entity = db.getMediaItemById(trackId) else { return false }
        if entity.sourceKind == "local" {
            try? FileManager.default.removeItem(atPath: entity.path)
        }
        return db.deleteMediaItemById(trackId)
    }

    private func importSingleFile(url: URL, name: String, pathKey: String) throws -> MediaItemEntity? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let ext = url.pathExtension.lowercased().isEmpty ? "audio" : url.pathExtension.lowercased()
        let id = "local-\(UUID().uuidString.lowercased())"
        let target = directory.appendingPathComponent("\(id).\(ext)")

        if FileManager.default.fileExists(atPath: target.path) {
            try? FileManager.default.removeItem(at: target)
        }
        try FileManager.default.copyItem(at: url, to: target)

        let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64) ?? 0
        guard size > 0 else {
            try? FileManager.default.removeItem(at: target)
            return nil
        }

        let meta = extractMetadata(from: target, fallbackName: name)
        let now = ISO8601DateFormatter().string(from: Date())
        let entity = MediaItemEntity(
            id: id,
            sourceId: Self.SOURCE_ID,
            path: target.path,
            pathKey: pathKey,
            fileName: name,
            ext: ext,
            sizeBytes: size,
            mtimeMs: Int64(Date().timeIntervalSince1970 * 1000),
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            albumArtist: meta.albumArtist,
            trackNo: meta.trackNo,
            discNo: nil,
            year: meta.year,
            genre: meta.genre,
            durationMs: meta.durationMs,
            bitrate: nil,
            sampleRate: nil,
            channels: nil,
            codec: ext,
            format: ext,
            artworkPath: nil,
            jellyfinImageTag: nil,
            sourceKind: "local",
            sourceLabel: Self.SOURCE_LABEL,
            addedAt: now,
            updatedAt: now,
            missing: false,
            albumId: nil,
            serverId: ""
        )
        db.upsertMediaItem(entity)
        return entity
    }

    private struct ExtractedMetadata {
        var title: String
        var artist: String
        var album: String
        var albumArtist: String?
        var trackNo: Int?
        var year: Int?
        var genre: String?
        var durationMs: Int64
    }

    private func extractMetadata(from fileURL: URL, fallbackName: String) -> ExtractedMetadata {
        let fallbackTitle = (fallbackName as NSString).deletingPathExtension
        let asset = AVURLAsset(url: fileURL)
        let durationSeconds = CMTimeGetSeconds(asset.duration)
        let durationMs: Int64 = (durationSeconds.isFinite && durationSeconds > 0)
            ? Int64((durationSeconds * 1000.0).rounded())
            : 0

        var title: String?
        var artist: String?
        var album: String?
        var albumArtist: String?
        var genre: String?
        var year: Int?
        var trackNo: Int?

        for item in asset.commonMetadata {
            guard let commonKey = item.commonKey else { continue }
            let val = item.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let val = val, !val.isEmpty else { continue }
            switch commonKey {
            case .commonKeyTitle:
                title = val
            case .commonKeyArtist:
                artist = val
            case .commonKeyAlbumName:
                album = val
            case .commonKeyType:
                genre = val
            case .commonKeyCreationDate:
                if let y = Int(val.prefix(4)) { year = y }
            default:
                break
            }
        }

        for format in asset.availableMetadataFormats {
            for item in asset.metadata(forFormat: format) {
                if let keyStr = item.identifier?.rawValue.lowercased(),
                   let val = item.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !val.isEmpty {
                    if albumArtist == nil && (keyStr.contains("tpe2") || keyStr.contains("aart") || keyStr.contains("albumartist")) {
                        albumArtist = val
                    } else if trackNo == nil && (keyStr.contains("trck") || keyStr.contains("trkn") || keyStr.contains("tracknumber")) {
                        let digits = val.prefix { $0.isNumber }
                        trackNo = Int(digits)
                    } else if year == nil && (keyStr.contains("tyer") || keyStr.contains("tdrc") || keyStr.contains("day")) {
                        if let y = Int(val.prefix(4)) { year = y }
                    }
                }
            }
        }

        return ExtractedMetadata(
            title: title ?? fallbackTitle,
            artist: artist ?? albumArtist ?? "Unknown artist",
            album: album ?? "Unknown album",
            albumArtist: albumArtist,
            trackNo: trackNo,
            year: year,
            genre: genre,
            durationMs: durationMs
        )
    }

    static func isAudio(_ name: String) -> Bool {
        let ext = (name as NSString).pathExtension.lowercased()
        return EXTENSIONS.contains(ext)
    }
}
