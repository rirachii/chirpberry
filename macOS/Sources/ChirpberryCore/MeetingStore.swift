import Foundation

public struct MeetingStore: Sendable {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }
    public static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Chirpberry/Meetings", isDirectory: true)
    }
    public func save(_ meeting: Meeting) throws {
        let data = try Self.exportJSON(meeting)
        _ = try Self.decode(data)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                              attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent(meeting.id.uuidString + ".json")
        try data.write(to: url, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public func load() throws -> (meetings: [Meeting], unreadable: [String]) {
        guard FileManager.default.fileExists(atPath: directory.path) else { return ([], []) }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey])
        var meetings: [Meeting] = []; var unreadable: [String] = []
        for url in files where url.pathExtension == "json" {
            do {
                guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
                let meeting = try Self.decode(Data(contentsOf: url))
                guard url.deletingPathExtension().lastPathComponent == meeting.id.uuidString else { throw CoreError.invalid("Meeting ID mismatch") }
                meetings.append(meeting)
            } catch { unreadable.append(url.lastPathComponent) }
        }
        return (meetings.sorted { $0.updatedAt > $1.updatedAt }, unreadable)
    }
    public static func decode(_ data: Data) throws -> Meeting {
        guard data.count <= 32 * 1024 * 1024 else { throw CoreError.invalid("Meeting file exceeds 32 MB.") }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        let value = try decoder.decode(Meeting.self, from: data)
        guard value.schemaVersion == 1 else { throw CoreError.invalid("This meeting uses a newer file format.") }
        guard Meeting.isValidTimestamp(value.duration), value.segments.allSatisfy({ segment in
            Meeting.isValidTimestamp(segment.timestamp) && segment.utterances.allSatisfy { utterance in
                (utterance.start.map(Meeting.isValidTimestamp) ?? true) &&
                (utterance.end.map(Meeting.isValidTimestamp) ?? true)
            }
        }) else { throw CoreError.invalid("Meeting timestamps must be finite, nonnegative, and within the supported range.") }
        return value
    }
    public static func exportJSON(_ meeting: Meeting) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(meeting)
    }
}

public struct SearchHit: Identifiable, Sendable {
    public var id: UUID { meeting.id }
    public var meeting: Meeting
    public var score: Int
    public var excerpt: String
}

public enum MeetingSearch {
    public static func search(_ query: String, in meetings: [Meeting], limit: Int = 10) -> [SearchHit] {
        let ignored: Set<String> = ["what", "when", "where", "who", "how", "did", "was", "were", "the", "and", "for", "are", "our", "with", "about", "this", "that"]
        let tokens = Set(query.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)).subtracting(ignored)
        return meetings.filter { !$0.isTrashed }.compactMap { meeting in
            let content = meeting.searchableText
            let lower = content.lowercased()
            let score = tokens.reduce(0) { $0 + (lower.contains($1) ? 1 : 0) + (meeting.title.lowercased().contains($1) ? 2 : 0) }
            guard score > 0 || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            let lines = content.components(separatedBy: .newlines).filter { line in tokens.contains { line.lowercased().contains($0) } }
            return SearchHit(meeting: meeting, score: score, excerpt: String((lines.isEmpty ? content : lines.joined(separator: "\n")).prefix(2200)))
        }.sorted { $0.score == $1.score ? $0.meeting.updatedAt > $1.meeting.updatedAt : $0.score > $1.score }.prefix(max(0, limit)).map { $0 }
    }
}
