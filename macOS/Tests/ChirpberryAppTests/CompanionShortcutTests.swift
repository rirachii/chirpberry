import XCTest
import Carbon

final class CompanionShortcutTests: XCTestCase {
    func testFnTapActivatesOnReleaseOnceAndResetsForNextTap() {
        var press = FnPressTracker()
        for _ in 0..<2 {
            for _ in 0..<3 {
                let result = press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: true, otherModifiers: false)
                XCTAssertTrue(result.consume)
                XCTAssertFalse(result.activate)
            }
            let release = press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: false, otherModifiers: false)
            XCTAssertTrue(release.consume)
            XCTAssertTrue(release.activate)
            let duplicate = press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: false, otherModifiers: false)
            XCTAssertFalse(duplicate.consume)
            XCTAssertFalse(duplicate.activate)
        }
    }

    func testFnTypingMediaAndModifierCombinationsDoNotStartDictation() {
        for (key, changed, modified) in [(kVK_ANSI_A, false, false), (0, false, false), (kVK_Shift, true, true)] {
            var press = FnPressTracker()
            _ = press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: true, otherModifiers: false)
            let combination = press.process(keyCode: UInt16(key), flagsChanged: changed, fnDown: true, otherModifiers: modified)
            XCTAssertFalse(combination.consume)
            XCTAssertFalse(combination.activate)
            let release = press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: false, otherModifiers: false)
            XCTAssertFalse(release.activate)
        }
        var press = FnPressTracker()
        XCTAssertFalse(press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: true, otherModifiers: true).consume)
        let release = press.process(keyCode: UInt16(kVK_Function), flagsChanged: true, fnDown: false, otherModifiers: true)
        XCTAssertFalse(release.consume)
        XCTAssertFalse(release.activate)
    }

    @MainActor func testUnregisterCancelsQueuedFnAction() async {
        let shortcuts = CompanionShortcuts()
        var actions: [UInt32] = []
        shortcuts.onAction = { actions.append($0) }
        shortcuts.enqueueFnAction()
        shortcuts.unregister()
        await withCheckedContinuation { continuation in DispatchQueue.main.async { continuation.resume() } }
        XCTAssertTrue(actions.isEmpty)
        shortcuts.enqueueFnAction()
        await withCheckedContinuation { continuation in DispatchQueue.main.async { continuation.resume() } }
        XCTAssertEqual(actions, [1])
    }

    @MainActor func testHoldingTabDoesNotImmediatelyStopTheDictationItStarted() {
        let shortcuts = CompanionShortcuts()
        var actions: [UInt32] = []
        shortcuts.onAction = { actions.append($0) }
        shortcuts.handleKey(4, pressed: true)
        shortcuts.handleKey(4, pressed: true)
        XCTAssertEqual(actions, [1])
        shortcuts.handleKey(4, pressed: false)
        shortcuts.handleKey(4, pressed: true)
        XCTAssertEqual(actions, [1, 1])
    }

    @MainActor func testChangingShortcutsClearsHeldKeysWithoutDispatchingAnAction() {
        let shortcuts = CompanionShortcuts()
        var actions: [UInt32] = []
        shortcuts.onAction = { actions.append($0) }
        shortcuts.handleKey(1, pressed: true)
        shortcuts.unregister()
        XCTAssertEqual(actions, [1])
        shortcuts.handleKey(1, pressed: true)
        shortcuts.handleKey(2, pressed: true)
        shortcuts.handleKey(3, pressed: true)
        shortcuts.handleKey(99, pressed: true)
        XCTAssertEqual(actions, [1, 1, 2, 3])
    }
}
