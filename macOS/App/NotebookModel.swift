import AppKit
import SwiftUI
import EventKit
import ChirpberryCore

enum RecordingState: String { case idle, connecting, recording, paused, finishing }
enum CapturePurpose { case meeting, dictation }

@MainActor final class NotebookModel: ObservableObject {
    @Published var meetings: [Meeting] = []
    @Published var selectedID: UUID?
    @Published var query = ""
    @Published var notebookFilter = "All meetings"
    @Published var recordingState: RecordingState = .idle
    @Published var recordingID: UUID?
    @Published var partials: [String: String] = [:]
    @Published var levels: [String: Float] = [:]
    @Published var elapsed: Double = 0
    @Published var message: String?
    @Published var busyID: UUID?
    @Published var upcoming: [EKEvent] = []
    @Published var calendarConnected = false
    @Published var showSettings = false
    @Published var showRecordingSetup = false
    @Published var showAsk = false
    @Published var showUpcoming = false
    @Published var showImporter = false
    @Published var exportKind: String?
    @Published var capturePurpose: CapturePurpose = .meeting
    @Published var scratchpadID: UUID?
    @Published var showDictationSetup = false
    @Published var calendarLoading = false
    var onDictationFinished: ((UUID, String, Bool) -> Void)?
    private var dictationText = ""
    private var suppressDictationDelivery = false
    private var saveFailures: Set<UUID> = []

    private let store: MeetingStore
    private let calendar = EKEventStore()
    private var saves: [UUID: Task<Void, Never>] = [:]
    private var connections: [String: RealtimeConnection] = [:]
    private var capture: (any RecordingAudioCapture)?
    private var reducer = TranscriptReducer()
    private var startedAt: Date?
    private var offset: Double = 0
    private var ticker: Task<Void, Never>?
    private var sessionToken = UUID()

    private var finalizationTask: Task<Void, Never>?
    private let readKey: () throws -> String
    private let makeConnection: @MainActor (String, String, RealtimeConfiguration) -> RealtimeConnection
    private let makeCapture: () -> any RecordingAudioCapture
    private let formatMeeting: (Meeting) async throws -> FormattedNotes
    private let transcribeAudio: (URL, String) async throws -> String
    private let translateText: (String, String, String) async throws -> String

    init(directory: URL? = nil, readKey: @escaping () throws -> String = { try ValseaKeychain.read() },
         makeConnection: @escaping @MainActor (String, String, RealtimeConfiguration) -> RealtimeConnection = { RealtimeConnection(channel: $0, key: $1, configuration: $2) },
         makeCapture: @escaping () -> any RecordingAudioCapture = { AudioCapture() },
         formatMeeting: @escaping (Meeting) async throws -> FormattedNotes = { try await ValseaREST(key: ValseaKeychain.read()).format($0) },
         transcribeAudio: @escaping (URL, String) async throws -> String = { try await ValseaREST(key: $1).transcribe(file: $0) },
         translateText: @escaping (String, String, String) async throws -> String = { try await ValseaREST(key: $2).translate($0, target: $1) }) {
        self.readKey = readKey; self.makeConnection = makeConnection; self.makeCapture = makeCapture; self.formatMeeting = formatMeeting
        self.transcribeAudio = transcribeAudio; self.translateText = translateText
        // UI acceptance runs use an isolated document directory without touching the user's notes.
        let testPath = ProcessInfo.processInfo.environment["CHIRPBERRY_DOCUMENTS_DIR"]
        store = MeetingStore(directory: directory ?? testPath.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? MeetingStore.defaultDirectory)
        do {
            let loaded = try store.load(); meetings = loaded.meetings; selectedID = meetings.first(where: { !$0.isTrashed })?.id
            if !loaded.unreadable.isEmpty { message = "\(loaded.unreadable.count) meeting file(s) could not be opened. They have been preserved in the storage folder." }
        } catch { message = "The notebook could not be opened: \(error.localizedDescription)" }
    }
    var selected: Meeting? { meetings.first { $0.id == selectedID } }
    var notebooks: [String] { Array(Set(meetings.filter { !$0.isTrashed }.map(\.notebook))).sorted() }
    var visibleMeetings: [Meeting] {
        meetings.filter { meeting in
            let folderMatches = notebookFilter == "Trash" ? meeting.isTrashed : !meeting.isTrashed &&
                (notebookFilter == "All meetings" || (notebookFilter == "Pinned" ? meeting.isPinned : meeting.notebook == notebookFilter))
            return folderMatches && (query.isEmpty || meeting.searchableText.localizedCaseInsensitiveContains(query))
        }.sorted { $0.isPinned != $1.isPinned ? $0.isPinned : $0.updatedAt > $1.updatedAt }
    }
    var active: Bool { recordingState != .idle }
    var storageURL: URL { store.directory }
    var scratchpads: [Meeting] { meetings.filter { $0.isScratchpad && !$0.isTrashed }.sorted { $0.updatedAt > $1.updatedAt } }

