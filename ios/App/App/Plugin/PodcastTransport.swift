import Darwin
import Foundation

struct PodcastFetchResult {
    let status: Int
    let finalUrl: String
    let body: String?
    let contentType: String?
    let etag: String?
    let lastModified: String?
}

/**
 * URLSession transport for podcast directories, feeds and artwork.
 *
 * The shared TypeScript bridge does the RSS/Atom/JSON parsing; this transport
 * only fetches bytes under the same URL-safety, redirect, content-type and size
 * limits as the desktop and Android hosts.
 */
final class PodcastTransport {
    private let userAgent: String
    private let timeout: TimeInterval
    private let sessionConfiguration: URLSessionConfiguration

    init(userAgent: String, timeout: TimeInterval = 30) {
        self.userAgent = userAgent
        self.timeout = timeout
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpShouldSetCookies = false
        self.sessionConfiguration = configuration
    }

    func fetchText(
        _ rawUrl: String,
        allowLocalNetwork: Bool,
        etag: String? = nil,
        lastModified: String? = nil,
        allowHtml: Bool = true
    ) throws -> PodcastFetchResult {
        let url = try Self.validate(rawUrl, allowLocalNetwork: allowLocalNetwork)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(
            "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, " +
                "text/html;q=0.8, application/octet-stream;q=0.1",
            forHTTPHeaderField: "Accept"
        )
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let etag = etag, !etag.isEmpty {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        if let lastModified = lastModified, !lastModified.isEmpty {
            request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since")
        }

        let response = try perform(request, allowLocalNetwork: allowLocalNetwork, maxBytes: 15 * 1024 * 1024)
        if response.status == 304 {
            return PodcastFetchResult(
                status: 304,
                finalUrl: response.finalUrl,
                body: nil,
                contentType: response.contentType,
                etag: response.etag,
                lastModified: response.lastModified
            )
        }
        guard (200...299).contains(response.status) else {
            throw PodcastTransportError.http(response.status)
        }
        let type = baseType(response.contentType)
        let allowed =
            type.contains("xml") ||
            type == "text/html" ||
            type == "application/json" ||
            type == "application/octet-stream" ||
            type == "text/javascript" ||
            type == "application/javascript" ||
            type == "text/plain" ||
            type.isEmpty
        guard allowed else { throw PodcastTransportError.contentType(type) }
        if !allowHtml && type == "text/html" {
            throw PodcastTransportError.contentType(type)
        }
        let body = String(data: response.data, encoding: .utf8)
        return PodcastFetchResult(
            status: response.status,
            finalUrl: response.finalUrl,
            body: body,
            contentType: type.isEmpty ? nil : type,
            etag: response.etag,
            lastModified: response.lastModified
        )
    }

    func fetchImage(_ rawUrl: String, allowLocalNetwork: Bool, maxBytes: Int = 8 * 1024 * 1024) -> Data? {
        do {
            let url = try Self.validate(rawUrl, allowLocalNetwork: allowLocalNetwork)
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue("image/*", forHTTPHeaderField: "Accept")
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            let response = try perform(request, allowLocalNetwork: allowLocalNetwork, maxBytes: maxBytes)
            guard (200...299).contains(response.status) else { return nil }
            let type = baseType(response.contentType)
            guard type.hasPrefix("image/") else { return nil }
            return response.data
        } catch {
            return nil
        }
    }

    // MARK: - Request execution

    private struct Response {
        let status: Int
        let finalUrl: String
        let data: Data
        let contentType: String?
        let etag: String?
        let lastModified: String?
    }

    private func perform(
        _ request: URLRequest,
        allowLocalNetwork: Bool,
        maxBytes: Int
    ) throws -> Response {
        let guardDelegate = RedirectGuard(allowLocalNetwork: allowLocalNetwork)
        let session = URLSession(
            configuration: sessionConfiguration,
            delegate: guardDelegate,
            delegateQueue: nil
        )
        defer { session.finishTasksAndInvalidate() }

        let semaphore = DispatchSemaphore(value: 0)
        var outcome: Result<Response, Error>?
        let task = session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error = error {
                outcome = .failure(error)
                return
            }
            guard let http = response as? HTTPURLResponse else {
                outcome = .failure(PodcastTransportError.unreachable)
                return
            }
            if let declared = http.value(forHTTPHeaderField: "Content-Length"),
               let length = Int(declared),
               length > maxBytes {
                outcome = .failure(PodcastTransportError.tooLarge)
                return
            }
            let body = data ?? Data()
            guard body.count <= maxBytes else {
                outcome = .failure(PodcastTransportError.tooLarge)
                return
            }
            outcome = .success(
                Response(
                    status: http.statusCode,
                    finalUrl: http.url?.absoluteString ?? request.url?.absoluteString ?? "",
                    data: body,
                    contentType: http.value(forHTTPHeaderField: "Content-Type"),
                    etag: http.value(forHTTPHeaderField: "ETag"),
                    lastModified: http.value(forHTTPHeaderField: "Last-Modified")
                )
            )
        }
        task.resume()
        if semaphore.wait(timeout: .now() + timeout + 1) == .timedOut {
            task.cancel()
            throw PodcastTransportError.timeout
        }
        guard let outcome = outcome else { throw PodcastTransportError.unreachable }
        return try outcome.get()
    }

