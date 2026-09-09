import XCTest
@testable import ChirpberryCore

final class CoreTests: XCTestCase {
    func event(_ object: [String: Any]) throws -> RealtimeEvent { try .decode(JSONSerialization.data(withJSONObject: object)) }
    func testPartialsNeverBecomeSavedSegments() throws {
        var reducer = TranscriptReducer()
        XCTAssertNil(reducer.apply(try event(["type": "transcript.partial", "text": "We shoul"]), channel: "Mic"))
        XCTAssertEqual(reducer.partials["Mic"], "We shoul")
        let final = reducer.apply(try event(["type": "transcript.final", "text": "We should ship.", "timestampMs": 2500]), channel: "Mic", offset: 10)
        XCTAssertEqual(final?.original, "We should ship."); XCTAssertEqual(final?.timestamp, 12.5)
        XCTAssertNil(reducer.partials["Mic"])
    }
    func testTranslationRetainsSourceAndWholeSegmentSpeakerMetadata() throws {
        var reducer = TranscriptReducer()
        let result = reducer.apply(try event(["type": "transcript.final", "text": "We ship Friday.", "rawText": "周五发布。", "translated": true,
            "sourceLanguage": "chinese", "targetLanguage": "english", "utterances": [["speaker": 0, "transcript": "周五发布。", "start": 0, "end": 0]]]), channel: "Call")
        XCTAssertEqual(result?.original, "周五发布。"); XCTAssertEqual(result?.translation, "We ship Friday.")
        XCTAssertEqual(result?.utterances.first?.speaker, 0)
        var meeting = Meeting(); meeting.segments = [result!]; meeting.speakerNames["Call:0"] = "Mei"
        XCTAssertTrue(meeting.transcriptText.contains("Mei: 周五发布。"))
        XCTAssertEqual(meeting.transcriptText.components(separatedBy: "We ship Friday.").count - 1, 1)
    }
    func testDuplicateFinalSuppressedButRepeatedSpeechAndNewSessionsPreserved() throws {
        var reducer = TranscriptReducer()
        let fixed = try event(["type": "transcript.final", "text": "Yes", "timestampMs": 2000])
        XCTAssertNotNil(reducer.apply(fixed, channel: "Mic")); XCTAssertNil(reducer.apply(fixed, channel: "Mic"))
        XCTAssertNotNil(reducer.apply(fixed, channel: "Call"))
        reducer.reset(channel: "Mic"); XCTAssertNotNil(reducer.apply(fixed, channel: "Mic"))
        let repeated = try event(["type": "transcript.final", "text": "Yes"])
        XCTAssertNotNil(reducer.apply(repeated, channel: "Mic")); XCTAssertNotNil(reducer.apply(repeated, channel: "Mic"))
    }
    func testMissingOriginalDoesNotMislabelTranslationAsOriginal() throws {
        var reducer = TranscriptReducer()
        let result = reducer.apply(try event(["type": "transcript.final", "text": "Hello", "translated": true]), channel: "Mic")
        XCTAssertEqual(result?.original, ""); XCTAssertEqual(result?.translation, "Hello")
    }
    func testConfigurationOnlyAcceptsDocumentedTranslationTargets() throws {
        var config = RealtimeConfiguration(); config.target = "invented"
        XCTAssertThrowsError(try config.startMessage())
        config.target = "vietnamese"; config.hints = [" EN ", "en", "VI", "invalid", "12"]
        let object = try JSONSerialization.jsonObject(with: config.startMessage()) as! [String: Any]
        XCTAssertEqual(object["language_hints"] as? [String], ["en", "vi"])
        XCTAssertEqual(object["target_language"] as? String, "vietnamese")
        XCTAssertNil(object["api_key"]); XCTAssertNil(object["bypass_rate_limit"])
    }
    func testAtomicPersistenceAndCorruptFileIsolation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MeetingStore(directory: directory)
        var meeting = Meeting(title: "跨语言" ); meeting.notes = "My original notes"; meeting.enhancedNotes = "Generated notes"
        try store.save(meeting); meeting.notes += " remain editable"; try store.save(meeting)
        let corrupt = directory.appendingPathComponent("bad.json"); try Data("not json".utf8).write(to: corrupt)
        let loaded = try store.load()
        XCTAssertEqual(loaded.meetings.count, 1); XCTAssertEqual(loaded.meetings[0].notes, meeting.notes)
        XCTAssertEqual(loaded.unreadable, ["bad.json"])
        XCTAssertEqual(try String(contentsOf: corrupt, encoding: .utf8), "not json")
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(meeting.id.uuidString + ".json").path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }
    func testJSONRoundTripAndFutureVersionRejected() throws {
        var meeting = Meeting(title: "Planning"); meeting.actions = [.init(description: "Ship", owner: "Mei")]
        let decoded = try MeetingStore.decode(MeetingStore.exportJSON(meeting))
        XCTAssertEqual(decoded.id, meeting.id); XCTAssertEqual(decoded.actions, meeting.actions)
        meeting.schemaVersion = 99
        XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
    }
    func testSummaryStructuredAndRawFallbackAndMalformedResponse() throws {
        let result = try FormattedNotes.parse(JSONSerialization.data(withJSONObject: ["summary": "Ship Friday", "decisions": ["Start small"], "action_items": [["description": "Test audio", "owner": "Mei", "deadline": "Friday"]]]))
        XCTAssertTrue(result.markdown.contains("Start small")); XCTAssertEqual(result.actions.first?.owner, "Mei")
        XCTAssertEqual(try FormattedNotes.parse(Data(#"{"raw_content":"A useful summary"}"#.utf8)).markdown, "A useful summary")
        XCTAssertThrowsError(try FormattedNotes.parse(Data("{}".utf8)))
        XCTAssertThrowsError(try FormattedNotes.parse(Data("[]".utf8)))
    }
    func testSearchFindsTranslationAndExcludesTrash() {
        var visible = Meeting(title: "Supply call"); visible.segments = [.init(timestamp: 0, channel: "Call", original: "周五发布。", translation: "Ship Friday")]
        var trashed = Meeting(title: "Friday"); trashed.isTrashed = true
        XCTAssertEqual(MeetingSearch.search("when do we ship Friday", in: [visible, trashed]).map(\.id), [visible.id])
        XCTAssertTrue(MeetingSearch.search("unmentioned", in: [visible]).isEmpty)
    }
    func testTranslationChunksPreserveUnicodeAndAllContent() {
        let text = String(repeating: "你好🌱 café\n", count: 2000)
        let chunks = ValseaREST.translationChunks(text)
        XCTAssertEqual(chunks.joined(), text); XCTAssertTrue(chunks.allSatisfy { $0.count <= 4000 })
        XCTAssertGreaterThan(chunks.count, 1)
    }
    func testMarkdownPreservesPersonalAndEnhancedNotesAndActions() {
        var meeting = Meeting(title: "Planning"); meeting.notes = "Original"; meeting.enhancedNotes = "Generated"
        var action = ActionItem(description: "Ship", owner: "Lee", deadline: "Friday"); action.completed = true; meeting.actions = [action]
        XCTAssertTrue(meeting.markdown.contains("## My notes\n\nOriginal"))
        XCTAssertTrue(meeting.markdown.contains("## Enhanced notes\n\nGenerated"))
        XCTAssertTrue(meeting.markdown.contains("- [x] Ship · Lee · Friday"))
    }
}
