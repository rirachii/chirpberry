import SwiftUI
import UniformTypeIdentifiers
import ChirpberryCore

struct RecordingSetupView: View {
    @ObservedObject var model: NotebookModel
    @Environment(\.dismiss) var dismiss
    @AppStorage("includeSystemAudio") private var includeSystem = false
    @AppStorage("enableTranslation") private var translate = true
    @AppStorage("diarize") private var diarize = false
    @State private var informed = false
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Label("Ready to listen?", systemImage: "mic.circle").font(.title2.weight(.semibold))
            Text(model.selected?.title ?? "New meeting").foregroundStyle(.secondary)
            Form {
                Toggle("Include Mac audio", isOn: $includeSystem)
                Text(includeSystem ? "Captures your microphone and meeting audio in two Valsea streams. macOS will ask for Screen & System Audio Recording access. No screen video is saved." : "Captures your microphone for in-person conversations and voice notes.").font(.caption).foregroundStyle(.secondary)
                Toggle("Translate completed speech segments", isOn: $translate)
                if translate { Text("Translation: \(model.selected?.targetLanguage.capitalized ?? "English"). Change the target in Meeting details.").font(.caption).foregroundStyle(.secondary) }
                Toggle("Detect speakers", isOn: $diarize)
                Text("Speaker detection depends on the language and uses 2× Valsea transcription credits. You can rename the labels afterward.").font(.caption).foregroundStyle(.secondary)
            }.formStyle(.grouped).scrollDisabled(true).frame(height: includeSystem ? 295 : 275)
            Text("Audio is sent directly to Valsea while recording. Notes and final transcripts are saved on this Mac. Chirpberry does not save audio recordings.").font(.callout).foregroundStyle(.secondary)
            Toggle("Everyone knows this conversation will be transcribed", isOn: $informed).toggleStyle(.checkbox)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Start recording") { dismiss(); Task { await model.startRecording() } }.buttonStyle(.borderedProminent).disabled(!informed).keyboardShortcut(.defaultAction)
            }
        }.padding(28).frame(width: 500)
    }
}

