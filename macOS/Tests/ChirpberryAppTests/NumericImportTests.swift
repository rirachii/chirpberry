import XCTest
import ChirpberryCore

final class NumericImportTests: XCTestCase {
    @MainActor func testInvalidJSONImportNeverAddsOrPersistsDocumentsAndPreservesInput() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let documents = root.appendingPathComponent("documents"), source = root.appendingPathComponent("invalid.json")
        let model = NotebookModel(directory: documents)
        let id = model.createMeeting(title: "Existing notes")
        model.update(id, { $0.notes = "Keep these notes" }, immediate: true)
        let saved = try Data(contentsOf: documents.appendingPathComponent(id.uuidString + ".json"))
        for invalidSpeaker in [false, true] {
            var meeting = Meeting(title: "Invalid import")
            meeting.segments = [.init(timestamp: invalidSpeaker ? 1 : 1e30, channel: "Imported", original: "Fixture",
                                      utterances: [.init(speaker: invalidSpeaker ? Int.max : 0, transcript: "Fixture")])]
            let bytes = try MeetingStore.exportJSON(meeting); try bytes.write(to: source)
            await model.importFile(source)
            XCTAssertEqual(model.meetings.count, 1)
            XCTAssertEqual(model.selectedID, id)
            XCTAssertTrue(model.message?.contains("supported range") == true)
            XCTAssertEqual(try Data(contentsOf: source), bytes)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: documents.path), [id.uuidString + ".json"])
            XCTAssertEqual(try Data(contentsOf: documents.appendingPathComponent(id.uuidString + ".json")), saved)
        }
    }
}
