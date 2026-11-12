import Foundation
import CryptoKit

struct JellyfinSession: Codable, Equatable {
    let serverId: String
    let url: String
    let userId: String
    let token: String
}

enum JellyfinSessions {
    private static let SUITE_KEY = "statocyst.jellyfin_sessions"
    private static let lock = NSLock()

    static func all() -> [JellyfinSession] {
        lock.lock()
        defer { lock.unlock() }
        return parse(UserDefaults.standard.string(forKey: SUITE_KEY))
    }

    static func any() -> Bool {
        return !all().isEmpty
    }

    static func get(_ serverId: String?) -> JellyfinSession? {
        guard let serverId = serverId, !serverId.isEmpty else { return nil }
        return all().first { $0.serverId == serverId }
    }

    static func forTrack(_ track: MediaItemEntity) -> JellyfinSession? {
        return get(track.serverId) ?? all().first
    }

    static func forUri(_ uri: String?) -> JellyfinSession? {
        guard let uri = uri, !uri.isEmpty else { return nil }
        let sessions = all().filter { JellyfinAuth.isServerUri(serverUrl: $0.url, uri: uri) }
        if sessions.count <= 1 { return sessions.first }
        let path = URL(string: uri)?.path ?? ""
        let matching = sessions.filter { path.hasPrefix(basePath($0.url)) }
        return matching.max(by: { basePath($0.url).count < basePath($1.url).count }) ?? sessions.first
    }

    static func save(_ session: JellyfinSession) {
        lock.lock()
        defer { lock.unlock() }
        let current = parse(UserDefaults.standard.string(forKey: SUITE_KEY))
        let trimmedTarget = session.url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let next = current.filter {
            $0.serverId != session.serverId &&
                $0.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) != trimmedTarget
        } + [session]
        write(next)
    }

    static func remove(_ serverId: String) {
        lock.lock()
        defer { lock.unlock() }
        let current = parse(UserDefaults.standard.string(forKey: SUITE_KEY))
        write(current.filter { $0.serverId != serverId })
    }

    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        UserDefaults.standard.removeObject(forKey: SUITE_KEY)
    }

    private static func basePath(_ url: String) -> String {
        return (URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines))?.path ?? "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func write(_ sessions: [JellyfinSession]) {
        if let data = try? JSONEncoder().encode(sessions),
           let str = String(data: data, encoding: .utf8) {
            UserDefaults.standard.set(str, forKey: SUITE_KEY)
        }
    }

    private static func parse(_ raw: String?) -> [JellyfinSession] {
        guard let raw = raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([JellyfinSession].self, from: data)) ?? []
    }
}

enum JellyfinAuth {
    private static let CLIENT = "Statocyst"
    private static let DEVICE = "Statocyst iOS"
    private static let VERSION = "1.9.0"

    static func header(token: String? = nil) -> String {
        var parts = [
            "Client=\"\(CLIENT)\"",
            "Device=\"\(DEVICE)\"",
            "DeviceId=\"statocyst-ios\"",
            "Version=\"\(VERSION)\""
        ]
        if let token = token, !token.isEmpty {
            parts.append("Token=\"\(token)\"")
        }
        return "MediaBrowser \(parts.joined(separator: ", "))"
    }

    static func streamUrl(serverUrl: String, itemId: String) -> String {
        let base = serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return "\(base)/Audio/\(itemId)/stream?static=true"
    }

    static func transcodeUrl(serverUrl: String, itemId: String, bitsPerSecond: Int64) -> String {
        let base = serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return "\(base)/Audio/\(itemId)/stream.mp3?audioCodec=mp3&audioBitRate=\(bitsPerSecond)"
    }

    static func isServerUri(serverUrl: String?, uri: String?) -> Bool {
        guard let s = serverUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              let u = uri?.trimmingCharacters(in: .whitespacesAndNewlines),
              let a = URL(string: s),
              let b = URL(string: u),
              let aScheme = a.scheme?.lowercased(),
              let bScheme = b.scheme?.lowercased(),
              let aHost = a.host?.lowercased(),
              let bHost = b.host?.lowercased() else {
            return false
        }
        return aScheme == bScheme && aHost == bHost && port(of: a) == port(of: b)
    }

