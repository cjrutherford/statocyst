import Foundation
import Darwin

/**
 * Serves app-private audio files and authenticated Jellyfin artwork to WKWebView
 * and AVPlayer over a loopback HTTP server (127.0.0.1:<ephemeral-port>).
 *
 * Supports HTTP 206 Partial Content byte-range requests so seeking works
 * reliably across local files, cached tracks, and offline downloads.
 */
final class LocalMediaServer {
    static let PREFIX = "/__media/"
    private static let HOST = "127.0.0.1"

    private static let lock = NSLock()
    private static var serverPort: Int = 0
    private static var listenFd: Int32 = -1
    private static let workerQueue = DispatchQueue(
        label: "com.hopefulaspirationsindustries.statocyst.media-server",
        qos: .userInitiated,
        attributes: .concurrent
    )

    static func start() {
        lock.lock()
        defer { lock.unlock() }
        if listenFd >= 0 && serverPort > 0 { return }

        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return }

        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(0).bigEndian
        addr.sin_addr.s_addr = inet_addr(HOST)

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0, Darwin.listen(fd, 32) == 0 else {
            Darwin.close(fd)
            return
        }

        var boundAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &boundAddr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &addrLen)
            }
        }
        guard nameResult == 0 else {
            Darwin.close(fd)
            return
        }

        listenFd = fd
        serverPort = Int(UInt16(bigEndian: boundAddr.sin_port))

        Thread.detachNewThread {
            acceptLoop(fd: fd)
        }
    }

    static func localUri(for fileURL: URL) -> String? {
        start()
        guard serverPort > 0 else { return nil }
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?")
        guard let encoded = fileURL.path.addingPercentEncoding(withAllowedCharacters: allowed) else {
            return nil
        }
        return "http://\(HOST):\(serverPort)\(PREFIX)file?path=\(encoded)"
    }

    static func artUri(itemId: String, tag: String) -> String? {
        start()
        guard serverPort > 0, JellyfinArtwork.isValidId(itemId) else { return nil }
        let safeTag = JellyfinArtwork.isValidTag(tag) ? tag : ""
        let suffix = safeTag.isEmpty ? "" : "&tag=\(safeTag)"
        return "http://\(HOST):\(serverPort)\(PREFIX)art?id=\(itemId)\(suffix)"
    }

    private static func acceptLoop(fd: Int32) {
        while true {
            var clientAddr = sockaddr_in()
            var clientLen = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFd = withUnsafeMutablePointer(to: &clientAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.accept(fd, $0, &clientLen)
                }
            }
            if clientFd < 0 {
                if errno == EINTR { continue }
                break
            }
            var noSigPipe: Int32 = 1
            setsockopt(clientFd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
            workerQueue.async {
                handleClient(clientFd)
            }
        }
    }

    private static func handleClient(_ fd: Int32) {
        defer { Darwin.close(fd) }

        var buffer = [UInt8](repeating: 0, count: 8192)
        let bytesRead = Darwin.read(fd, &buffer, buffer.count - 1)
        guard bytesRead > 0 else { return }
        let rawRequest = String(bytes: buffer[0..<bytesRead], encoding: .isoLatin1) ?? ""
        let lines = rawRequest.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return }

        let method = String(parts[0]).uppercased()
        let target = String(parts[1])
        guard method == "GET" || method == "HEAD" else {
            writeText(fd: fd, status: 405, reason: "Method Not Allowed", body: "Method not allowed")
            return
        }
        let isHead = (method == "HEAD")

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            if line.isEmpty { break }
            if let colon = line.firstIndex(of: ":") {
                let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                headers[key] = value
            }
        }

        guard let components = URLComponents(string: "http://\(HOST)\(target)") else {
            writeText(fd: fd, status: 400, reason: "Bad Request", body: "Bad request")
            return
        }
        let path = components.path
        let queryItems = components.queryItems ?? []
        func queryValue(_ name: String) -> String? {
            return queryItems.first(where: { $0.name == name })?.value
        }

        if path == "\(PREFIX)art" {
            let id = queryValue("id") ?? ""
            let tag = queryValue("tag") ?? ""
            guard JellyfinArtwork.isValidId(id), JellyfinArtwork.isValidTag(tag) else {
                writeText(fd: fd, status: 400, reason: "Bad Request", body: "Bad artwork request")
                return
            }
            guard let imageURL = JellyfinArtwork.fetch(itemId: id, tag: tag, height: 300) else {
                writeText(fd: fd, status: 404, reason: "Not Found", body: "No artwork")
                return
            }
            sendImage(fd: fd, imageURL: imageURL, head: isHead)
            return
        }

        guard path == "\(PREFIX)file" else {
            writeText(fd: fd, status: 404, reason: "Not Found", body: "Not found")
            return
        }
        guard let rawPath = queryValue("path"), !rawPath.isEmpty else {
            writeText(fd: fd, status: 400, reason: "Bad Request", body: "Missing path")
            return
        }

        let fileURL = URL(fileURLWithPath: rawPath).standardizedFileURL
        guard insideMediaRoots(fileURL) else {
            writeText(fd: fd, status: 403, reason: "Forbidden", body: "Forbidden")
            return
        }

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue else {
            writeText(fd: fd, status: 404, reason: "Not Found", body: "Not found")
            return
        }

        serveFile(fd: fd, fileURL: fileURL, headers: headers, head: isHead)
    }

    private static func sendImage(fd: Int32, imageURL: URL, head: Bool) {
        guard let data = try? Data(contentsOf: imageURL), !data.isEmpty else {
            writeText(fd: fd, status: 404, reason: "Not Found", body: "No artwork")
            return
        }
        let mime = JellyfinArtwork.sniffMime(data.prefix(16)) ?? "application/octet-stream"
        let header = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: \(mime)\r\n"
            + "Content-Length: \(data.count)\r\n"
            + "Cache-Control: private, max-age=86400\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Connection: close\r\n\r\n"
        writeAll(fd: fd, data: Data(header.utf8))
        if !head {
            writeAll(fd: fd, data: data)
        }
    }

    private static func serveFile(fd: Int32, fileURL: URL, headers: [String: String], head: Bool) {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let length = attrs[.size] as? Int64 else {
            writeText(fd: fd, status: 404, reason: "Not Found", body: "Not found")
            return
        }

        var start: Int64 = 0
        var end: Int64 = max(0, length - 1)
        var partial = false

        if let range = headers["range"], range.hasPrefix("bytes="), length > 0 {
            let spec = range.dropFirst("bytes=".count).trimmingCharacters(in: .whitespaces)
            if let dash = spec.firstIndex(of: "-") {
                let prefixStr = String(spec[..<dash])
                let suffixStr = String(spec[spec.index(after: dash)...])
                if prefixStr.isEmpty, let suffix = Int64(suffixStr) {
                    start = max(0, length - suffix)
                    partial = true
                } else if let s = Int64(prefixStr) {
                    start = s
                    if !suffixStr.isEmpty, let e = Int64(suffixStr) {
                        end = min(e, length - 1)
                    }
                    partial = true
                }
            }
            if partial && (start < 0 || start >= length || end < start) {
                writeText(
                    fd: fd,
                    status: 416,
                    reason: "Range Not Satisfiable",
                    body: "Range not satisfiable",
                    extraHeaders: "Content-Range: bytes */\(length)\r\n"
                )
                return
            }
        }

        let contentLength = length > 0 ? max(0, end - start + 1) : 0
        let mime = mimeType(for: fileURL.pathExtension)
        var responseHeader = "HTTP/1.1 \(partial ? "206 Partial Content" : "200 OK")\r\n"
        responseHeader += "Content-Type: \(mime)\r\n"
        responseHeader += "Content-Length: \(contentLength)\r\n"
        responseHeader += "Accept-Ranges: bytes\r\n"
        responseHeader += "Cache-Control: no-store\r\n"
        responseHeader += "Access-Control-Allow-Origin: *\r\n"
        responseHeader += "Connection: close\r\n"
        if partial {
            responseHeader += "Content-Range: bytes \(start)-\(end)/\(length)\r\n"
        }
        responseHeader += "\r\n"

        writeAll(fd: fd, data: Data(responseHeader.utf8))
        if head || contentLength == 0 { return }

        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return }
        defer { try? handle.close() }
        try? handle.seek(toOffset: UInt64(start))

        var remaining = contentLength
        let chunkSize = 64 * 1024
        while remaining > 0 {
            let toRead = Int(min(Int64(chunkSize), remaining))
            guard let chunk = try? handle.read(upToCount: toRead), !chunk.isEmpty else { break }
            if !writeAll(fd: fd, data: chunk) { break }
            remaining -= Int64(chunk.count)
        }
    }

    private static func insideMediaRoots(_ fileURL: URL) -> Bool {
        let base = StatocystDatabase.appDataDirectory().standardizedFileURL.path
        let roots = ["downloads", "cache", "library"]
        let filePath = fileURL.standardizedFileURL.path
        for name in roots {
            let rootPath = URL(fileURLWithPath: base).appendingPathComponent(name).standardizedFileURL.path
            if filePath.hasPrefix(rootPath + "/") {
                return true
            }
        }
        return false
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "mp3": return "audio/mpeg"
        case "flac": return "audio/flac"
        case "ogg", "oga": return "audio/ogg"
        case "opus": return "audio/opus"
        case "wav", "wave": return "audio/wav"
        case "m4a", "alac": return "audio/mp4"
        case "aac": return "audio/aac"
        case "aif", "aiff": return "audio/aiff"
        default: return "application/octet-stream"
        }
    }

    private static func writeText(fd: Int32, status: Int, reason: String, body: String, extraHeaders: String = "") {
        let bodyData = Data(body.utf8)
        let head = "HTTP/1.1 \(status) \(reason)\r\n"
            + "Content-Type: text/plain; charset=utf-8\r\n"
            + "Content-Length: \(bodyData.count)\r\n"
            + "Connection: close\r\n"
            + extraHeaders
            + "\r\n"
        writeAll(fd: fd, data: Data(head.utf8))
        writeAll(fd: fd, data: bodyData)
    }

    @discardableResult
    private static func writeAll(fd: Int32, data: Data) -> Bool {
        return data.withUnsafeBytes { rawBuffer -> Bool in
            guard let base = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return true }
            var sent = 0
            while sent < data.count {
                let n = Darwin.write(fd, base.advanced(by: sent), data.count - sent)
                if n <= 0 {
                    if errno == EINTR { continue }
                    return false
                }
                sent += n
            }
            return true
        }
    }
}
