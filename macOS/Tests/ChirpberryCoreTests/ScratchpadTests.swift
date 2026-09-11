import XCTest
@testable import ChirpberryCore

final class ScratchpadTests: XCTestCase {
    func testOldMeetingFilesRemainReadable() throws {
        let old = Meeting(title: "An existing meeting")
        var json = try JSONSerialization.jsonObject(with: MeetingStore.exportJSON(old)) as! [String: Any]
        json.removeValue(forKey: "entryKind")
        let decoded = try MeetingStore.decode(JSONSerialization.data(withJSONObject: json))
        XCTAssertFalse(decoded.isScratchpad)
        XCTAssertEqual(decoded.title, old.title)
    }
    func testScratchpadRoundTripRetainsOriginalAndSummarySeparately() throws {
        var note = Meeting(title: "Friday thoughts")
        note.entryKind = "scratchpad"; note.notes = "Ask Minh about Friday."; note.enhancedNotes = "Follow up."
        let decoded = try MeetingStore.decode(MeetingStore.exportJSON(note))
        XCTAssertTrue(decoded.isScratchpad)
        XCTAssertEqual(decoded.notes, note.notes)
        XCTAssertEqual(decoded.enhancedNotes, note.enhancedNotes)
    }
    func testFinalSpeechAppendsWithoutOverwritingTypedNotes() {
        XCTAssertEqual(DictationText.appending("  hello  ", to: "My thought:"), "My thought: hello")
        XCTAssertEqual(DictationText.appending("你好。", to: "Existing notes\n\n"), "Existing notes\n\n你好。")
        XCTAssertEqual(DictationText.appending("\n ", to: "Keep this"), "Keep this")
    }
    func testFormattingUsesUTF16SelectionWithoutDamagingEmojiOrChinese() throws {
        let text = "🌱 你好 Friday"
        let selection = (text as NSString).range(of: "你好")
        let result = try XCTUnwrap(NoteFormat.bold.apply(to: text, selection: selection))
        XCTAssertEqual(result.text, "🌱 **你好** Friday")
        XCTAssertEqual((result.text as NSString).substring(with: result.selection), "你好")
        XCTAssertNil(NoteFormat.bold.apply(to: text, selection: NSRange(location: 999, length: 2)))
    }
    func testEmptySelectionPlacesCaretInsideFormattingAndListsPreserveLines() throws {
        let empty = try XCTUnwrap(NoteFormat.bold.apply(to: "", selection: NSRange(location: 0, length: 0)))
        XCTAssertEqual(empty.text, "****"); XCTAssertEqual(empty.selection, NSRange(location: 2, length: 0))
        let list = try XCTUnwrap(NoteFormat.checklist.apply(to: "One\nTwo", selection: NSRange(location: 0, length: 7)))
        XCTAssertEqual(list.text, "- [ ] One\n- [ ] Two")
    }
}
