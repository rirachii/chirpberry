import AppKit
import Combine
import XCTest
import ChirpberryCore

@MainActor private final class ScriptedTransport: RealtimeTransport {
    var messages: [Result<URLSessionWebSocketTask.Message, Error>] = []
    var waiting: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    var sent: [String] = []
    var failSend: String?
    var onStop: (() -> Void)?
    var closed = false
    func resume() { emit(#"{"type":"session.created"}"#); emit(#"{"type":"session.ready"}"#) }
    func emit(_ json: String) { deliver(.success(.string(json))) }
    func deliver(_ result: Result<URLSessionWebSocketTask.Message, Error>) {
        if let waiting { self.waiting = nil; waiting.resume(with: result) }
        else { messages.append(result) }
    }
    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        guard !closed else { throw CoreError.invalid("Fixture closed") }
        let type: String
        switch message {
        case .string(let text): type = (try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])?["type"] as? String ?? ""
        case .data: type = "audio"
        @unknown default: type = "unknown"
        }
        sent.append(type)
        if failSend == type { throw CoreError.invalid("Fixture send failure") }
        if type == "session.stop" { onStop?() }
    }
    func receive() async throws -> URLSessionWebSocketTask.Message {
        guard !closed else { throw CoreError.invalid("Fixture closed") }
        if !messages.isEmpty { return try messages.removeFirst().get() }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func close() {
        closed = true
        waiting?.resume(throwing: CoreError.invalid("Fixture closed")); waiting = nil
    }
}

private final class SyntheticCapture: RecordingAudioCapture {
    var onAudio: ((Data, String, Float) -> Void)?
    var onFailure: ((String) -> Void)?
    var running = false
    @MainActor func start(includeSystemAudio: Bool) async throws { running = true }
    @MainActor func stop() async { running = false }
}

@MainActor private final class TerminationProbe: AppDelegate {
    var responses: [Bool] = []
    var responded: (() -> Void)?
    override func confirmStop() -> Bool { true }
    override func reply(_ sender: NSApplication, saved: Bool) { responses.append(saved); responded?() }
}

final class ReviewRegressionTests: XCTestCase {
    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }

    @MainActor private func recording(directory: URL, transport: ScriptedTransport, timeout: Duration = .seconds(2)) async throws -> (NotebookModel, SyntheticCapture, UUID) {
        let audio = SyntheticCapture()
        let model = NotebookModel(directory: directory, readKey: { "synthetic-key" }, makeConnection: { channel, _, configuration in
            RealtimeConnection(channel: channel, configuration: configuration, transport: transport, finalizationTimeout: timeout)
        }, makeCapture: { audio })
        let id = model.createScratchpad()
        model.update(id, { $0.notes = "Original notes" }, immediate: true)
        model.prepareDictation(noteID: id)
        await model.startRecording()
        XCTAssertEqual(model.recordingState, .recording)
        XCTAssertTrue(audio.running)
        return (model, audio, id)
    }

    @MainActor func testIdleAndActiveQuitRetainUnsavedEditsAndAllowRetry() async throws {
        for active in [false, true] {
            let root = directory(), documents = root.appendingPathComponent("documents"), backup = root.appendingPathComponent("saved")
            defer { try? FileManager.default.removeItem(at: root) }
            let model = NotebookModel(directory: documents)
            let id = model.createMeeting(title: "Keep this")
            model.update(id, { $0.notes = "Saved original" }, immediate: true)
            try FileManager.default.moveItem(at: documents, to: backup)
            try Data("Fixture blocks writes".utf8).write(to: documents)
            model.update(id, { $0.notes = "Unsaved edit for export" })
            if active { model.recordingID = id; model.recordingState = .paused }
            let delegate = TerminationProbe(); delegate.model = model
            if active {
                let reply = expectation(description: "Quit responds after saving")
                delegate.responded = { reply.fulfill() }
                XCTAssertEqual(delegate.applicationShouldTerminate(.shared), .terminateLater)
                await fulfillment(of: [reply], timeout: 2)
                XCTAssertEqual(delegate.responses, [false])
            } else { XCTAssertEqual(delegate.applicationShouldTerminate(.shared), .terminateCancel) }
            XCTAssertEqual(model.selected?.notes, "Unsaved edit for export")
            XCTAssertTrue(model.selected?.markdown.contains("Unsaved edit for export") == true)
            XCTAssertTrue(model.message?.contains("export a copy") == true)
            XCTAssertEqual(try MeetingStore(directory: backup).load().meetings.first?.notes, "Saved original")
            try FileManager.default.removeItem(at: documents)
            try FileManager.default.moveItem(at: backup, to: documents)
            XCTAssertEqual(delegate.applicationShouldTerminate(.shared), .terminateNow)
            XCTAssertEqual(try MeetingStore(directory: documents).load().meetings.first?.notes, "Unsaved edit for export")
        }
    }

