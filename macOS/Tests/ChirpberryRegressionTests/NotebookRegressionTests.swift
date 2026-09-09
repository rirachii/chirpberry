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

    func testOversizedJSONImportLeavesNotebookAndOriginalFileUntouched() async throws {
        let root = try directory(); let documents = root.appendingPathComponent("Meetings")
        let notebook = model(directory: documents)
        let existingID = notebook.createMeeting(title: "Existing meeting")
        notebook.update(existingID, { $0.notes = "Keep this document" }, immediate: true)
        let existing = notebook.meetings
        let savedURL = documents.appendingPathComponent(existingID.uuidString + ".json")
        let durable = try Data(contentsOf: savedURL)
        var imported = Meeting(title: "Oversized import")
        imported.attendees = Array(repeating: "", count: 1000)
        imported.segments = [.init(timestamp: 0, channel: "Fixture", original: "")]
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let overhead = try encoder.encode(imported).count
        imported.segments[0].original = String(repeating: "x", count: 32 * 1024 * 1024 - overhead - 1)
        let source = try encoder.encode(imported)
        XCTAssertLessThan(source.count, 32 * 1024 * 1024)
        XCTAssertGreaterThan(try MeetingStore.exportJSON(MeetingStore.decode(source)).count, 32 * 1024 * 1024)
        let sourceURL = root.appendingPathComponent("source.json"); try source.write(to: sourceURL)
        await notebook.importFile(sourceURL)
        XCTAssertNotNil(notebook.message)
        XCTAssertEqual(notebook.meetings, existing)
        XCTAssertEqual(notebook.selectedID, existingID)
        XCTAssertTrue(notebook.unsavedIDs.isEmpty)
        XCTAssertEqual(try Data(contentsOf: sourceURL), source)
        XCTAssertEqual(try Data(contentsOf: savedURL), durable)
        XCTAssertEqual(try MeetingStore(directory: documents).load().meetings.count, 1)
        let mayQuit = await notebook.prepareToQuit()
        XCTAssertTrue(mayQuit)
    }

    func testFailedDocumentImportsDoNotEnterNotebookAndCanBeRetried() async throws {
        for ext in ["json", "txt"] {
            let root = try directory(); let documents = root.appendingPathComponent("Meetings")
            let backup = root.appendingPathComponent("Previous")
            let notebook = model(directory: documents)
            let existingID = notebook.createMeeting()
            let original = notebook.meetings
            var imported = Meeting(title: "Imported meeting"); imported.notes = "Original source notes"; imported.isTrashed = true
            let data = ext == "json" ? try MeetingStore.exportJSON(imported) : Data(imported.notes.utf8)
            let source = root.appendingPathComponent("import.\(ext)"); try data.write(to: source)
            try FileManager.default.moveItem(at: documents, to: backup)
            try Data("Blocked storage".utf8).write(to: documents)
            await notebook.importFile(source)
            XCTAssertEqual(notebook.meetings, original)
            XCTAssertEqual(notebook.selectedID, existingID)
            XCTAssertTrue(notebook.unsavedIDs.isEmpty)
            XCTAssertEqual(try Data(contentsOf: source), data)
            try FileManager.default.removeItem(at: documents)
            try FileManager.default.moveItem(at: backup, to: documents)
            await notebook.importFile(source)
            let selected = try XCTUnwrap(notebook.selected)
            XCTAssertNotEqual(selected.id, imported.id)
            XCTAssertFalse(selected.isTrashed)
            XCTAssertEqual(selected.notes, imported.notes)
            let saved = try XCTUnwrap(try MeetingStore(directory: documents).load().meetings.first { $0.id == selected.id })
            XCTAssertEqual(saved.notes, selected.notes)
            XCTAssertEqual(saved.isTrashed, selected.isTrashed)
            XCTAssertEqual(try Data(contentsOf: source), data)
            let mayQuit = await notebook.prepareToQuit()
            XCTAssertTrue(mayQuit)
        }
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

    func testBilingualNotebookJourneyPreservesNotesThroughExportImportAndRestore() async throws {
        let root = try directory(); let documents = root.appendingPathComponent("Meetings")
        let connection = FixtureConnection(); let audio = FixtureCapture()
        let provider = FixtureProvider()
        provider.formattedResponse = #"{"summary":"Synthetic summary: hand off on Friday.","action_items":[{"description":"Synthetic action"}]}"#
        let notebook = model(directory: documents, audio: audio, connection: connection, provider: provider)
        let id = notebook.createMeeting(title: "Synthetic bilingual launch review")
        let originalNotes = "Synthetic acceptance fixture, not a recorded meeting.\nKeep my Friday handoff notes unchanged."
        notebook.update(id, { $0.notes = originalNotes; $0.targetLanguage = "english" }, immediate: true)
        await notebook.startRecording()
        XCTAssertEqual(notebook.recordingState, .recording)
        try await connection.connection.receive(event("transcript.partial", text: "Provisional words must not persist"))
        XCTAssertFalse(notebook.partials.isEmpty)
        XCTAssertTrue(try XCTUnwrap(try MeetingStore(directory: documents).load().meetings.first).segments.isEmpty)
        let final = try RealtimeEvent.decode(JSONSerialization.data(withJSONObject: [
            "type": "transcript.final", "event_id": "synthetic-final-1", "timestampMs": 2000,
            "translated": true, "rawText": "我们周五交接。", "text": "We will hand off on Friday.",
            "sourceLanguage": "chinese", "targetLanguage": "english",
            "utterances": [["speaker": 0, "transcript": "我们周五交接。"]]
        ]))
        try await connection.connection.receive(final)
        try await connection.connection.receive(final)
        await notebook.stopRecording()
        XCTAssertEqual(audio.stopCount, 1)
        XCTAssertEqual(notebook.recordingState, .idle)
        let segment = try XCTUnwrap(notebook.selected?.segments.first)
        XCTAssertEqual(notebook.selected?.segments.count, 1)
        XCTAssertEqual(segment.original, "我们周五交接。")
        XCTAssertEqual(segment.translation, "We will hand off on Friday.")
        XCTAssertNil(segment.utterances.first?.start)
        XCTAssertNil(segment.utterances.first?.end)
        notebook.update(id, {
            $0.speakerNames[Meeting.speakerKey(channel: segment.channel, speaker: 0, scope: segment.speakerScope)] = "Example speaker"
        }, immediate: true)
        await notebook.enhance(id)
        let actionID = try XCTUnwrap(notebook.selected?.actions.first?.id)
        notebook.update(id, { $0.actions[0].completed = true }, immediate: true)
        await notebook.enhance(id)
        XCTAssertEqual(notebook.selected?.notes, originalNotes)
        XCTAssertEqual(notebook.selected?.actions.first?.id, actionID)
        XCTAssertEqual(notebook.selected?.actions.first?.completed, true)
        let mayQuit = await notebook.prepareToQuit()
        XCTAssertTrue(mayQuit)

        let relaunched = model(directory: documents)
        let restored = try XCTUnwrap(relaunched.selected)
        XCTAssertEqual(restored.notes, originalNotes)
        XCTAssertTrue(restored.enhancedNotes.contains("Synthetic summary: hand off on Friday."))
        XCTAssertEqual(MeetingSearch.search("Friday", in: relaunched.meetings).first?.id, id)
        XCTAssertEqual(MeetingSearch.search("交接", in: relaunched.meetings).first?.id, id)
        XCTAssertTrue(restored.markdown.contains("Example speaker: 我们周五交接。"))
        XCTAssertTrue(restored.markdown.contains("- [x] Synthetic action"))
        XCTAssertFalse(restored.markdown.contains("Provisional words"))
        let json = try MeetingStore.exportJSON(restored)
        XCTAssertFalse(String(decoding: json, as: UTF8.self).contains("synthetic-test-key"))
        let export = root.appendingPathComponent("export.json"); try json.write(to: export)
        await relaunched.importFile(export)
        let imported = try XCTUnwrap(relaunched.selected)
        XCTAssertNotEqual(imported.id, id)
        XCTAssertEqual(imported.notes, originalNotes)
        XCTAssertEqual(imported.enhancedNotes, restored.enhancedNotes)
        XCTAssertEqual(imported.segments, restored.segments)
        XCTAssertEqual(imported.actions, restored.actions)
        XCTAssertEqual(try Data(contentsOf: export), json)
        relaunched.trash(imported.id)
        XCTAssertFalse(relaunched.visibleMeetings.contains { $0.id == imported.id })
        relaunched.trash(imported.id)
        XCTAssertTrue(relaunched.visibleMeetings.contains { $0.id == imported.id })
        let saved = try XCTUnwrap(try MeetingStore(directory: documents).load().meetings.first { $0.id == id })
        XCTAssertEqual(saved, restored)
        let savedURL = documents.appendingPathComponent(id.uuidString + ".json")
        let attributes = try FileManager.default.attributesOfItem(atPath: savedURL.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: documents.path).allSatisfy { $0.hasSuffix(".json") })

        // Opt-in evidence contains only this synthetic fixture, never the user's notebook.
        if let path = ProcessInfo.processInfo.environment["CHIRPBERRY_TEST_EVIDENCE_DIR"] {
            let evidence = URL(fileURLWithPath: path, isDirectory: true)
            try MeetingStore(directory: evidence.appendingPathComponent("Meetings")).save(saved)
            try saved.markdown.write(to: evidence.appendingPathComponent("notebook-export.md"), atomically: true, encoding: .utf8)
        }
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
    var formattedResponse = #"{"action_items":[{"description":"Synthetic action"}]}"#
    func format(_ meeting: Meeting) async throws -> FormattedNotes {
        try FormattedNotes.parse(Data(formattedResponse.utf8))
    }
    func transcribe(file: URL) async throws -> String { await transcriptionGate?.wait(); return "Synthetic imported transcript" }
    func translate(_ text: String, target: String) async throws -> String { "Synthetic translation" }
}
