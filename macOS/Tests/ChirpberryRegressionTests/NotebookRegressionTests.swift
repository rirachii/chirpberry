import XCTest
import ChirpberryCore

@MainActor final class NotebookRegressionTests: XCTestCase {
    private func directory() throws -> URL {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".build/regression-fixtures/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    private func model(directory: URL, audio: FixtureCapture? = nil,
                       connection: FixtureConnection? = nil,
                       provider: FixtureProvider? = nil) -> NotebookModel {
        let audio = audio ?? FixtureCapture()
        let connection = connection ?? FixtureConnection()
        let provider = provider ?? FixtureProvider()
        return NotebookModel(store: MeetingStore(directory: directory), readKey: { "synthetic-test-key" },
                             makeConnection: { _, _, _ in connection }, makeCapture: { audio }, makeProvider: { _ in provider })
    }

    func testImportBlocksRecordingAndPreservesEverySegment() async throws {
        let root = try directory()
        let provider = FixtureProvider()
        let gate = Suspension(expectation(description: "Transcription pending")); provider.transcriptionGate = gate
        let notebook = model(directory: root, provider: provider)
        let importing = Task { await notebook.importFile(root.appendingPathComponent("synthetic.wav")) }
        await fulfillment(of: [gate.entered], timeout: 2)
        let id = try XCTUnwrap(notebook.importingID)
        XCTAssertEqual(notebook.busyID, id)
        XCTAssertTrue(notebook.recordingBlockedByImport)
        notebook.openRecordingSetup()
        XCTAssertFalse(notebook.showRecordingSetup)
        await notebook.startRecording()
        XCTAssertEqual(notebook.recordingState, .idle)
        XCTAssertNil(notebook.recordingID)
        notebook.update(id, { $0.notes = "Keep these original notes"; $0.segments.append(.init(timestamp: 1, channel: "Existing", original: "Existing final")) }, immediate: true)
        let other = notebook.createMeeting(title: "Another meeting")
        XCTAssertFalse(notebook.recordingBlockedByImport)
        await notebook.startRecording()
        XCTAssertEqual(notebook.recordingID, other)
        await notebook.stopRecording()
        gate.release()
        await importing.value
        XCTAssertNil(notebook.importingID)
        XCTAssertNil(notebook.busyID)
        let imported = try XCTUnwrap(try MeetingStore(directory: root).load().meetings.first { $0.id == id })
        XCTAssertEqual(imported.notes, "Keep these original notes")
        XCTAssertEqual(imported.segments.map(\.original), ["Existing final", "Synthetic imported transcript"])
        XCTAssertNil(imported.segments[0].translation)
        if let translation = imported.segments[1].translation { XCTAssertEqual(translation, "Synthetic translation") }
    }

    func testQuitWaitsForStopAndPauseFinals() async throws {
        for pause in [false, true] {
            let root = try directory()
            let audio = FixtureCapture(); let connection = FixtureConnection()
            let gate = Suspension(expectation(description: "Final drain pending")); connection.finishGate = gate
            let notebook = model(directory: root, audio: audio, connection: connection)
            let id = notebook.createMeeting()
            await notebook.startRecording()
            let stopping = Task { await notebook.stopRecording(pause: pause) }
            await fulfillment(of: [gate.entered], timeout: 2)
            XCTAssertEqual(notebook.recordingState, .finishing)
            let requested = expectation(description: "Quit requested")
            var quitCompleted = false
            let quitting = Task { requested.fulfill(); let result = await notebook.prepareToQuit(); quitCompleted = true; return result }
            await fulfillment(of: [requested], timeout: 2)
            XCTAssertFalse(quitCompleted)
            XCTAssertEqual(audio.stopCount, 1)
            try await connection.connection.receive(event("transcript.final", text: "Last synthetic final"))
            gate.release()
            await stopping.value
            let mayQuit = await quitting.value
            XCTAssertTrue(mayQuit)
            XCTAssertEqual(notebook.recordingState, .idle)
            XCTAssertNil(notebook.recordingID)
            XCTAssertEqual(connection.finishCount, 1)
            let saved = try XCTUnwrap(try MeetingStore(directory: root).load().meetings.first { $0.id == id })
            XCTAssertEqual(saved.segments.map(\.original), ["Last synthetic final"])
        }
    }

    func testQuitWaitsForAbortedCaptureToStop() async throws {
        let audio = FixtureCapture()
        let gate = Suspension(expectation(description: "Capture stop pending")); audio.stopGate = gate
        let notebook = model(directory: try directory(), audio: audio)
        notebook.createMeeting(); await notebook.startRecording()
        let aborting = Task { await notebook.abortRecording("Synthetic failure") }
        await fulfillment(of: [gate.entered], timeout: 2)
        let requested = expectation(description: "Quit requested")
        var completed = false
        let quitting = Task { requested.fulfill(); let result = await notebook.prepareToQuit(); completed = true; return result }
        await fulfillment(of: [requested], timeout: 2)
        XCTAssertFalse(completed)
        gate.release()
        await aborting.value
        let mayQuit = await quitting.value
        XCTAssertTrue(mayQuit)
        XCTAssertEqual(audio.stopCount, 1)
        XCTAssertEqual(notebook.recordingState, .idle)
    }

