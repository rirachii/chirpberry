import XCTest
import ChirpberryCore

final class CompanionModelTests: XCTestCase {
    @MainActor func testScratchpadCreationDoesNotReplaceSelectedMeeting() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = NotebookModel(directory: directory)
        let meeting = model.createMeeting(title: "Existing meeting")
        let scratch = model.createScratchpad()
        XCTAssertEqual(model.selectedID, meeting)
        XCTAssertEqual(model.scratchpadID, scratch)
        XCTAssertEqual(model.scratchpads.count, 1)
        XCTAssertFalse(model.active)
        model.update(scratch, { $0.notes = "🌱 My original thought" }, immediate: true)
        let relaunched = NotebookModel(directory: directory)
        relaunched.ensureScratchpad()
        XCTAssertEqual(relaunched.scratchpadID, scratch)
        XCTAssertEqual(relaunched.scratchpads.first?.notes, "🌱 My original thought")
    }

    @MainActor func testDictationSetupRequiresExplicitStartAndCannotInterruptMeeting() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = NotebookModel(directory: directory)
        let scratch = model.createScratchpad()
        model.prepareDictation(noteID: scratch)
        XCTAssertTrue(model.showDictationSetup)
        XCTAssertFalse(model.active)
        XCTAssertEqual(model.capturePurpose, .dictation)
        model.showDictationSetup = false
        let meeting = model.createMeeting()
        model.capturePurpose = .meeting; model.recordingID = meeting; model.recordingState = .recording
        model.prepareDictation(noteID: scratch)
        XCTAssertFalse(model.showDictationSetup)
        XCTAssertEqual(model.recordingID, meeting)
        XCTAssertEqual(model.selectedID, meeting)
        XCTAssertEqual(model.capturePurpose, .meeting)
        model.recordingState = .idle
    }

    @MainActor func testTrashedScratchpadIsExcludedAndReplacementDoesNotDeleteIt() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = NotebookModel(directory: directory)
        let id = model.createScratchpad()
        model.update(id, { $0.notes = "Keep me" }, immediate: true)
        model.trash(id); model.ensureScratchpad()
        XCTAssertNotEqual(model.scratchpadID, id)
        XCTAssertEqual(model.scratchpads.count, 1)
        XCTAssertEqual(model.meetings.first(where: { $0.id == id })?.notes, "Keep me")
        model.prepareDictation(noteID: id)
        XCTAssertFalse(model.showDictationSetup)
    }

    @MainActor func testClosingPausedDictationNeverDeliversTextToAnotherApp() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = NotebookModel(directory: directory)
        let id = model.createScratchpad()
        model.recordingID = id; model.capturePurpose = .dictation; model.recordingState = .paused
        var deliveries: [Bool] = []
        model.onDictationFinished = { _, _, deliver in deliveries.append(deliver) }
        await model.stopRecording(deliverDictation: false)
        await model.stopRecording()
        XCTAssertEqual(deliveries, [false])
        XCTAssertFalse(model.active)
        XCTAssertNil(model.recordingID)
    }

    @MainActor func testUnsavableNoteDoesNotStartAConnection() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("not a directory".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let model = NotebookModel(directory: file)
        let id = model.createScratchpad()
        model.prepareDictation(noteID: id)
        await model.startRecording()
        XCTAssertFalse(model.active)
        XCTAssertNotNil(model.message)
    }

    @MainActor func testClosureDuringFinalizationSuppressesLaterDelivery() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = NotebookModel(directory: directory)
        model.recordingID = model.createScratchpad(); model.capturePurpose = .dictation
        model.recordingState = .finishing
        await model.stopRecording(deliverDictation: false)
        // Complete the same session after its finishing phase, as a paused stream would.
        model.recordingState = .paused
        var delivered: Bool?
        model.onDictationFinished = { _, _, allowed in delivered = allowed }
        await model.stopRecording()
        XCTAssertEqual(delivered, false)
    }
}
