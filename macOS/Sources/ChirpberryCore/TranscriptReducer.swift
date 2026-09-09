import Foundation

public struct RealtimeEvent: Decodable, Sendable {
    public var type: String
    public var text: String?
    public var rawText: String?
    public var timestampMs: Double?
    public var translated: Bool?
    public var sourceLanguage: String?
    public var targetLanguage: String?
    public var utterances: [SpeakerUtterance]?
    public var code: String?
    public var message: String?
    public var eventID: String?
    enum CodingKeys: String, CodingKey {
        case type, text, rawText, timestampMs, translated, sourceLanguage, targetLanguage, utterances, code, message
        case eventID = "event_id"
    }
    public static func decode(_ data: Data) throws -> Self { try JSONDecoder().decode(Self.self, from: data) }
}

public struct TranscriptReducer: Sendable {
    public private(set) var partials: [String: String] = [:]
    private var seen: Set<String> = []
    public init() {}
    public mutating func reset(channel: String) {
        partials[channel] = nil
        seen = seen.filter { !$0.hasPrefix(channel + "|") }
    }
    public mutating func apply(_ event: RealtimeEvent, channel: String, offset: Double = 0, speakerScope: String? = nil) -> TranscriptSegment? {
        if event.type == "transcript.partial" { partials[channel] = event.text ?? ""; return nil }
        guard event.type == "transcript.final" else { return nil }
        partials[channel] = nil
        guard let text = event.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        // Deduplicate only when the provider gives an identity or timestamp. Repeated speech is valid.
        if let identity = event.eventID ?? event.timestampMs.map({ "\($0)|\(event.rawText ?? text)|\(text)" }) {
            guard seen.insert(channel + "|" + identity).inserted else { return nil }
        }
        let isTranslated = event.translated == true
        return TranscriptSegment(timestamp: offset + max(0, (event.timestampMs ?? 0) / 1000), channel: channel,
                                 original: isTranslated ? (event.rawText ?? "") : text,
                                 translation: isTranslated ? text : nil,
                                 sourceLanguage: event.sourceLanguage, targetLanguage: event.targetLanguage,
                                 utterances: event.utterances ?? [], speakerScope: speakerScope)
    }
}

public struct RealtimeConfiguration: Sendable {
    public var language = "auto"
    public var target: String? = "english"
    public var hints: [String] = []
    public var vocabulary = ""
    public var diarize = false
    public init() {}
    public func startMessage() throws -> Data {
        if let target, !TranslationLanguage.targets.contains(target) { throw CoreError.invalid("Unsupported translation target.") }
        let validHints = Array(Set(hints.map { $0.lowercased().trimmingCharacters(in: .whitespaces) }
            .filter { (2...3).contains($0.count) && $0.allSatisfy { $0.isASCII && $0.isLetter } })).sorted().prefix(20)
        var body: [String: Any] = ["type": "session.start", "model": "valsea-rtt", "language": language,
            "language_hints": Array(validHints), "hint_text": String(vocabulary.prefix(4000)), "diarize": diarize,
            "diarization_min_speakers": 2, "diarization_max_speakers": 6]
        if let target { body["target_language"] = target }
        return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

public enum CoreError: LocalizedError {
    case invalid(String)
    public var errorDescription: String? { if case let .invalid(message) = self { message } else { nil } }
}