    @discardableResult func createScratchpad() -> UUID {
        var note = Meeting(title: "Untitled note")
        note.entryKind = "scratchpad"; note.notebook = "Scratchpad"
        meetings.insert(note, at: 0); scratchpadID = note.id
        persist(note)
        return note.id
    }
    func ensureScratchpad() {
        if !scratchpads.contains(where: { $0.id == scratchpadID }) { scratchpadID = scratchpads.first?.id ?? createScratchpad() }
    }
    func prepareDictation(noteID: UUID) {
        guard !active, let note = meetings.first(where: { $0.id == noteID && !$0.isTrashed }) else { return }
        capturePurpose = .dictation; scratchpadID = note.id; selectedID = note.id
        showDictationSetup = true
    }

    @discardableResult func createMeeting(title: String = "Untitled meeting") -> UUID {
        var meeting = Meeting(title: title)
        meeting.targetLanguage = UserDefaults.standard.string(forKey: "translationTarget") ?? "english"
        if !["All meetings", "Pinned", "Trash"].contains(notebookFilter) { meeting.notebook = notebookFilter }
        meetings.insert(meeting, at: 0); selectedID = meeting.id; notebookFilter = "All meetings"; query = ""
        persist(meeting); return meeting.id
    }
    func update(_ id: UUID, _ change: (inout Meeting) -> Void, immediate: Bool = false) {
        guard let index = meetings.firstIndex(where: { $0.id == id }) else { return }
        change(&meetings[index]); meetings[index].updatedAt = Date()
        saves[id]?.cancel()
        if immediate { persist(meetings[index]); return }
        saves[id] = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            guard let self, let meeting = self.meetings.first(where: { $0.id == id }) else { return }
            self.persist(meeting); self.saves[id] = nil
        }
    }
    @discardableResult func flush() -> Bool {
        for task in saves.values { task.cancel() }; saves.removeAll()
        var saved = true
        for meeting in meetings { if !persist(meeting) { saved = false } }
        return saved
    }
    @discardableResult private func persist(_ meeting: Meeting) -> Bool {
        do { try store.save(meeting); saveFailures.remove(meeting.id); return true } catch {
            saveFailures.insert(meeting.id)
            let reason = "Could not save this meeting: \(error.localizedDescription). Keep Chirpberry open and export a copy."
            message = reason
            if active, recordingState != .finishing {
                Task { await abortRecording(reason) }
            }
            return false
        }
    }
    func trash(_ id: UUID) {
        guard id != recordingID, id != busyID else { message = "Stop recording or wait for the current operation before moving this meeting."; return }
        update(id, { $0.isTrashed.toggle() }, immediate: true)
        selectedID = visibleMeetings.first?.id
    }
    func openRecordingSetup() {
        if recordingState == .paused { Task { await resume() }; return }
        guard recordingState == .idle else { selectedID = recordingID; return }
        if selected == nil || selected?.isTrashed == true { createMeeting() }
        capturePurpose = .meeting
        showRecordingSetup = true
    }
    func startRecording() async {
        guard recordingState == .idle || recordingState == .paused,
              let id = recordingState == .paused ? recordingID : selectedID,
              let meeting = meetings.first(where: { $0.id == id }) else { return }
        guard !meeting.isTrashed, persist(meeting) else { return }
        if recordingState == .idle { dictationText = ""; suppressDictationDelivery = false }
        let token = UUID(); sessionToken = token
        recordingState = .connecting; recordingID = id; selectedID = id; message = nil
        offset = meeting.duration; elapsed = offset
        do {
            let key = try readKey()
            guard !key.isEmpty else { throw CoreError.invalid("Add your Valsea API key in Settings before starting.") }
            let isDictation = capturePurpose == .dictation
            let system = !isDictation && UserDefaults.standard.bool(forKey: "includeSystemAudio")
            var config = RealtimeConfiguration()
            config.target = isDictation || UserDefaults.standard.object(forKey: "enableTranslation") as? Bool == false ? nil : meeting.targetLanguage
            config.diarize = !isDictation && UserDefaults.standard.bool(forKey: "diarize")
            config.language = UserDefaults.standard.string(forKey: "sourceLanguage") ?? "auto"
            config.hints = (UserDefaults.standard.string(forKey: "languageHints") ?? "").split(separator: ",").map(String.init)
            config.vocabulary = [meeting.vocabulary, UserDefaults.standard.string(forKey: "vocabulary") ?? "", meeting.attendees.joined(separator: ", ")].joined(separator: "\n")
            let channels = system ? ["Microphone", "Mac audio"] : ["Microphone"]
            reducer = TranscriptReducer(); partials = [:]
            for channel in channels {
                let connection = makeConnection(channel, key, config)
                connection.onEvent = { [weak self] event in
                    guard let self, self.sessionToken == token else { return }
                    if let segment = self.reducer.apply(event, channel: channel, offset: self.offset, speakerScope: token.uuidString) {
                        self.update(id, {
                            $0.segments.append(segment)
                            if isDictation { $0.notes = DictationText.appending(segment.original, to: $0.notes) }
                        }, immediate: true)
                        if isDictation { self.dictationText = DictationText.appending(segment.original, to: self.dictationText) }
                    }
                    self.partials = self.reducer.partials
                }
                connection.onFailure = { [weak self] reason in
                    guard let self, self.sessionToken == token else { return }
                    self.suppressDictationDelivery = true; self.message = reason
                    Task { await self.abortRecording(reason) }
                }
                connections[channel] = connection
            }
            for channel in channels { try await connections[channel]?.connect() }
            guard sessionToken == token, recordingState == .connecting else { return }
            let audio = makeCapture()
            audio.onAudio = { [weak self] data, channel, level in
                Task { @MainActor in
                    guard let self, self.sessionToken == token, self.recordingState == .recording else { return }
                    self.connections[channel]?.enqueue(data); self.levels[channel] = level
                }
            }
            audio.onFailure = { [weak self] reason in Task { @MainActor in
                guard let self, self.sessionToken == token else { return }; await self.abortRecording(reason)
            } }
            capture = audio
            try await audio.start(includeSystemAudio: system)
            guard sessionToken == token, recordingState == .connecting else { await audio.stop(); return }
            recordingState = .recording; startedAt = Date()
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard let self, !Task.isCancelled, let started = self.startedAt else { return }
                    self.elapsed = self.offset + Date().timeIntervalSince(started)
                }
            }
        } catch { if sessionToken == token { await abortRecording(error.localizedDescription) } }
    }
    func resume() async { guard recordingState == .paused else { return }; await startRecording() }
    func stopRecording(pause: Bool = false, deliverDictation: Bool = true) async {
        if !deliverDictation { suppressDictationDelivery = true }
        if let finalizationTask {
            await finalizationTask.value
            if !pause, recordingState == .paused { await stopRecording(deliverDictation: deliverDictation) }
            return
        }
        guard recordingState != .idle, recordingState != .finishing else { return }
        if recordingState == .connecting { await abortRecording("Connection cancelled."); return }
        recordingState = .finishing
        let task = Task {
            await finalizeRecording(pause: pause)
            finalizationTask = nil
        }
        finalizationTask = task
        await task.value
    }
    private func finalizeRecording(pause: Bool) async {
        let id = recordingID
        await capture?.stop(); capture = nil
        ticker?.cancel(); ticker = nil
        if let startedAt { elapsed = offset + Date().timeIntervalSince(startedAt) }
        startedAt = nil
        let finishingConnections = Array(connections.values)
        let succeeded = await withTaskGroup(of: Bool.self, returning: Bool.self) { group in
            for connection in finishingConnections { group.addTask { await connection.finish() } }
            var succeeded = true
            for await result in group { if !result { succeeded = false } }
            return succeeded
        }
        if !succeeded { suppressDictationDelivery = true }
        connections.removeAll(); levels = [:]
        if let id { update(id, { $0.duration = elapsed }, immediate: true) }
        if succeeded, partials.values.contains(where: { !$0.isEmpty }) { message = "Some provisional text did not receive a final result before the connection closed. Saved final segments are retained." }
        partials = [:]; recordingState = pause && succeeded ? .paused : .idle
        if recordingState == .idle {
            recordingID = nil
            if capturePurpose == .dictation, let id {
                onDictationFinished?(id, dictationText, !suppressDictationDelivery && !saveFailures.contains(id))
            }
        }
    }
    func abortRecording(_ reason: String) async {
        guard recordingState != .idle else { return }
        suppressDictationDelivery = true
        message = reason
        if let finalizationTask { await finalizationTask.value; return }
        guard recordingState != .finishing else { return }
        recordingState = .finishing
        let task = Task {
            await finishAborting(reason)
            finalizationTask = nil
        }
        finalizationTask = task
        await task.value
    }
    private func finishAborting(_ reason: String) async {
        sessionToken = UUID(); ticker?.cancel(); ticker = nil
        for connection in connections.values { connection.close() }; connections.removeAll()
        await capture?.stop(); capture = nil
        if let startedAt { elapsed = offset + Date().timeIntervalSince(startedAt) }
        if let id = recordingID { update(id, { $0.duration = elapsed }, immediate: true) }
        let failedID = recordingID
        startedAt = nil; levels = [:]; partials = [:]; recordingState = .idle; recordingID = nil; message = reason
        if capturePurpose == .dictation, let id = failedID { onDictationFinished?(id, dictationText, false) }
    }
    func enhance(_ id: UUID) async {
        guard busyID == nil, let meeting = meetings.first(where: { $0.id == id }) else { return }
        busyID = id; message = nil
        defer { busyID = nil }
        do {
            let result = try await formatMeeting(meeting)
            guard let current = meetings.first(where: { $0.id == id }), !current.isTrashed,
                  current.enhancedNotes == meeting.enhancedNotes, current.actions == meeting.actions else {
                message = "The summary changed while Valsea was working. Your edits were preserved; try again when you finish editing."
                return
            }
            update(id, { document in
                document.enhancedNotes = result.markdown
                // Preserve completed tasks when regenerating an unchanged action.
                document.actions = result.actions.map { action in
                    var updated = action
                    if let previous = document.actions.first(where: { $0.description == action.description && $0.owner == action.owner }) {
                        updated.id = previous.id; updated.completed = previous.completed
                    }
                    return updated
                }
            }, immediate: true)
        } catch { message = error.localizedDescription }
    }
    func importFile(_ url: URL) async {
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let ext = url.pathExtension.lowercased()
            if ext == "json" {
                var meeting = try MeetingStore.decode(Data(contentsOf: url)); meeting.id = UUID(); meeting.isTrashed = false
                meeting.updatedAt = Date(); meetings.insert(meeting, at: 0); selectedID = meeting.id; persist(meeting)
            } else if ["md", "txt", "markdown"].contains(ext) {
                let data = try Data(contentsOf: url)
                guard data.count <= 8 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else { throw CoreError.invalid("Choose a UTF-8 text file smaller than 8 MB.") }
                let id = createMeeting(title: url.deletingPathExtension().lastPathComponent)
                update(id, { $0.notes = text }, immediate: true)
            } else {
                guard busyID == nil else { throw CoreError.invalid("Wait for the current import or summary to finish.") }
                let key = try readKey()
                guard !key.isEmpty else { throw CoreError.invalid("Add your Valsea key in Settings to transcribe audio files.") }
                let id = createMeeting(title: url.deletingPathExtension().lastPathComponent); busyID = id
                defer { busyID = nil }
                let text = try await transcribeAudio(url, key)
                let segment = TranscriptSegment(timestamp: 0, channel: "Imported audio", original: text)
                update(id, { $0.segments.append(segment) }, immediate: true)
                if UserDefaults.standard.object(forKey: "enableTranslation") as? Bool != false,
                   let target = meetings.first(where: { $0.id == id })?.targetLanguage {
                    let translation = try await translateText(text, target, key)
                    update(id, { document in
                        guard let index = document.segments.firstIndex(where: { $0.id == segment.id }) else { return }
                        document.segments[index].translation = translation
                        document.segments[index].targetLanguage = target
                    }, immediate: true)
                }
            }
            notebookFilter = "All meetings"; query = ""
        } catch { message = error.localizedDescription }
    }
    func connectCalendar() async {
        guard !calendarLoading else { return }
        calendarLoading = true; defer { calendarLoading = false }
        do {
            guard try await calendar.requestFullAccessToEvents() else { throw CoreError.invalid("Calendar access was declined. You can still create meetings manually.") }
            calendarConnected = true
            refreshCalendarIfAuthorized()
        } catch { calendarConnected = false; upcoming = []; message = error.localizedDescription }
    }
    func refreshCalendarIfAuthorized() {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { calendarConnected = false; upcoming = []; return }
        calendarConnected = true
        let now = Date()
        let predicate = calendar.predicateForEvents(withStart: now, end: now.addingTimeInterval(7 * 86400), calendars: nil)
        upcoming = calendar.events(matching: predicate).filter { !$0.isAllDay && $0.endDate > now }.sorted { $0.startDate < $1.startDate }
    }
    func createFromCalendar(_ event: EKEvent) {
        if let eventID = event.eventIdentifier,
           let existing = meetings.first(where: { $0.calendarID == eventID && !$0.isTrashed }) {
            selectedID = existing.id; notebookFilter = "All meetings"; query = ""; showUpcoming = false
            return
        }
        let id = createMeeting(title: event.title ?? "Calendar meeting")
        update(id, { $0.calendarID = event.eventIdentifier; $0.attendees = event.attendees?.compactMap(\.name) ?? [] }, immediate: true)
        showUpcoming = false
    }
    func addExample() {
        var meeting = Meeting(title: "A small launch, across three languages")
        meeting.notebook = "Examples"
        meeting.notes = "Illustrative example, not a recorded meeting.\n\nKeep the first release focused. Ask Minh about the Friday handoff."
        meeting.segments = [
            .init(timestamp: 2, channel: "Example", original: "Let's send the first build on Friday.", sourceLanguage: "english"),
            .init(timestamp: 7, channel: "Example", original: "Mình sẽ kiểm tra bản dịch trước thứ Sáu.", translation: "I'll check the translations before Friday.", sourceLanguage: "vietnamese", targetLanguage: "english"),
            .init(timestamp: 14, channel: "Example", original: "我们先测试麦克风和会议声音。", translation: "Let's test the microphone and meeting audio first.", sourceLanguage: "chinese", targetLanguage: "english")]
        meeting.enhancedNotes = "### The plan\n\nShip a focused first build on Friday.\n\n### Before we ship\n\nReview the translations and test both audio sources.\n\nThis is an illustrative example; no API call was made."
        meeting.actions = [.init(description: "Review the translations", owner: "Minh", deadline: "Friday"), .init(description: "Test microphone and meeting audio")]
        meetings.insert(meeting, at: 0); selectedID = meeting.id; notebookFilter = "All meetings"; persist(meeting)
    }
}
