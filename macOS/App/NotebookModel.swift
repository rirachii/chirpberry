import AppKit
import SwiftUI
import EventKit
import ChirpberryCore

enum RecordingState: String { case idle, connecting, recording, paused, finishing }

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

    private let store: MeetingStore
    private let calendar = EKEventStore()
    private var saves: [UUID: Task<Void, Never>] = [:]
    private var connections: [String: RealtimeConnection] = [:]
    private var capture: AudioCapture?
    private var reducer = TranscriptReducer()
    private var startedAt: Date?
    private var offset: Double = 0
    private var ticker: Task<Void, Never>?
    private var sessionToken = UUID()

    init() {
        // UI acceptance runs use an isolated document directory without touching the user's notes.
        let testPath = ProcessInfo.processInfo.environment["CHIRPBERRY_DOCUMENTS_DIR"]
        store = MeetingStore(directory: testPath.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? MeetingStore.defaultDirectory)
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
    func flush() { for task in saves.values { task.cancel() }; saves.removeAll(); for meeting in meetings { persist(meeting) } }
    private func persist(_ meeting: Meeting) {
        do { try store.save(meeting) } catch {
            let reason = "Could not save this meeting: \(error.localizedDescription). Keep Chirpberry open and export a copy."
            message = reason
            if active, recordingState != .finishing {
                Task { await abortRecording(reason) }
            }
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
        showRecordingSetup = true
    }
    func startRecording() async {
        guard recordingState == .idle || recordingState == .paused,
              let id = recordingState == .paused ? recordingID : selectedID,
              let meeting = meetings.first(where: { $0.id == id }) else { return }
        let token = UUID(); sessionToken = token
        recordingState = .connecting; recordingID = id; selectedID = id; message = nil
        offset = meeting.duration; elapsed = offset
        do {
            let key = try ValseaKeychain.read()
            guard !key.isEmpty else { throw CoreError.invalid("Add your Valsea API key in Settings before starting.") }
            let system = UserDefaults.standard.bool(forKey: "includeSystemAudio")
            var config = RealtimeConfiguration()
            config.target = UserDefaults.standard.object(forKey: "enableTranslation") as? Bool == false ? nil : meeting.targetLanguage
            config.diarize = UserDefaults.standard.bool(forKey: "diarize")
            config.language = UserDefaults.standard.string(forKey: "sourceLanguage") ?? "auto"
            config.hints = (UserDefaults.standard.string(forKey: "languageHints") ?? "").split(separator: ",").map(String.init)
            config.vocabulary = [meeting.vocabulary, UserDefaults.standard.string(forKey: "vocabulary") ?? "", meeting.attendees.joined(separator: ", ")].joined(separator: "\n")
            let channels = system ? ["Microphone", "Mac audio"] : ["Microphone"]
            reducer = TranscriptReducer(); partials = [:]
            for channel in channels {
                let connection = RealtimeConnection(channel: channel, key: key, configuration: config)
                connection.onEvent = { [weak self] event in
                    guard let self, self.sessionToken == token else { return }
                    if let segment = self.reducer.apply(event, channel: channel, offset: self.offset, speakerScope: token.uuidString) {
                        self.update(id, { $0.segments.append(segment) }, immediate: true)
                    }
                    self.partials = self.reducer.partials
                }
                connection.onFailure = { [weak self] reason in
                    guard let self, self.sessionToken == token else { return }
                    Task { await self.abortRecording(reason) }
                }
                connections[channel] = connection
            }
            for channel in channels { try await connections[channel]?.connect() }
            guard sessionToken == token, recordingState == .connecting else { return }
            let audio = AudioCapture()
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
    func stopRecording(pause: Bool = false) async {
        guard recordingState != .idle, recordingState != .finishing else { return }
        if recordingState == .connecting { await abortRecording("Connection cancelled."); return }
        let id = recordingID
        recordingState = .finishing
        await capture?.stop(); capture = nil
        ticker?.cancel(); ticker = nil
        if let startedAt { elapsed = offset + Date().timeIntervalSince(startedAt) }
        startedAt = nil
        let finishingConnections = Array(connections.values)
        await withTaskGroup(of: Void.self) { group in
            for connection in finishingConnections { group.addTask { await connection.finish() } }
        }
        connections.removeAll(); levels = [:]
        if let id { update(id, { $0.duration = elapsed }, immediate: true) }
        if partials.values.contains(where: { !$0.isEmpty }) { message = "Some provisional text did not receive a final result before the connection closed. Saved final segments are retained." }
        partials = [:]; recordingState = pause ? .paused : .idle
        if !pause { recordingID = nil }
    }
    func abortRecording(_ reason: String) async {
        guard recordingState != .idle else { return }
        if recordingState == .finishing { message = reason; return }
        recordingState = .finishing
        sessionToken = UUID(); ticker?.cancel(); ticker = nil
        for connection in connections.values { connection.close() }; connections.removeAll()
        await capture?.stop(); capture = nil
        if let startedAt { elapsed = offset + Date().timeIntervalSince(startedAt) }
        if let id = recordingID { update(id, { $0.duration = elapsed }, immediate: true) }
        startedAt = nil; levels = [:]; partials = [:]; recordingState = .idle; recordingID = nil; message = reason
    }
    func enhance(_ id: UUID) async {
        guard busyID == nil, let meeting = meetings.first(where: { $0.id == id }) else { return }
        busyID = id; message = nil
        defer { busyID = nil }
        do {
            let api = ValseaREST(key: try ValseaKeychain.read())
            let result = try await api.format(meeting)
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
                let key = try ValseaKeychain.read()
                guard !key.isEmpty else { throw CoreError.invalid("Add your Valsea key in Settings to transcribe audio files.") }
                let id = createMeeting(title: url.deletingPathExtension().lastPathComponent); busyID = id
                defer { busyID = nil }
                let api = ValseaREST(key: key)
                let text = try await api.transcribe(file: url)
                let segment = TranscriptSegment(timestamp: 0, channel: "Imported audio", original: text)
                update(id, { $0.segments = [segment] }, immediate: true)
                if UserDefaults.standard.object(forKey: "enableTranslation") as? Bool != false {
                    let target = meetings.first { $0.id == id }!.targetLanguage
                    let translation = try await api.translate(text, target: target)
                    update(id, { $0.segments[0].translation = translation; $0.segments[0].targetLanguage = target }, immediate: true)
                }
            }
            notebookFilter = "All meetings"; query = ""
        } catch { message = error.localizedDescription }
    }
    func connectCalendar() async {
        do {
            guard try await calendar.requestFullAccessToEvents() else { throw CoreError.invalid("Calendar access was declined. You can still create meetings manually.") }
            calendarConnected = true
            let predicate = calendar.predicateForEvents(withStart: Date().addingTimeInterval(-3600), end: Date().addingTimeInterval(7 * 86400), calendars: nil)
            upcoming = calendar.events(matching: predicate).filter { !$0.isAllDay }.sorted { $0.startDate < $1.startDate }
        } catch { calendarConnected = false; upcoming = []; message = error.localizedDescription }
    }
    func createFromCalendar(_ event: EKEvent) {
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
