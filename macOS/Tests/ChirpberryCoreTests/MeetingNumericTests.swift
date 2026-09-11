import Foundation
import XCTest
@testable import ChirpberryCore

final class MeetingNumericTests: XCTestCase {
    private func document() -> Meeting {
        var meeting = Meeting(title: "Numeric fixture")
        meeting.segments = [.init(timestamp: 1, channel: "Microphone", original: "Saved speech",
                                  utterances: [.init(speaker: 0, transcript: "Saved speech", start: 0, end: 1)])]
        return meeting
    }

    func testInvalidRangesRejectDecodeAndSaveWithoutReplacingOriginal() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = MeetingStore(directory: directory), original = document()
        try store.save(original)
        let url = directory.appendingPathComponent(original.id.uuidString + ".json")
        let bytes = try Data(contentsOf: url)
        var invalid: [Meeting] = []
        for value in [-1.0, 1e30, Double(Int.max)] {
            var meeting = original; meeting.duration = value; invalid.append(meeting)
            meeting = original; meeting.segments[0].timestamp = value; invalid.append(meeting)
            meeting = original; meeting.segments[0].utterances[0].start = value; invalid.append(meeting)
            meeting = original; meeting.segments[0].utterances[0].end = value; invalid.append(meeting)
        }
        for value in [-1, Int.min, Int.max] {
            var meeting = original; meeting.segments[0].utterances[0].speaker = value; invalid.append(meeting)
        }
        for meeting in invalid {
            XCTAssertThrowsError(try MeetingStore.decode(MeetingStore.exportJSON(meeting)))
            XCTAssertThrowsError(try store.save(meeting))
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
        for value in [Double.nan, .infinity, -.infinity] {
            var meeting = original; meeting.duration = value
            XCTAssertThrowsError(try store.save(meeting))
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
    }

    func testInvalidStoredDocumentRemainsUntouchedAndIsReported() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var meeting = document(); meeting.segments[0].timestamp = 1e30
        let url = directory.appendingPathComponent(meeting.id.uuidString + ".json")
        let bytes = try MeetingStore.exportJSON(meeting); try bytes.write(to: url)
        let loaded = try MeetingStore(directory: directory).load()
        XCTAssertTrue(loaded.meetings.isEmpty)
        XCTAssertEqual(loaded.unreadable, [url.lastPathComponent])
        XCTAssertEqual(try Data(contentsOf: url), bytes)
    }

    func testBoundaryValuesRoundTripAndRenderWithoutIntegerTruncation() throws {
        var meeting = document()
        let largest = Double(Int.max).nextDown
        meeting.duration = largest; meeting.segments[0].timestamp = largest
        meeting.segments[0].utterances[0] = .init(speaker: Int.max - 1, transcript: "Boundary speech", start: 0, end: largest)
        let decoded = try MeetingStore.decode(MeetingStore.exportJSON(meeting))
        XCTAssertEqual(decoded.segments, meeting.segments)
        let value = Int(largest)
        let remainder = value % 60
        XCTAssertEqual(Meeting.timeLabel(largest), "\(value / 60):\(remainder < 10 ? "0" : "")\(remainder)")
        XCTAssertEqual(meeting.speakerName(channel: "Microphone", speaker: Int.max - 1), "Microphone · Speaker \(Int.max)")
        XCTAssertEqual(Meeting.timeLabel(61.9), "01:01")
    }

    func testInvalidInMemoryValuesRenderAndExportMarkdownWithoutTrapping() {
        var meeting = document()
        for value in [Double.nan, .infinity, -.infinity, -1, 1e30, Double(Int.max)] {
            meeting.segments[0].timestamp = value
            for speaker in [Int.min, -1, Int.max] {
                meeting.segments[0].utterances[0].speaker = speaker
                XCTAssertEqual(Meeting.timeLabel(value), "00:00")
                XCTAssertEqual(meeting.speakerName(channel: "Microphone", speaker: speaker), "Microphone")
                XCTAssertTrue(meeting.markdown.contains("[00:00] Microphone: Saved speech"))
            }
        }
    }
}
