import AppKit
import SwiftUI
import XCTest

@MainActor private final class EditorFixture: ObservableObject {
    @Published var summary = false
    @Published var request: NoteFormatRequest?
    @Published var text = "Friday notes"
    var edits: [String] = []
}

private struct VersionedEditor: View {
    @ObservedObject var fixture: EditorFixture
    @State private var consumption = NoteFormatConsumption()
    var body: some View {
        if fixture.summary { Text("Summary") }
        else {
            NoteTextEditor(text: Binding(get: { fixture.text }, set: { fixture.text = $0; fixture.edits.append($0) }),
                           formatRequest: fixture.request, formatConsumption: consumption)
        }
    }
}

final class NoteTextEditorTests: XCTestCase {
    @MainActor private func editor(in view: NSView) -> NSTextView? {
        if let editor = view as? NSTextView { return editor }
        return view.subviews.lazy.compactMap { self.editor(in: $0) }.first
    }

    @MainActor private func settle(file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("The editor did not reach the expected state", file: file, line: line)
        throw CancellationError()
    }

    @MainActor func testNotesSummarySwitchDoesNotRepeatConsumedFormattingAndUndoStillWorks() async throws {
        let fixture = EditorFixture()
        let host = NSHostingView(rootView: VersionedEditor(fixture: fixture))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        defer { window.contentView = nil; window.close() }
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        try await settle { self.editor(in: host)?.string == "Friday notes" }
        let first = try XCTUnwrap(editor(in: host))
        XCTAssertTrue(window.makeFirstResponder(first))
        first.setSelectedRange(NSRange(location: 0, length: 6))
        fixture.request = NoteFormatRequest(format: .bold)
        try await settle { fixture.text == "**Friday** notes" }
        XCTAssertEqual(fixture.edits, ["**Friday** notes"])
        XCTAssertTrue(first === editor(in: host))
        XCTAssertNotNil(first.delegate)
        let undo = try XCTUnwrap(first.undoManager)
        XCTAssertTrue(undo.canUndo)
        XCTAssertTrue(first.tryToPerform(NSSelectorFromString("undo:"), with: nil))
        XCTAssertEqual(first.string, "Friday notes")
        try await settle { fixture.text == "Friday notes" }
        XCTAssertTrue(first.tryToPerform(NSSelectorFromString("redo:"), with: nil))
        try await settle { fixture.text == "**Friday** notes" }
        XCTAssertTrue(first.tryToPerform(NSSelectorFromString("undo:"), with: nil))
        try await settle { fixture.text == "Friday notes" }
        let editsAfterUndo = fixture.edits
        fixture.summary = true
        try await settle { self.editor(in: host) == nil }
        fixture.summary = false
        try await settle { self.editor(in: host)?.string == "Friday notes" }
        let recreated = try XCTUnwrap(editor(in: host))
        XCTAssertFalse(first === recreated)
        XCTAssertEqual(fixture.edits, editsAfterUndo)
        recreated.setSelectedRange(NSRange(location: 0, length: 6))
        fixture.request = NoteFormatRequest(format: .italic)
        try await settle { fixture.text == "_Friday_ notes" }
        fixture.summary = true
        try await settle { self.editor(in: host) == nil }
        fixture.summary = false
        try await settle { self.editor(in: host)?.string == "_Friday_ notes" }
        XCTAssertEqual(fixture.edits, editsAfterUndo + ["_Friday_ notes"])
    }
}
