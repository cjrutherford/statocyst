import AVFoundation
import MediaPlayer
import UIKit

/**
 * Artwork loading for the CarPlay scene.
 *
 * CarPlay's Now Playing template reads metadata from MPNowPlayingInfoCenter, so
 * this helper fills in the artwork that PlaybackManager does not currently set
 * for local and offline tracks. It never owns playback state: callers must ask
 * PlaybackManager which track is current before injecting artwork.
 */
enum CarPlayArtwork {
    private static let queue = DispatchQueue(
        label: "com.hopefulaspirationsindustries.statocyst.carplay-artwork",
        qos: .utility
    )

    /// Adds artwork for the current Now Playing item if the track is still current
    /// by the time the image is ready. Leaves the existing value alone if there is
    /// no artwork.
    static func applyNowPlayingArtwork(trackId: String) {
        queue.async {
            guard let track = StatocystDatabase.shared.getMediaItemById(trackId) else { return }
            loadImage(for: track) { image in
                guard let image = image else { return }
                let state = PlaybackManager.shared.getPlaybackState().state
                guard state.trackId == trackId, state.state != "error" else { return }
                guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
    }

    /// Resolves artwork in this order: a sidecar file recorded on the media item,
    /// embedded artwork from a downloaded/library file, then Jellyfin artwork
    /// proxied through LocalMediaServer. The completion always runs on the main
    /// queue and receives nil when nothing is available.
    static func loadImage(for track: MediaItemEntity, completion: @escaping (UIImage?) -> Void) {
        if let artworkPath = track.artworkPath, !artworkPath.isEmpty,
           let image = UIImage(contentsOfFile: artworkPath) {
            deliver(image, completion)
            return
        }

        if let file = localFile(for: track) {
            loadEmbeddedArtwork(from: file) { image in
                if let image = image {
                    deliver(image, completion)
                } else {
                    loadRemoteArtwork(for: track, completion: completion)
                }
            }
            return
        }

        loadRemoteArtwork(for: track, completion: completion)
    }

    // MARK: - Local files

    private static func localFile(for track: MediaItemEntity) -> URL? {
        if let downloaded = DownloadManager().verifiedFile(track.id) {
            return downloaded
        }
        guard !track.sourceKind.hasPrefix("jellyfin") else { return nil }
        let url = URL(fileURLWithPath: track.path)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else {
            return nil
        }
        return url
    }

    private static func loadEmbeddedArtwork(from url: URL, completion: @escaping (UIImage?) -> Void) {
        let asset = AVURLAsset(url: url)
        Task {
            let metadata = try? await asset.load(.commonMetadata)
            let data = metadata?.first(where: { $0.commonKey == .commonKeyArtwork })?.dataValue
            let image = data.flatMap { UIImage(data: $0) }
            await MainActor.run {
                completion(image)
            }
        }
    }

    // MARK: - Jellyfin artwork

    private static func loadRemoteArtwork(for track: MediaItemEntity, completion: @escaping (UIImage?) -> Void) {
        guard track.sourceKind.hasPrefix("jellyfin") else {
            deliver(nil, completion)
            return
        }

        let itemId = (track.albumId?.isEmpty == false)
            ? track.albumId!
            : String(track.id.dropFirst(track.id.hasPrefix("jf-") ? 3 : 0))
        let tag = (track.albumId?.isEmpty == false) ? (track.jellyfinImageTag ?? "") : ""

        guard let uri = LocalMediaServer.artUri(itemId: itemId, tag: tag),
              let url = URL(string: uri) else {
            deliver(nil, completion)
            return
        }

        URLSession.shared.dataTask(with: url) { data, _, _ in
            let image = data.flatMap { UIImage(data: $0) }
            deliver(image, completion)
        }.resume()
    }

    // MARK: - Car tiles

    /// A dark, sonar-ringed square for a CPGridButton. CarPlay does not expose
    /// app colors, so the tile art is where the Statocyst palette lives.
    static func mixTile(index: Int) -> UIImage {
        let palettes: [[UIColor]] = [
            [
                UIColor(red: 0.72, green: 0.97, blue: 1.0, alpha: 1),
                UIColor(red: 0.04, green: 0.30, blue: 0.45, alpha: 1),
                UIColor(red: 0.02, green: 0.06, blue: 0.14, alpha: 1),
            ],
            [
                UIColor(red: 0.85, green: 0.79, blue: 1.0, alpha: 1),
                UIColor(red: 0.23, green: 0.16, blue: 0.47, alpha: 1),
                UIColor(red: 0.02, green: 0.06, blue: 0.14, alpha: 1),
            ],
            [
                UIColor(red: 0.44, green: 0.92, blue: 1.0, alpha: 1),
                UIColor(red: 0.02, green: 0.18, blue: 0.28, alpha: 1),
                UIColor(red: 0.02, green: 0.04, blue: 0.10, alpha: 1),
            ],
            [
                UIColor(red: 1.0, green: 0.85, blue: 0.94, alpha: 1),
                UIColor(red: 0.25, green: 0.20, blue: 0.52, alpha: 1),
                UIColor(red: 0.02, green: 0.06, blue: 0.14, alpha: 1),
            ],
        ]
        let palette = palettes[index % palettes.count]
        let size = CGSize(width: 300, height: 300)
        return UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            let colors = [palette[0].cgColor, palette[1].cgColor, palette[2].cgColor] as CFArray
            if let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 0.55, 1]
            ) {
                cg.drawLinearGradient(
                    gradient,
                    start: CGPoint(x: 0, y: 0),
                    end: CGPoint(x: size.width, y: size.height),
                    options: []
                )
            }

            // A cyan sonar bloom in the upper-left, then concentric rings.
            cg.setFillColor(UIColor(red: 0.5, green: 0.94, blue: 1.0, alpha: 0.30).cgColor)
            cg.fillEllipse(in: CGRect(x: 46, y: 42, width: 64, height: 64))
            cg.setStrokeColor(UIColor(red: 0.5, green: 0.94, blue: 1.0, alpha: 0.20).cgColor)
            cg.setLineWidth(1.5)
            for step in 1...5 {
                let radius = 42 + CGFloat(step) * 30
                cg.strokeEllipse(
                    in: CGRect(
                        x: 78 - radius,
                        y: 74 - radius,
                        width: radius * 2,
                        height: radius * 2
                    )
                )
            }

            // Soft bottom fade keeps the grid title readable.
            if let shade = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: [
                    UIColor.clear.cgColor,
                    UIColor(red: 0.01, green: 0.03, blue: 0.08, alpha: 0.86).cgColor,
                ] as CFArray,
                locations: [0, 1]
            ) {
                cg.drawLinearGradient(
                    shade,
                    start: CGPoint(x: 0, y: size.height * 0.35),
                    end: CGPoint(x: 0, y: size.height),
                    options: []
                )
            }
        }
    }

    // MARK: - Delivery

    private static func deliver(_ image: UIImage?, _ completion: @escaping (UIImage?) -> Void) {
        if Thread.isMainThread {
            completion(image)
        } else {
            DispatchQueue.main.async {
                completion(image)
            }
        }
    }
}