    private static func port(of url: URL) -> Int {
        if let p = url.port { return p }
        return url.scheme?.lowercased() == "https" ? 443 : 80
    }
}

struct JellyfinServerInfo {
    let baseUrl: String
    let id: String
    let name: String
    let version: String
}

struct JellyfinAuthResult {
    let serverId: String
    let accessToken: String
    let userId: String
    let userName: String
}

struct QuickConnectInit {
    let secret: String
    let code: String
}

enum JellyfinClient {
    private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _ session: URLSession,
            task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest,
            completionHandler: @escaping (URLRequest?) -> Void
        ) {
            completionHandler(nil)
        }
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }()

    private static func request(
        method: String,
        url: String,
        token: String? = nil,
        body: Data? = nil,
        timeout: TimeInterval = 15
    ) throws -> (Int, Data) {
        guard let parsed = URL(string: url) else {
            throw NSError(domain: "JellyfinClient", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        var req = URLRequest(url: parsed, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(JellyfinAuth.header(token: token), forHTTPHeaderField: "Authorization")
        if let body = body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if method == "POST" {
            req.httpBody = Data()
        }

        let sem = DispatchSemaphore(value: 0)
        var statusCode = 0
        var responseData = Data()
        var requestError: Error?

        let task = session.dataTask(with: req) { data, response, error in
            if let error = error {
                requestError = error
            } else {
                statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                responseData = data ?? Data()
            }
            sem.signal()
        }
        task.resume()
        sem.wait()

        if let error = requestError {
            throw error
        }
        return (statusCode, responseData)
    }

    static func discover(baseUrl: String) throws -> JellyfinServerInfo {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let (code, data) = try request(method: "GET", url: "\(url)/System/Info/Public")
        guard code == 200 else {
            throw NSError(domain: "JellyfinClient", code: code, userInfo: [NSLocalizedDescriptionKey: "Server unreachable (HTTP \(code))"])
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "JellyfinClient", code: 500, userInfo: [NSLocalizedDescriptionKey: "Invalid JSON response"])
        }
        guard (json["ProductName"] as? String) == "Jellyfin Server" else {
            throw NSError(domain: "JellyfinClient", code: 400, userInfo: [NSLocalizedDescriptionKey: "Not a Jellyfin server"])
        }
        guard let id = json["Id"] as? String, !id.isEmpty else {
            throw NSError(domain: "JellyfinClient", code: 500, userInfo: [NSLocalizedDescriptionKey: "Missing Server Id"])
        }
        let name = (json["ServerName"] as? String) ?? "Jellyfin"
        let version = (json["Version"] as? String) ?? ""
        return JellyfinServerInfo(baseUrl: url, id: id, name: name, version: version)
    }

    static func authenticate(baseUrl: String, username: String, password: String) throws -> JellyfinAuthResult {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let body = try JSONSerialization.data(withJSONObject: ["Username": username, "Pw": password])
        let (code, data) = try request(method: "POST", url: "\(url)/Users/AuthenticateByName", body: body)
        guard code == 200 else {
            throw NSError(domain: "JellyfinClient", code: code, userInfo: [NSLocalizedDescriptionKey: "Authentication failed (HTTP \(code))"])
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = json["User"] as? [String: Any],
              let accessToken = json["AccessToken"] as? String,
              let serverId = json["ServerId"] as? String,
              let userId = user["Id"] as? String,
              let userName = user["Name"] as? String else {
            throw NSError(domain: "JellyfinClient", code: 500, userInfo: [NSLocalizedDescriptionKey: "Malformed auth response"])
        }
        if let discovered = try? discover(baseUrl: url), discovered.id != serverId {
            throw NSError(domain: "JellyfinClient", code: 403, userInfo: [NSLocalizedDescriptionKey: "Server identity mismatch"])
        }
        return JellyfinAuthResult(serverId: serverId, accessToken: accessToken, userId: userId, userName: userName)
    }

    static func probeStream(baseUrl: String, itemId: String, token: String) -> Bool {
        let url = JellyfinAuth.streamUrl(serverUrl: baseUrl, itemId: itemId)
        guard let parsed = URL(string: url) else { return false }
        var req = URLRequest(url: parsed, timeoutInterval: 4.0)
        req.httpMethod = "HEAD"
        req.setValue("*/*", forHTTPHeaderField: "Accept")
        req.setValue(JellyfinAuth.header(token: token), forHTTPHeaderField: "Authorization")

        let sem = DispatchSemaphore(value: 0)
        var ok = false
        let task = session.dataTask(with: req) { _, response, error in
            if error == nil, let code = (response as? HTTPURLResponse)?.statusCode {
                ok = (200...299).contains(code)
            }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 4.0)
        return ok
    }

    static func instantMix(baseUrl: String, userId: String, token: String, itemId: String, limit: Int) throws -> [String] {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let (code, data) = try request(
            method: "GET",
            url: "\(url)/Items/\(itemId)/InstantMix?userId=\(userId)&limit=\(limit)",
            token: token
        )
        guard code == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = json["Items"] as? [[String: Any]] else {
            return []
        }
        return items.compactMap { ($0["Id"] as? String).flatMap { $0.isEmpty ? nil : $0 } }
    }

    static func listAudioItems(
        baseUrl: String,
        userId: String,
        token: String,
        startIndex: Int = 0,
        limit: Int = 200
    ) throws -> ([[String: Any]], Int) {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpoint = "\(url)/Users/\(userId)/Items?Recursive=true&IncludeItemTypes=Audio&Fields=MediaSources,Genres&EnableImages=true&SortBy=SortName&SortOrder=Ascending&StartIndex=\(startIndex)&Limit=\(limit)"
        let (code, data) = try request(method: "GET", url: endpoint, token: token, timeout: 30)
        guard code == 200 else {
            throw NSError(domain: "JellyfinClient", code: code, userInfo: [NSLocalizedDescriptionKey: "Browse failed (HTTP \(code))"])
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = json["Items"] as? [[String: Any]] else {
            throw NSError(domain: "JellyfinClient", code: 500, userInfo: [NSLocalizedDescriptionKey: "Malformed library response"])
        }
        let total = (json["TotalRecordCount"] as? Int) ?? items.count
        return (items, total)
    }

    static func initiateQuickConnect(baseUrl: String) throws -> QuickConnectInit {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let (code, data) = try request(method: "POST", url: "\(url)/QuickConnect/Initiate")
        guard code == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let secret = json["Secret"] as? String,
              let qcCode = json["Code"] as? String else {
            throw NSError(domain: "JellyfinClient", code: code, userInfo: [NSLocalizedDescriptionKey: "Quick Connect unavailable (HTTP \(code))"])
        }
        return QuickConnectInit(secret: secret, code: qcCode)
    }

    static func quickConnectStatus(baseUrl: String, secret: String) throws -> Bool {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let encodedSecret = secret.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw NSError(domain: "JellyfinClient", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid Quick Connect secret"])
        }
        let (code, data) = try request(method: "GET", url: "\(url)/QuickConnect/Connect?secret=\(encodedSecret)")
        // Jellyfin returns 404 once the code expires or was already exchanged.
        // Without this the UI would keep saying "Waiting for approval" forever.
        if code == 404 {
            throw NSError(domain: "JellyfinClient", code: 404, userInfo: [NSLocalizedDescriptionKey: "Quick Connect code expired. Start again for a new code."])
        }
        guard code == 200 else {
            throw NSError(domain: "JellyfinClient", code: code, userInfo: [NSLocalizedDescriptionKey: "Quick Connect unavailable (HTTP \(code))"])
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "JellyfinClient", code: 500, userInfo: [NSLocalizedDescriptionKey: "Malformed Quick Connect response"])
        }
        return (json["Authenticated"] as? Bool) ?? false
    }

    static func authenticateWithQuickConnect(baseUrl: String, secret: String) throws -> JellyfinAuthResult {
        let url = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let body = try JSONSerialization.data(withJSONObject: ["Secret": secret])
        let (code, data) = try request(method: "POST", url: "\(url)/Users/AuthenticateWithQuickConnect", body: body)
        guard code == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = json["User"] as? [String: Any],
              let accessToken = json["AccessToken"] as? String,
              let serverId = json["ServerId"] as? String,
              let userId = user["Id"] as? String,
              let userName = user["Name"] as? String else {
            throw NSError(domain: "JellyfinClient", code: code, userInfo: [NSLocalizedDescriptionKey: "Quick Connect authentication failed (HTTP \(code))"])
        }
        return JellyfinAuthResult(serverId: serverId, accessToken: accessToken, userId: userId, userName: userName)
    }
}

enum JellyfinArtwork {
    private static let MAX_BYTES = 6 * 1024 * 1024
    private static let MAX_CACHE_BYTES: Int64 = 64 * 1024 * 1024

    static func isValidId(_ id: String?) -> Bool {
        guard let id = id, (1...64).contains(id.count) else { return false }
        return id.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
    }

    static func isValidTag(_ tag: String?) -> Bool {
        guard let tag = tag, tag.count <= 128 else { return false }
        return tag.allSatisfy { $0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-" }
    }

    static func sniffMime(_ head: Data) -> String? {
        let bytes = [UInt8](head)
        if bytes.count >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
            return "image/jpeg"
        }
        if bytes.count >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 {
            return "image/png"
        }
        if bytes.count >= 12 &&
            String(bytes: bytes[0..<4], encoding: .isoLatin1) == "RIFF" &&
            String(bytes: bytes[8..<12], encoding: .isoLatin1) == "WEBP" {
            return "image/webp"
        }
        if bytes.count >= 4 && String(bytes: bytes[0..<4], encoding: .isoLatin1) == "GIF8" {
            return "image/gif"
        }
        return nil
    }

    static func cacheKey(serverUrl: String, itemId: String, tag: String, height: Int) -> String {
        let raw = "\(serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")))|\(itemId)|\(tag)|\(height)"
        let digest = SHA256.hash(data: Data(raw.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func fetch(itemId: String, tag: String, height: Int = 300, serverId: String? = nil) -> URL? {
        guard isValidId(itemId), isValidTag(tag) else { return nil }
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let dir = caches.appendingPathComponent("jf-art", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let sessions = JellyfinSessions.all()
        let hinted = sessions.first { $0.serverId == serverId }
        let order = hinted != nil ? [hinted!] : sessions

        for session in order {
            let cached = dir.appendingPathComponent(cacheKey(serverUrl: session.url, itemId: itemId, tag: tag, height: height))
            if FileManager.default.fileExists(atPath: cached.path),
               let size = (try? FileManager.default.attributesOfItem(atPath: cached.path)[.size] as? Int64),
               size > 0 {
                return cached
            }
        }
        for session in order {
            if let downloaded = download(serverUrl: session.url, token: session.token, itemId: itemId, tag: tag, height: height, dir: dir) {
                return downloaded
            }
        }
        return nil
    }

    static func download(serverUrl: String, token: String, itemId: String, tag: String, height: Int, dir: URL) -> URL? {
        guard isValidId(itemId), isValidTag(tag) else { return nil }
        let target = dir.appendingPathComponent(cacheKey(serverUrl: serverUrl, itemId: itemId, tag: tag, height: height))
        if FileManager.default.fileExists(atPath: target.path),
           let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? Int64),
           size > 0 {
            return target
        }
        var query = "?maxHeight=\(height)"
        if !tag.isEmpty { query += "&tag=\(tag)" }
        let urlStr = "\(serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/Items/\(itemId)/Images/Primary\(query)"
        guard let url = URL(string: urlStr) else { return nil }

        var req = URLRequest(url: url, timeoutInterval: 10)
        req.setValue(JellyfinAuth.header(token: token), forHTTPHeaderField: "Authorization")

        let sem = DispatchSemaphore(value: 0)
        var fetchedData: Data?
        let task = URLSession.shared.dataTask(with: req) { data, response, error in
            if error == nil,
               let http = response as? HTTPURLResponse,
               http.statusCode == 200,
               let data = data,
               !data.isEmpty,
               data.count <= MAX_BYTES {
                fetchedData = data
            }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 12)

        guard let bytes = fetchedData,
              sniffMime(bytes.prefix(16)) != nil else {
            return nil
        }
        try? bytes.write(to: target, options: .atomic)
        return target
    }
}

enum ExternalArt {
    private static let PREF = "statocyst.external_art_enabled"

    static func enabled() -> Bool {
        return UserDefaults.standard.bool(forKey: PREF)
    }

    static func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: PREF)
    }
}
