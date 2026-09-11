import XCTest

final class CompanionHoverTests: XCTestCase {
    // Exercise the actual companion without attaching a notebook, opening windows,
    // registering global shortcuts, or touching the microphone and user data.
    @MainActor func testHoverOpensImmediatelyAndClosesPromptlyOnExit() async throws {
        let desktop = DesktopCompanion()
        defer { desktop.shutdown() }
        desktop.pointerChanged(true)
        XCTAssertTrue(desktop.barExpanded)
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertFalse(desktop.barExpanded, "An idle bar should close within a quarter second of pointer exit")
    }

    @MainActor func testFeedbackDoesNotKeepAnIdleBarOpenAfterExit() async throws {
        let desktop = DesktopCompanion()
        defer { desktop.shutdown() }
        desktop.feedback = "Copied to clipboard"
        desktop.pointerChanged(true)
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(600))
        XCTAssertFalse(desktop.barExpanded, "Status feedback must not pin a bar the pointer has left")
        XCTAssertEqual(desktop.feedback, "Copied to clipboard")
    }

    @MainActor func testPointerInteractionReleasesKeyboardPin() async throws {
        let desktop = DesktopCompanion()
        defer { desktop.shutdown() }
        desktop.focusBar()
        // A resize-generated exit before any pointer entry must preserve keyboard navigation.
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertTrue(desktop.barExpanded)
        desktop.pointerChanged(true)
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(600))
        XCTAssertFalse(desktop.barExpanded, "Once the pointer takes over, leaving must release the keyboard pin")
    }

    @MainActor func testReentryCancelsPendingClose() async throws {
        let desktop = DesktopCompanion()
        defer { desktop.shutdown() }
        desktop.pointerChanged(true)
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(50))
        desktop.pointerChanged(true)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertTrue(desktop.barExpanded)
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertFalse(desktop.barExpanded)
    }

    @MainActor func testPopoverRemainsOpenUntilDismissed() async throws {
        let desktop = DesktopCompanion()
        defer { desktop.shutdown() }
        desktop.pointerChanged(true)
        desktop.setPopoverOpen(true)
        desktop.pointerChanged(false)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertTrue(desktop.barExpanded)
        desktop.setPopoverOpen(false)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertFalse(desktop.barExpanded)
    }
}
