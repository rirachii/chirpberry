import XCTest
import ChirpberryCore

final class DocumentRegressionTests: XCTestCase {
    func testInvalidSpeakerIndicesAreRejectedAndCannotOverflowLabels() throws {
        for speaker in [Int.max, -1, Int.min] {
            let utterance = SpeakerUtterance(speaker: speaker, transcript: "Synthetic speaker text")
            let data = try JSONEncoder().encode(utterance)
            XCTAssertThrowsError(try JSONDecoder().decode(SpeakerUtterance.self, from: data))
            var meeting = Meeting()
            meeting.segments = [.init(timestamp: 0, channel: "Fixture", original: "Synthetic text", utterances: [utterance])]
            XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
            XCTAssertEqual(meeting.speakerName(channel: "Fixture", speaker: speaker), "Fixture · Unknown speaker")
            XCTAssertTrue(meeting.markdown.contains("Unknown speaker: Synthetic speaker text"))
            let event = try JSONSerialization.data(withJSONObject: ["type": "transcript.final", "text": "Synthetic text",
                                                                   "utterances": [["speaker": speaker, "transcript": "Synthetic text"]]])
            XCTAssertThrowsError(try RealtimeEvent.decode(event))
        }
        for speaker in [nil, 0, Int.max - 1] as [Int?] {
            let utterance = SpeakerUtterance(speaker: speaker, transcript: "Valid synthetic speaker")
            XCTAssertEqual(try JSONDecoder().decode(SpeakerUtterance.self, from: JSONEncoder().encode(utterance)), utterance)
        }
        XCTAssertEqual(Meeting().speakerName(channel: "Fixture", speaker: Int.max - 1), "Fixture · Speaker \(Int.max)")
    }

    func testTimestampFormattingHandlesHugeAndNonfiniteValues() {
        XCTAssertEqual(Meeting.timeLabel(65.9), "01:05")
        XCTAssertEqual(Meeting.timeLabel(-1e30), "00:00")
        XCTAssertEqual(Meeting.timeLabel(.infinity), "00:00")
        XCTAssertEqual(Meeting.timeLabel(.nan), "00:00")
        XCTAssertEqual(Meeting.timeLabel(1e30), Meeting.timeLabel(Meeting.maximumTimestamp))
        XCTAssertEqual(Meeting.timeLabel(Double(Int.max)), Meeting.timeLabel(Meeting.maximumTimestamp))
        XCTAssertEqual(Meeting.timeLabel(1e12), "16666666666:40")
    }

    func testImportedTimingBoundsApplyToEveryTimingField() throws {
        var original = Meeting()
        original.segments = [.init(timestamp: 1, channel: "Fixture", original: "Synthetic text", utterances: [.init(speaker: 0, transcript: "Synthetic text", start: 0, end: 1)])]
        for value in [-1.0, 1e30, Double(Int.max)] {
            var meeting = original; meeting.duration = value
            XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
            meeting = original; meeting.segments[0].timestamp = value
            XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
            meeting = original; meeting.segments[0].utterances[0].start = value
            XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
            meeting = original; meeting.segments[0].utterances[0].end = value
            XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
        }
        original.duration = Meeting.maximumTimestamp
        original.segments[0].timestamp = Meeting.maximumTimestamp
        let valid = try MeetingStore.decode(MeetingStore.exportJSON(original))
        XCTAssertFalse(valid.markdown.isEmpty)
    }

    func testPrettyPrintedImportCannotReplaceDurableFileWithOversizedSave() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".build/regression-fixtures/\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = MeetingStore(directory: root)
        var meeting = Meeting(); meeting.notes = "Durable original"; try store.save(meeting)
        let file = root.appendingPathComponent(meeting.id.uuidString + ".json")
        let original = try Data(contentsOf: file)
        meeting.notes = ""; meeting.attendees = Array(repeating: "", count: 1000)
        let compact = JSONEncoder(); compact.dateEncodingStrategy = .iso8601
        let overhead = try compact.encode(meeting).count
        meeting.notes = String(repeating: "x", count: 32 * 1024 * 1024 - overhead)
        let imported = try MeetingStore.decode(compact.encode(meeting))
        let recovery = try MeetingStore.exportJSON(imported)
        XCTAssertGreaterThan(recovery.count, 32 * 1024 * 1024)
        XCTAssertThrowsError(try store.save(imported))
        XCTAssertEqual(try Data(contentsOf: file), original)
        XCTAssertEqual(try store.load().meetings.first?.notes, "Durable original")
        XCTAssertEqual(imported.notes.count, meeting.notes.count)
        XCTAssertTrue(imported.markdown.contains(meeting.notes))
        meeting.notes = "Recovered within the limit"
        try store.save(meeting)
        XCTAssertEqual(try store.load().meetings.first?.notes, meeting.notes)
    }

    func testActionsAloneRemainEnhancedAndRoundTripWithCompletion() throws {
        let result = try FormattedNotes.parse(Data(#"{"action_items":[{"description":"Review the transcript","owner":"Mei"}]}"#.utf8))
        var meeting = Meeting(); meeting.notes = "Original notes"
        XCTAssertFalse(meeting.hasEnhancedContent)
        meeting.enhancedNotes = result.markdown; meeting.actions = result.actions
        XCTAssertTrue(meeting.enhancedNotes.isEmpty)
        XCTAssertTrue(meeting.hasEnhancedContent)
        meeting.actions[0].completed = true
        let restored = try MeetingStore.decode(MeetingStore.exportJSON(meeting))
        XCTAssertTrue(restored.hasEnhancedContent)
        XCTAssertTrue(restored.actions[0].completed)
        XCTAssertTrue(restored.markdown.contains("- [x] Review the transcript"))
        XCTAssertEqual(restored.notes, "Original notes")
    }
}