    private func baseType(_ value: String?) -> String {
        guard let value = value else { return "" }
        return value.split(separator: ";", maxSplits: 1).first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
    }

    // MARK: - URL safety

    fileprivate static func validate(_ rawUrl: String, allowLocalNetwork: Bool) throws -> URL {
        guard let url = URL(string: rawUrl),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host,
              !host.isEmpty,
              url.user == nil,
              url.password == nil else {
            throw PodcastTransportError.invalidUrl
        }
        try validateHost(host, allowLocalNetwork: allowLocalNetwork)
        return url
    }

    fileprivate static func validateHost(_ host: String, allowLocalNetwork: Bool) throws {
        var hints = addrinfo(
            ai_flags: 0,
            ai_family: AF_UNSPEC,
            ai_socktype: SOCK_STREAM,
            ai_protocol: 0,
            ai_addrlen: 0,
            ai_canonname: nil,
            ai_addr: nil,
            ai_next: nil
        )
        var result: UnsafeMutablePointer<addrinfo>?
        let status = getaddrinfo(host, nil, &hints, &result)
        guard status == 0, let first = result else {
            throw PodcastTransportError.unreachable
        }
        defer { freeaddrinfo(result) }
        var current: UnsafeMutablePointer<addrinfo>? = first
        while let info = current {
            if let address = info.pointee.ai_addr {
                let text = numericAddress(address)
                if let text = text, !isAllowed(address: text, allowLocalNetwork: allowLocalNetwork) {
                    throw PodcastTransportError.blockedAddress
                }
            }
            current = info.pointee.ai_next
        }
    }

    fileprivate static func numericAddress(_ address: UnsafeMutablePointer<sockaddr>) -> String? {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let length = socklen_t(address.pointee.sa_len)
        let status = getnameinfo(address, length, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
        guard status == 0 else { return nil }
        return String(cString: host)
    }

    fileprivate static func isAllowed(address: String, allowLocalNetwork: Bool) -> Bool {
        let value = address.lowercased()
        if value == "::1" || value.hasPrefix("127.") {
            return allowLocalNetwork
        }
        if value.hasPrefix("169.254.") || value == "::" {
            return false
        }
        if value.hasPrefix("10.") ||
            value.hasPrefix("192.168.") ||
            isPrivate172(value) ||
            value.hasPrefix("fc") ||
            value.hasPrefix("fd") {
            return allowLocalNetwork
        }
        if value.hasPrefix("fe80:") || value.hasPrefix("ff") {
            return false
        }
        if value.hasPrefix("100.") {
            let octet = value.split(separator: ".").first.flatMap { Int($0) } ?? 0
            let second = value.split(separator: ".").dropFirst().first.flatMap { Int($0) } ?? 0
            if octet == 100 && (64...127).contains(second) { return allowLocalNetwork }
        }
        return true
    }

    fileprivate static func isPrivate172(_ value: String) -> Bool {
        let parts = value.split(separator: ".")
        guard parts.count >= 2, parts[0] == "172", let second = Int(parts[1]) else { return false }
        return (16...31).contains(second)
    }
}

private final class RedirectGuard: NSObject, URLSessionTaskDelegate {
    private let allowLocalNetwork: Bool

    init(allowLocalNetwork: Bool) {
        self.allowLocalNetwork = allowLocalNetwork
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let url = request.url,
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            completionHandler(nil)
            return
        }
        // Reuse the same address policy for every redirect hop.
        do {
            _ = try PodcastTransport.validate(url.absoluteString, allowLocalNetwork: allowLocalNetwork)
            completionHandler(request)
        } catch {
            completionHandler(nil)
        }
    }
}

enum PodcastTransportError: Error {
    case invalidUrl
    case blockedAddress
    case unreachable
    case timeout
    case tooLarge
    case contentType(String)
    case http(Int)
}