struct SettingsView: View {
    @ObservedObject var model: NotebookModel
    @Environment(\.dismiss) var dismiss
    @State private var key = ""
    @State private var status = ""
    @State private var testing = false
    @AppStorage("translationTarget") private var target = "english"
    @AppStorage("sourceLanguage") private var source = "auto"
    @AppStorage("languageHints") private var hints = ""
    @AppStorage("vocabulary") private var vocabulary = ""
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Settings").font(.title2.weight(.semibold)); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }.padding(24)
            Form {
                Section("Valsea") {
                    SecureField("API key", text: $key).textFieldStyle(.roundedBorder)
                    HStack {
                        Button("Save key") { saveKey() }
                        Button("Test connection") { Task { await testConnection() } }.disabled(testing || key.isEmpty)
                        if testing { ProgressView().controlSize(.small) }
                        Spacer()
                        Link("Open dashboard", destination: URL(string: "https://valsea.ai/dashboard/api-keys")!)
                    }
                    if !status.isEmpty { Text(status).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    Text("Stored in macOS Keychain. Valsea usage requires your own credits. The connection test sends no audio.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Languages and names") {
                    Picker("Default translation", selection: $target) { ForEach(TranslationLanguage.targets, id: \.self) { Text($0.capitalized).tag($0) } }
                    Picker("Spoken language", selection: $source) {
                        Text("Automatic · mixed languages").tag("auto")
                        ForEach(["english", "singlish", "vietnamese", "chinese", "japanese", "korean", "indonesian", "malay", "thai", "hindi", "arabic"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    TextField("Language hints (en, vi, zh)", text: $hints)
                    TextField("Names, brands, and vocabulary", text: $vocabulary, axis: .vertical).lineLimit(3...6)
                    Text("Hints help automatic detection without restricting it. Settings apply to the next recording or resume.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Your notebook") {
                    Button("Reveal storage folder") { try? FileManager.default.createDirectory(at: model.storageURL, withIntermediateDirectories: true); NSWorkspace.shared.open(model.storageURL) }
                    Text("Personal notes, final transcripts, summaries, and action items stay in Application Support/Chirpberry. Requested speech and summary processing is hosted by Valsea.").font(.caption).foregroundStyle(.secondary)
                    Link("Valsea privacy policy", destination: URL(string: "https://valsea.ai/policies/en")!)
                }
                Section("Connect your AI tools") {
                    Text("Chirpberry includes a read-only MCP server. Launching it in your AI client gives that client access to your saved meeting content. Trashed meetings are excluded.").font(.callout)
                    Button("Copy MCP configuration") {
                        let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/bin/chirpberry-mcp").path
                        let config: [String: Any] = ["mcpServers": ["chirpberry": ["command": executable, "args": []]]]
                        if let data = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]) {
                            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(String(decoding: data, as: UTF8.self), forType: .string)
                            status = "MCP configuration copied."
                        }
                    }
                }
                Section {
                    Text("Chirpberry 0.1.0 · Open source · macOS 26+").foregroundStyle(.secondary)
                    Link("Source and releases", destination: URL(string: "https://github.com/rirachii/chirpberry")!)
                }
            }.formStyle(.grouped)
        }.frame(width: 620, height: 700)
            .onAppear { do { key = try ValseaKeychain.read() } catch { status = error.localizedDescription } }
    }
    private func saveKey() {
        do { try ValseaKeychain.save(key.trimmingCharacters(in: .whitespacesAndNewlines)); status = key.isEmpty ? "Key removed from Keychain." : "Key saved securely." }
        catch { status = error.localizedDescription }
    }
    private func testConnection() async {
        testing = true; defer { testing = false }
        var config = RealtimeConfiguration(); config.target = nil
        let connection = RealtimeConnection(channel: "Test", key: key.trimmingCharacters(in: .whitespacesAndNewlines), configuration: config)
        defer { connection.close() }
        do { try await connection.connect(); status = "Valsea connection verified. No audio was sent." }
        catch { status = error.localizedDescription }
    }
}

struct ImportView: View {
    @ObservedObject var model: NotebookModel
    @Environment(\.dismiss) var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Bring a conversation along.").font(.title2.weight(.semibold))
            Text("Import Markdown, plain text, or a Chirpberry JSON export locally. Audio files are sent to Valsea for transcription and optional translation.")
            Text("Audio: WAV, MP3, M4A, FLAC, OGG, or WebM. Maximum 10 MB and one hour. Valsea credits are required.").font(.callout).foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Choose file…") {
                    let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
                    panel.allowedContentTypes = [.plainText, .json, .audio] + ["md", "markdown", "webm", "ogg", "flac"].compactMap { UTType(filenameExtension: $0) }
                    if panel.runModal() == .OK, let url = panel.url { dismiss(); Task { await model.importFile(url) } }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }.padding(28).frame(width: 500)
    }
}

struct UpcomingView: View {
    @ObservedObject var model: NotebookModel
    @Environment(\.dismiss) var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Text("Upcoming meetings").font(.title2.weight(.semibold)); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
            if !model.calendarConnected {
                Text("Use your Mac calendars to create meeting notes with the right title and attendees. Calendar access is optional.").foregroundStyle(.secondary)
                Button("Connect calendars") { Task { await model.connectCalendar() } }.buttonStyle(.borderedProminent)
            } else {
                HStack { Text("The next seven days").foregroundStyle(.secondary); Spacer(); Button("Refresh") { Task { await model.connectCalendar() } } }
                if model.upcoming.isEmpty { ContentUnavailableView("No upcoming meetings", systemImage: "calendar", description: Text("You can create a meeting manually anytime.")) }
                List(Array(model.upcoming.enumerated()), id: \.offset) { _, event in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(event.title ?? "Meeting").font(.headline)
                        Text(event.startDate.formatted(date: .abbreviated, time: .shortened)).foregroundStyle(.secondary)
                        let previous = model.meetings.filter { !$0.isTrashed && $0.title.localizedCaseInsensitiveContains(event.title ?? "\u{0}") }.prefix(2)
                        if !previous.isEmpty {
                            Text("Previously discussed").font(.caption.weight(.semibold))
                            ForEach(Array(previous)) { meeting in
                                Button { model.selectedID = meeting.id; dismiss() } label: { Text(String((meeting.enhancedNotes.isEmpty ? meeting.notes : meeting.enhancedNotes).prefix(180))).lineLimit(3) }.buttonStyle(.plain).foregroundStyle(Brand.berry)
                            }
                        }
                        Button("Prepare notes") { model.createFromCalendar(event) }
                    }.padding(.vertical, 8)
                }
            }
            Spacer(minLength: 0)
        }.padding(24).frame(width: 620, height: 570)
    }
}
