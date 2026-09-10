import Foundation

public struct TranscriptSegment: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var timestamp: Double
    public var channel: String
    public var original: String
    public var translation: String?
    public var sourceLanguage: String?
    public var targetLanguage: String?
    public var utterances: [SpeakerUtterance]
    public var speakerScope: String?
    public init(id: UUID = UUID(), timestamp: Double, channel: String, original: String,
                translation: String? = nil, sourceLanguage: String? = nil, targetLanguage: String? = nil,
                utterances: [SpeakerUtterance] = [], speakerScope: String? = nil) {
        self.id = id; self.timestamp = max(0, timestamp); self.channel = channel
        self.original = original; self.translation = translation
        self.sourceLanguage = sourceLanguage; self.targetLanguage = targetLanguage; self.utterances = utterances
        self.speakerScope = speakerScope
    }
}

public struct SpeakerUtterance: Codable, Equatable, Sendable {
    public var speaker: Int?
    public var transcript: String
    public var start: Double?
    public var end: Double?
    public init(speaker: Int?, transcript: String, start: Double? = nil, end: Double? = nil) {
        self.speaker = speaker; self.transcript = transcript; self.start = start; self.end = end
    }
}

public struct ActionItem: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID = UUID()
    public var description: String
    public var owner: String?
    public var deadline: String?
    public var completed = false
    public init(description: String, owner: String? = nil, deadline: String? = nil) {
        self.description = description; self.owner = owner; self.deadline = deadline
    }
}

public enum NoteTemplate: String, Codable, CaseIterable, Sendable {
    case meeting = "meeting_minutes", sales = "sales_summary", support = "service_log"
    public var title: String { switch self { case .meeting: "Meeting notes"; case .sales: "Sales call"; case .support: "Support conversation" } }
}

public struct Meeting: Codable, Identifiable, Equatable, Sendable {
    public var schemaVersion = 1
    public var id: UUID = UUID()
    public var title = "Untitled meeting"
    public var createdAt = Date()
    public var updatedAt = Date()
    public var notebook = "Inbox"
    public var notes = ""
    public var enhancedNotes = ""
    public var actions: [ActionItem] = []
    public var segments: [TranscriptSegment] = []
    public var speakerNames: [String: String] = [:]
    public var template: NoteTemplate = .meeting
    public var targetLanguage = "english"
    public var vocabulary = ""
    public var calendarID: String?
    public var attendees: [String] = []
    public var duration: Double = 0
    public var isTrashed = false
    public var isPinned = false
    // Optional for backwards-compatible decoding of existing version-1 notebooks.
    public var entryKind: String?
    public var isScratchpad: Bool { entryKind == "scratchpad" }
    public init(title: String = "Untitled meeting") { self.title = title }

    public func speakerName(channel: String, speaker: Int? = nil, scope: String? = nil) -> String {
        let key = Self.speakerKey(channel: channel, speaker: speaker, scope: scope)
        return speakerNames[key] ?? speaker.map { "\(channel) · Speaker \($0 + 1)" } ?? channel
    }
    public static func speakerKey(channel: String, speaker: Int?, scope: String?) -> String {
        speaker.map { "\(channel):\(scope.map { $0 + ":" } ?? "")\($0)" } ?? channel
    }
    public var searchableText: String {
        var parts = [title, notebook, notes, enhancedNotes]
        parts += attendees
        parts += Array(speakerNames.values)
        parts += segments.flatMap { [$0.original, $0.translation ?? ""] }
        return parts.joined(separator: "\n")
    }
    public var transcriptText: String {
        segments.map { segment in
            let source = segment.utterances.isEmpty ? "\(speakerName(channel: segment.channel)): \(segment.original)" :
                segment.utterances.map { "\(speakerName(channel: segment.channel, speaker: $0.speaker, scope: segment.speakerScope)): \($0.transcript)" }.joined(separator: "\n")
            return "[\(Self.timeLabel(segment.timestamp))] \(source)" +
                (segment.translation.map { "\nTranslation (\(segment.targetLanguage ?? targetLanguage)): \($0)" } ?? "")
        }.joined(separator: "\n\n")
    }
    public var markdown: String {
        var sections = ["# \(title)", "\(createdAt.formatted(date: .abbreviated, time: .shortened)) · \(notebook)"]
        if !notes.isEmpty { sections.append("## My notes\n\n\(notes)") }
        if !enhancedNotes.isEmpty { sections.append("## Enhanced notes\n\n\(enhancedNotes)") }
        if !actions.isEmpty {
            sections.append("## Actions\n\n" + actions.map {
                "- [\($0.completed ? "x" : " ")] \($0.description)" + ($0.owner.map { " · \($0)" } ?? "") + ($0.deadline.map { " · \($0)" } ?? "")
            }.joined(separator: "\n"))
        }
        if !segments.isEmpty { sections.append("## Transcript\n\n\(transcriptText)") }
        return sections.joined(separator: "\n\n") + "\n"
    }
    public static func timeLabel(_ seconds: Double) -> String {
        let value = max(0, Int(seconds.isFinite ? seconds : 0))
        return String(format: "%02d:%02d", value / 60, value % 60)
    }
}

public enum TranslationLanguage {
    public static let targets = ["english", "chinese", "japanese", "korean", "vietnamese", "thai", "french", "spanish", "german", "russian", "indonesian", "malay", "filipino", "tamil", "khmer", "lao"]
}