    func testFailedSaveCancelsQuitAndRemainsExportableUntilRecovery() async throws {
        let root = try directory()
        let documents = root.appendingPathComponent("Meetings")
        let backup = root.appendingPathComponent("Previous")
        let notebook = model(directory: documents)
        let id = notebook.createMeeting()
        notebook.update(id, { $0.notes = "Durable original" }, immediate: true)
        try FileManager.default.moveItem(at: documents, to: backup)
        try Data("Blocked storage".utf8).write(to: documents)
        notebook.update(id, { $0.notes = "Unsaved edits to recover" })
        let mayQuit = await notebook.prepareToQuit()
        XCTAssertFalse(mayQuit)
        XCTAssertTrue(notebook.unsavedIDs.contains(id))
        let unsaved = try XCTUnwrap(notebook.selected)
        XCTAssertTrue(unsaved.markdown.contains("Unsaved edits to recover"))
        XCTAssertEqual(try MeetingStore.decode(MeetingStore.exportJSON(unsaved)).notes, unsaved.notes)
        XCTAssertEqual(try MeetingStore(directory: backup).load().meetings.first?.notes, "Durable original")
        try FileManager.default.removeItem(at: documents)
        try FileManager.default.moveItem(at: backup, to: documents)
        let recovered = await notebook.prepareToQuit()
        XCTAssertTrue(recovered)
        XCTAssertTrue(notebook.unsavedIDs.isEmpty)
        XCTAssertEqual(try MeetingStore(directory: documents).load().meetings.first?.notes, unsaved.notes)
    }

    func testQuitAfterDrainStillRejectsFailedFinalSave() async throws {
        let root = try directory(); let documents = root.appendingPathComponent("Meetings")
        let connection = FixtureConnection()
        let gate = Suspension(expectation(description: "Final drain pending")); connection.finishGate = gate
        let notebook = model(directory: documents, connection: connection)
        let id = notebook.createMeeting(); await notebook.startRecording()
        let quitting = Task { await notebook.prepareToQuit() }
        await fulfillment(of: [gate.entered], timeout: 2)
        try FileManager.default.moveItem(at: documents, to: root.appendingPathComponent("Previous"))
        try Data("Blocked storage".utf8).write(to: documents)
        try await connection.connection.receive(event("transcript.final", text: "Recover this last final"))
        gate.release()
        let mayQuit = await quitting.value
        XCTAssertFalse(mayQuit)
        XCTAssertEqual(notebook.recordingState, .idle)
        XCTAssertTrue(notebook.unsavedIDs.contains(id))
        XCTAssertTrue(notebook.selected?.markdown.contains("Recover this last final") == true)
    }

    func testUnexpectedTerminalEventsStopCaptureAndNotifyOnce() async throws {
        for terminal in ["session.stopped", "session.ended"] {
            let connection = FixtureConnection(); let audio = FixtureCapture()
            let stopped = expectation(description: "Capture stopped"); audio.didStop = { stopped.fulfill() }
            let notebook = model(directory: try directory(), audio: audio, connection: connection)
            notebook.createMeeting(); await notebook.startRecording()
            XCTAssertTrue(connection.connection.ready)
            var failures = 0
            let owner = connection.onFailure
            connection.onFailure = { reason in failures += 1; owner?(reason) }
            try await connection.connection.receive(event(terminal))
            try await connection.connection.receive(event(terminal))
            await fulfillment(of: [stopped], timeout: 2)
            await notebook.stopRecording()
            XCTAssertEqual(failures, 1)
            XCTAssertFalse(connection.connection.ready)
            XCTAssertEqual(audio.stopCount, 1)
            XCTAssertEqual(notebook.recordingState, .idle)
        }
    }

    func testExplicitConnectionClosureDoesNotReportProviderFailure() async throws {
        let connection = RealtimeConnection(channel: "Fixture", key: "synthetic-test-key", configuration: RealtimeConfiguration())
        var failures = 0; connection.onFailure = { _ in failures += 1 }
        connection.close()
        try await connection.receive(event("session.ended"))
        XCTAssertEqual(failures, 0)
    }
}

private func event(_ type: String, text: String = "") throws -> RealtimeEvent {
    try RealtimeEvent.decode(JSONSerialization.data(withJSONObject: ["type": type, "text": text]))
}

@MainActor private final class Suspension {
    let entered: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?
    init(_ entered: XCTestExpectation) { self.entered = entered }
    func wait() async { await withCheckedContinuation { continuation = $0; entered.fulfill() } }
    func release() { continuation?.resume(); continuation = nil }
}

private final class FixtureCapture: AudioCapturing {
    var onAudio: ((Data, String, Float) -> Void)?
    var onFailure: ((String) -> Void)?
    var stopGate: Suspension?
    var didStop: (() -> Void)?
    var stopCount = 0
    @MainActor func start(includeSystemAudio: Bool) async throws {}
    @MainActor func stop() async { stopCount += 1; await stopGate?.wait(); didStop?() }
}

@MainActor private final class FixtureConnection: RealtimeStreaming {
    let connection = RealtimeConnection(channel: "Fixture", key: "synthetic-test-key", configuration: RealtimeConfiguration())
    var onEvent: ((RealtimeEvent) -> Void)? {
        get { connection.onEvent }
        set { connection.onEvent = newValue }
    }
    var onFailure: ((String) -> Void)? {
        get { connection.onFailure }
        set { connection.onFailure = newValue }
    }
    var finishGate: Suspension?
    var finishCount = 0
    func connect() async throws { try await connection.receive(event("session.ready")) }
    func enqueue(_ audio: Data) {}
    func finish() async { finishCount += 1; await finishGate?.wait(); connection.close() }
    func close() { connection.close() }
}

@MainActor private final class FixtureProvider: NotebookProvider {
    var transcriptionGate: Suspension?
    func format(_ meeting: Meeting) async throws -> FormattedNotes {
        try FormattedNotes.parse(Data(#"{"action_items":[{"description":"Synthetic action"}]}"#.utf8))
    }
    func transcribe(file: URL) async throws -> String { await transcriptionGate?.wait(); return "Synthetic imported transcript" }
    func translate(_ text: String, target: String) async throws -> String { "Synthetic translation" }
}
