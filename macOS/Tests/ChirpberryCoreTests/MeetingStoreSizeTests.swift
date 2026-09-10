import Foundation
import XCTest
@testable import ChirpberryCore

final class MeetingStoreSizeTests: XCTestCase {
    func testExactSerializedLimitReloadsAndOversizedReplacementPreservesOriginal() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MeetingStore(directory: directory)
        var meeting = Meeting(title: "Original")
        let overhead = try MeetingStore.exportJSON(meeting).count
        meeting.notes = String(repeating: "\0", count: (MeetingStore.documentByteLimit - overhead) / 6)
        meeting.enhancedNotes = String(repeating: "a", count: (MeetingStore.documentByteLimit - overhead) % 6)
        try store.save(meeting)
        let url = directory.appendingPathComponent(meeting.id.uuidString + ".json")
        let original = try Data(contentsOf: url)
        XCTAssertEqual(original.count, MeetingStore.documentByteLimit)
        XCTAssertEqual(try store.load().meetings.first?.notes, meeting.notes)
        meeting.enhancedNotes += "🌱"
        XCTAssertThrowsError(try store.save(meeting))
        XCTAssertEqual(try Data(contentsOf: url), original)
        XCTAssertTrue(try store.load().unreadable.isEmpty)
    }

    func testCompactImportCannotCreateAnUnreadablePrettyPrintedDocument() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MeetingStore(directory: directory)
        var meeting = Meeting(title: "Imported")
        let overhead = try MeetingStore.exportJSON(meeting).count
        meeting.notes = String(repeating: "\0", count: (MeetingStore.documentByteLimit - overhead) / 6 + 1)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let compact = try encoder.encode(meeting)
        XCTAssertLessThan(compact.count, MeetingStore.documentByteLimit)
        let decoded = try MeetingStore.decode(compact)
        XCTAssertThrowsError(try store.save(decoded))
        XCTAssertTrue(try store.load().meetings.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }
}