    @MainActor func testQuitWaitsForExistingStopOrPauseAndSavesLateFinalsWithoutDelivery() async throws {
        for pause in [false, true] {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let transport = ScriptedTransport()
            let (model, audio, id) = try await recording(directory: root, transport: transport)
            let stopping = expectation(description: "Stop requested")
            transport.onStop = { stopping.fulfill() }
            var deliveries: [Bool] = []
            model.onDictationFinished = { _, _, allowed in deliveries.append(allowed) }
            let stop = Task { await model.stopRecording(pause: pause) }
            await fulfillment(of: [stopping], timeout: 2)
            let delegate = TerminationProbe(); delegate.model = model
            let replied = expectation(description: "Quit waits for the final event")
            delegate.responded = { replied.fulfill() }
            XCTAssertEqual(delegate.applicationShouldTerminate(.shared), .terminateLater)
            XCTAssertEqual(delegate.applicationShouldTerminate(.shared), .terminateLater)
            await Task.yield()
            XCTAssertTrue(delegate.responses.isEmpty)
            XCTAssertEqual(model.recordingState, .finishing)
            transport.emit(#"{"type":"transcript.final","text":"Late final speech.","timestampMs":2000}"#)
            transport.emit(#"{"type":"session.stopped"}"#)
            await stop.value
            await fulfillment(of: [replied], timeout: 2)
            XCTAssertEqual(delegate.responses, [true])
            XCTAssertEqual(deliveries, [false])
            XCTAssertFalse(model.active)
            XCTAssertFalse(audio.running)
            XCTAssertNil(model.recordingID)
            XCTAssertEqual(transport.sent.filter { $0 == "session.stop" }.count, 1)
            XCTAssertEqual(try MeetingStore(directory: root).load().meetings.first(where: { $0.id == id })?.notes, "Original notes Late final speech.")
        }
    }

    @MainActor func testReceiveCommitStopAndDeadlineFailuresSuppressDictation() async throws {
        for failure in ["receive", "audio.commit", "session.stop", "deadline"] {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let transport = ScriptedTransport()
            let (model, audio, _) = try await recording(directory: root, transport: transport, timeout: .milliseconds(100))
            transport.emit(#"{"type":"transcript.final","text":"Retain this final.","timestampMs":1000}"#)
            let finalSaved = expectation(description: "Final persisted")
            let subscription = model.$meetings.filter { $0.first?.segments.count == 1 }.prefix(1).sink { _ in finalSaved.fulfill() }
            await fulfillment(of: [finalSaved], timeout: 2)
            subscription.cancel()
            var deliveries: [Bool] = []
            model.onDictationFinished = { _, _, allowed in deliveries.append(allowed) }
            transport.failSend = failure
            if failure == "receive" { transport.onStop = { transport.deliver(.failure(CoreError.invalid("Fixture receive failure"))) } }
            await model.stopRecording()
            XCTAssertEqual(deliveries, [false], failure)
            XCTAssertFalse(audio.running, failure)
            XCTAssertFalse(model.active, failure)
            XCTAssertTrue(transport.closed, failure)
            XCTAssertNotNil(model.message, failure)
            XCTAssertEqual(try MeetingStore(directory: root).load().meetings.first?.notes, "Original notes Retain this final.", failure)
        }
    }

    @MainActor func testUnexpectedTerminalEventsStopCaptureAndCannotDeliverDictation() async throws {
        for type in ["session.stopped", "session.ended"] {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let transport = ScriptedTransport()
            let (model, audio, _) = try await recording(directory: root, transport: transport)
            let stopped = expectation(description: "Unexpected termination aborts owner")
            var deliveries: [Bool] = []
            model.onDictationFinished = { _, _, allowed in deliveries.append(allowed); stopped.fulfill() }
            transport.emit("{\"type\":\"\(type)\"}")
            await fulfillment(of: [stopped], timeout: 2)
            XCTAssertEqual(deliveries, [false])
            XCTAssertFalse(audio.running)
            XCTAssertFalse(model.active)
            XCTAssertTrue(model.message?.contains("unexpectedly") == true)
        }
    }

    @MainActor func testAcknowledgedStopDeliversFinalTextOnce() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let transport = ScriptedTransport()
        let (model, _, _) = try await recording(directory: root, transport: transport)
        transport.onStop = {
            transport.emit(#"{"type":"transcript.final","text":"Complete speech.","timestampMs":1000}"#)
            transport.emit(#"{"type":"session.ended"}"#)
        }
        var texts: [String] = []
        model.onDictationFinished = { _, text, allowed in if allowed { texts.append(text) } }
        async let first: Void = model.stopRecording()
        async let second: Void = model.stopRecording()
        _ = await (first, second)
        XCTAssertEqual(texts, ["Complete speech."])
    }

    @MainActor func testSummaryResponsePreservesEditsAndAllowsUnchangedRegeneration() async throws {
        for edit in ["summary", "actions", "notes", "none"] {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let requested = expectation(description: "Summary requested")
            var resume: CheckedContinuation<FormattedNotes, Error>?
            let model = NotebookModel(directory: root, formatMeeting: { _ in
                try await withCheckedThrowingContinuation { resume = $0; requested.fulfill() }
            })
            let id = model.createMeeting()
            var action = ActionItem(description: "Follow up", owner: "Maya"); action.completed = true
            model.update(id, { $0.notes = "Original notes"; $0.enhancedNotes = "Existing summary"; $0.actions = [action] }, immediate: true)
            let request = Task { await model.enhance(id) }
            await fulfillment(of: [requested], timeout: 2)
            model.update(id, {
                if edit == "summary" { $0.enhancedNotes = "My new summary" }
                if edit == "actions" { $0.actions[0].completed = false }
                if edit == "notes" { $0.notes = "My new original notes" }
            }, immediate: true)
            resume?.resume(returning: try FormattedNotes.parse(Data(#"{"raw_content":"Generated summary"}"#.utf8)))
            await request.value
            let saved = try XCTUnwrap(MeetingStore(directory: root).load().meetings.first)
            XCTAssertEqual(saved.notes, edit == "notes" ? "My new original notes" : "Original notes")
            XCTAssertEqual(saved.enhancedNotes, edit == "summary" ? "My new summary" : edit == "actions" ? "Existing summary" : "Generated summary")
            if edit == "actions" { XCTAssertEqual(saved.actions.first?.completed, false) }
            if ["summary", "actions"].contains(edit) { XCTAssertTrue(model.message?.contains("edits were preserved") == true) }
            XCTAssertNil(model.busyID)
        }
    }

    @MainActor func testAudioImportPreservesConcurrentLiveFinalsAndNotesAcrossBothAwaits() async throws {
        let defaults = UserDefaults.standard
        let arguments = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        defaults.setVolatileDomain(arguments.merging(["enableTranslation": true, "includeSystemAudio": false]) { _, new in new }, forName: UserDefaults.argumentDomain)
        defer { defaults.setVolatileDomain(arguments, forName: UserDefaults.argumentDomain) }
        for translationFails in [false, true] {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let source = root.appendingPathComponent("Import.wav")
            let original = Data("Synthetic audio fixture".utf8); try original.write(to: source)
            let documents = root.appendingPathComponent("documents")
            let transcribing = expectation(description: "Transcription requested")
            let translating = expectation(description: "Translation requested")
            var transcription: CheckedContinuation<String, Error>?
            var translation: CheckedContinuation<String, Error>?
            let transport = ScriptedTransport(), audio = SyntheticCapture()
            let model = NotebookModel(directory: documents, readKey: { "synthetic-key" }, makeConnection: { channel, _, configuration in
                RealtimeConnection(channel: channel, configuration: configuration, transport: transport)
            }, makeCapture: { audio }, transcribeAudio: { file, key in
                XCTAssertEqual(file, source); XCTAssertEqual(key, "synthetic-key")
                return try await withCheckedThrowingContinuation { transcription = $0; transcribing.fulfill() }
            }, translateText: { text, target, key in
                XCTAssertEqual(text, "Imported speech"); XCTAssertEqual(target, "english"); XCTAssertEqual(key, "synthetic-key")
                return try await withCheckedThrowingContinuation { translation = $0; translating.fulfill() }
            })
            let importing = Task { await model.importFile(source) }
            await fulfillment(of: [transcribing], timeout: 2)
            let id = try XCTUnwrap(model.selectedID)
            model.update(id, { $0.notes = "Notes during transcription"; $0.targetLanguage = "english" }, immediate: true)
            await model.startRecording()
            XCTAssertTrue(audio.running)
            let firstFinal = expectation(description: "First live final saved")
            let firstObserver = model.$meetings.filter { $0.first?.segments.count == 1 }.first().sink { _ in firstFinal.fulfill() }
            transport.emit(#"{"type":"transcript.final","text":"Live before import","timestampMs":1000}"#)
            await fulfillment(of: [firstFinal], timeout: 2); firstObserver.cancel()
            let first = try XCTUnwrap(model.selected?.segments.first)
            transcription?.resume(returning: "Imported speech")
            await fulfillment(of: [translating], timeout: 2)
            let interim = try XCTUnwrap(MeetingStore(directory: documents).load().meetings.first)
            XCTAssertEqual(interim.segments.map(\.original), ["Live before import", "Imported speech"])
            XCTAssertEqual(interim.notes, "Notes during transcription")
            let importedID = try XCTUnwrap(interim.segments.last?.id)
            model.update(id, { $0.notes = "Notes during translation" }, immediate: true)
            let secondFinal = expectation(description: "Second live final saved")
            let secondObserver = model.$meetings.filter { $0.first?.segments.count == 3 }.first().sink { _ in secondFinal.fulfill() }
            transport.emit(#"{"type":"transcript.final","text":"Live during translation","timestampMs":2000}"#)
            await fulfillment(of: [secondFinal], timeout: 2); secondObserver.cancel()
            let second = try XCTUnwrap(model.selected?.segments.last)
            model.update(id, { document in
                let imported = document.segments.remove(at: 1)
                document.segments.append(imported)
            }, immediate: true)
            if translationFails { translation?.resume(throwing: CoreError.invalid("Synthetic translation failure")) }
            else { translation?.resume(returning: "Imported translation") }
            await importing.value
            transport.onStop = { transport.emit(#"{"type":"session.ended"}"#) }
            await model.stopRecording()
            let saved = try XCTUnwrap(MeetingStore(directory: documents).load().meetings.first)
            XCTAssertEqual(saved.segments.count, 3)
            XCTAssertEqual(saved.segments.first(where: { $0.id == first.id }), first)
            XCTAssertEqual(saved.segments.first(where: { $0.id == second.id }), second)
            let imported = try XCTUnwrap(saved.segments.first(where: { $0.id == importedID }))
            XCTAssertEqual(imported.original, "Imported speech")
            XCTAssertEqual(imported.translation, translationFails ? nil : "Imported translation")
            XCTAssertEqual(imported.targetLanguage, translationFails ? nil : "english")
            XCTAssertEqual(saved.notes, "Notes during translation")
            XCTAssertEqual(try Data(contentsOf: source), original)
            XCTAssertNil(model.busyID)
            XCTAssertFalse(audio.running)
        }
    }
}
