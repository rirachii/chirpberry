import AppKit
import XCTest

final class DictationClipboardTests: XCTestCase {
    @MainActor func testOnlyAllowedFinalTextReplacesClipboardAndOnlyOnce() {
        let pasteboard = NSPasteboard(name: .init(UUID().uuidString))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("Existing clipboard", forType: .string)
        let delivery = DictationClipboard(pasteboard: pasteboard)
        XCTAssertFalse(delivery.finish("Unrequested text", allowed: true))
        delivery.arm()
        XCTAssertEqual(pasteboard.string(forType: .string), "Existing clipboard")
        XCTAssertTrue(delivery.finish("Hello, 世界 🌱", allowed: true))
        XCTAssertEqual(pasteboard.string(forType: .string), "Hello, 世界 🌱")
        XCTAssertFalse(delivery.finish("Duplicate callback", allowed: true))
        XCTAssertEqual(pasteboard.string(forType: .string), "Hello, 世界 🌱")
        XCTAssertFalse(delivery.requested)
    }

    @MainActor func testEmptyCancelledAndFailedSessionsPreserveClipboard() {
        let pasteboard = NSPasteboard(name: .init(UUID().uuidString))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("Keep this", forType: .string)
        let delivery = DictationClipboard(pasteboard: pasteboard)
        for text in ["", " \n\t"] {
            delivery.arm()
            XCTAssertFalse(delivery.finish(text, allowed: true))
            XCTAssertFalse(delivery.requested)
        }
        delivery.arm()
        XCTAssertFalse(delivery.finish("Final before failure", allowed: false))
        delivery.arm(); delivery.cancel()
        XCTAssertFalse(delivery.finish("Final after cancellation", allowed: true))
        XCTAssertEqual(pasteboard.string(forType: .string), "Keep this")
        delivery.arm()
        XCTAssertTrue(delivery.finish("Fresh session", allowed: true))
        XCTAssertEqual(pasteboard.string(forType: .string), "Fresh session")
    }
}
