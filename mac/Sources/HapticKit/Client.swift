import Foundation

// What HapticKit says to the Haptic server: the same three calls the web
// widget makes (src/server/app.ts). The site's settings on start, one turn for
// every step of a guide, and how the guide ended.
//
// A browser names the page's origin on every call, and the server lets a site
// be used only from the origins it lists. A Mac app has no origin, so it names
// itself by its bundle identifier, as "app://com.acme.desk", and the site
// lists that.

struct HistoryTurn: Codable, Equatable {
    var role: String
    var text: String
}

/** One step's question. The fields and their names are `TurnRequest` in src/shared/types.ts. */
struct TurnRequest: Encodable {
    var site: String
    var visitor: String
    var guide: String
    /** `TURN_VERSION` 2: asks a closing question and sends the date. Acting, version 3, is not built for the Mac. */
    var version = 2
    var today: String
    var goal: String
    var step: Int
    var history: [HistoryTurn]
    var event: String?
    var offTrack: Bool?
    var closing: Bool?
    var snapshot: Snapshot
}

struct Source: Decodable, Equatable {
    var title: String
    var url: String?
}

/** One step's answer: `TurnReply` in src/shared/types.ts, as far as a guide uses it. */
struct TurnReply: Decodable, Equatable {
    var target: String?
    var status: String
    var say: String
    var paused: Bool?
    var blocked: Bool?
    var mode: String?
    var reason: String?
    var sources: [Source]?
}

struct ControlName: Decodable, Equatable {
    var role: String?
    var label: String

    /** True when the element is this control. Labels are compared without regard to case or spacing. */
    func matches(_ element: SnapElement) -> Bool {
        let words = { (text: String) in text.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased() }
        let name = words(element.label.isEmpty ? (element.icon.map { "icon:\($0)" } ?? "") : element.label)
        return !name.isEmpty && name == words(label) && (role == nil || role == "" || role == element.role)
    }
}

struct SiteConfig: Decodable {
    struct Appearance: Decodable {
        var accent: String?
        var position: String?
        var launcherLabel: String?
        var launcher: String?
    }
    var name: String
    var appearance: Appearance?
    var off: Bool?
    var blocked: [ControlName]?
}

struct ServerError: Error, Equatable {
    var status: Int
    var message: String
}

struct Client {
    var server: URL
    var site: String
    /** "app://" and the app's bundle identifier. */
    var origin: String
    var session: URLSession = .shared

    static func origin(for appID: String) -> String { "app://" + appID }

    private func request(_ path: String, method: String = "GET", body: Data? = nil, accept: String? = nil) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue(origin, forHTTPHeaderField: "Origin")
        if let accept { request.setValue(accept, forHTTPHeaderField: "Accept") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.timeoutInterval = 60
        return request
    }

    private static func failure(_ data: Data, _ response: URLResponse) -> ServerError? {
        guard let http = response as? HTTPURLResponse, http.statusCode >= 400 else { return nil }
        let said = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        return ServerError(status: http.statusCode, message: said ?? "The server answered \(http.statusCode).")
    }

    func config() async throws -> SiteConfig {
        let (data, response) = try await session.data(for: request("v1/sites/\(site)"))
        if let failure = Self.failure(data, response) { throw failure }
        return try JSONDecoder().decode(SiteConfig.self, from: data)
    }

    /**
     * One step. The server sends it a line at a time: the control to point at
     * the moment the model has named it, then the whole reply. `onTarget` is
     * called with the first, so the pointer starts moving before the sentence
     * is written.
     */
    func turn(_ turn: TurnRequest, onTarget: @escaping @MainActor (String) -> Void) async throws -> TurnReply {
        let body = try JSONEncoder().encode(turn)
        let (bytes, response) = try await session.bytes(for: request("v1/turn", method: "POST", body: body, accept: "application/x-ndjson"))
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            throw Self.failure(data, response) ?? ServerError(status: http.statusCode, message: "The server answered \(http.statusCode).")
        }
        for try await line in bytes.lines {
            switch try Self.parse(line: line) {
            case .target(let id): await onTarget(id)
            case .reply(let reply): return reply
            case .other: continue
            }
        }
        throw ServerError(status: 502, message: "The answer stopped before it was finished.")
    }

    enum Line: Equatable {
        case target(String)
        case reply(TurnReply)
        /** A line this version has no use for, like the one that says an answer in words is coming. */
        case other
    }

    static func parse(line: String) throws -> Line {
        guard let data = line.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .other }
        if let error = object["error"] as? String { throw ServerError(status: (object["code"] as? Int) ?? 500, message: error) }
        if object["status"] != nil { return .reply(try JSONDecoder().decode(TurnReply.self, from: data)) }
        if let target = object["target"] as? String { return .target(target) }
        return .other
    }

    /** How the guide ended. Sent and forgotten: nothing waits on it. */
    func report(guide: String, outcome: String, step: Int?) {
        var body: [String: Any] = ["site": site, "outcome": outcome]
        if let step { body["step"] = step }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        let request = request("v1/guides/\(guide)/report", method: "POST", body: data)
        session.dataTask(with: request).resume()
    }
}
