import SwiftUI
import UniformTypeIdentifiers
import ChirpberryCore

struct NotebookView: View {
    @ObservedObject var model: NotebookModel
    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "bird.fill").font(.system(size: 26)).foregroundStyle(Brand.berry)
                    Text("Chirpberry").font(.system(size: 19, weight: .semibold))
                    Spacer()
                }.padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 24)
                List(selection: $model.notebookFilter) {
                    Label("All meetings", systemImage: "text.book.closed").tag("All meetings")
                    Label("Pinned", systemImage: "pin").tag("Pinned")
                    Section("Notebooks") {
                        ForEach(model.notebooks, id: \.self) { name in Label(name, systemImage: "folder").tag(name) }
                    }
                    Section { Label("Trash", systemImage: "trash").tag("Trash") }
                }.listStyle(.sidebar)
                VStack(spacing: 12) {
                    Button { model.showUpcoming = true } label: { Label("Upcoming", systemImage: "calendar").frame(maxWidth: .infinity, alignment: .leading) }
                    Button { model.showAsk = true } label: { Label("Ask your notes", systemImage: "sparkle.magnifyingglass").frame(maxWidth: .infinity, alignment: .leading) }
                    Divider()
                    HStack {
                        Label(model.unsavedIDs.isEmpty ? "Saved on this Mac" : "Unsaved changes", systemImage: "internaldrive").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button { model.showSettings = true } label: { Image(systemName: "gearshape") }.help("Settings").accessibilityLabel("Settings")
                    }
                }.buttonStyle(.plain).padding(18)
            }.navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 260)
        } content: {
            VStack(spacing: 0) {
                HStack {
                    Text(model.notebookFilter).font(.headline)
                    Spacer()
                    Button { model.createMeeting() } label: { Image(systemName: "square.and.pencil") }.buttonStyle(.plain).help("New meeting (⌘N)").accessibilityLabel("New meeting")
                }.padding(18)
                TextField("Search meetings", text: $model.query).textFieldStyle(.roundedBorder).padding(.horizontal, 14).padding(.bottom, 12)
                List(selection: $model.selectedID) {
                    ForEach(model.visibleMeetings) { meeting in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 5) {
                                if meeting.isPinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(Brand.berry) }
                                Text(meeting.title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                                if meeting.id == model.recordingID { Circle().fill(.red).frame(width: 6, height: 6) }
                            }
                            Text(meeting.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                            Text(meeting.notes.isEmpty ? (meeting.segments.last?.translation ?? meeting.segments.last?.original ?? "A little room to think.") : meeting.notes)
                                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }.padding(.vertical, 8).tag(meeting.id)
                            .contextMenu {
                                Button(meeting.isPinned ? "Unpin" : "Pin") { model.update(meeting.id, { $0.isPinned.toggle() }) }
                                Button(meeting.isTrashed ? "Restore meeting" : "Move to Trash") { model.trash(meeting.id) }
                            }
                    }
                }.listStyle(.inset)
                if model.visibleMeetings.isEmpty {
                    Text(model.query.isEmpty ? "Your meetings will appear here." : "No matching meetings.")
                        .font(.callout).foregroundStyle(.secondary).padding(20)
                    Spacer()
                }
            }.navigationSplitViewColumnWidth(min: 220, ideal: 255, max: 330)
        } detail: {
            VStack(spacing: 0) {
                if let message = model.message {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "info.circle").foregroundStyle(Brand.berry)
                        Text(message).font(.callout).textSelection(.enabled)
                        Spacer()
                        Button { model.message = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Dismiss message")
                    }.padding(14).background(Brand.berry.opacity(0.09))
                }
                if let meeting = model.selected { MeetingEditor(model: model, meetingID: meeting.id).id(meeting.id) }
                else { emptyState }
                if model.active { RecordingBar(model: model) }
            }.frame(minWidth: 610)
        }
        .frame(minWidth: 1040, minHeight: 630)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if model.recordingState == .idle || model.recordingState == .paused {
                    Button { model.openRecordingSetup() } label: { Label(model.recordingState == .paused ? "Resume" : "Record meeting", systemImage: "mic") }
                        .buttonStyle(.borderedProminent).tint(Brand.berry)
                        .disabled(model.recordingBlockedByImport)
                }
            }
        }
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
        .sheet(isPresented: $model.showRecordingSetup) { RecordingSetupView(model: model) }
        .sheet(isPresented: $model.showUpcoming) { UpcomingView(model: model) }
        .sheet(isPresented: $model.showAsk) { AskNotesView(model: model) }
        .sheet(isPresented: $model.showImporter) { ImportView(model: model) }
        .onChange(of: model.exportKind) { _, value in if let value { export(value); model.exportKind = nil } }
    }
    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "bird").font(.system(size: 64, weight: .ultraLight)).foregroundStyle(Brand.berry)
            Text("A little room for every voice.").font(.system(size: 28, weight: .semibold))
            Text("Capture a conversation. Keep your own notes.\nFollow along in another language.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("New meeting") { model.createMeeting() }.buttonStyle(.borderedProminent).controlSize(.large)
            Button("Explore an example") { model.addExample() }.buttonStyle(.plain).foregroundStyle(Brand.berry)
            Button("Import notes or audio…") { model.showImporter = true }.buttonStyle(.plain).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(30)
    }
    private func export(_ kind: String) {
        guard let meeting = model.selected else { return }
        let panel = NSSavePanel(); panel.canCreateDirectories = true
        panel.nameFieldStringValue = meeting.title.replacingOccurrences(of: "/", with: "-") + "." + kind
        panel.allowedContentTypes = kind == "json" ? [.json] : [UTType(filenameExtension: "md") ?? .plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let data = kind == "json" ? try MeetingStore.exportJSON(meeting) : Data(meeting.markdown.utf8)
            try data.write(to: url, options: .atomic)
        } catch { model.message = "Export failed: \(error.localizedDescription)" }
    }
}

struct RecordingBar: View {
    @ObservedObject var model: NotebookModel
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: model.recordingState == .paused ? "pause.circle" : "waveform.circle.fill")
                .font(.title2).foregroundStyle(model.recordingState == .recording ? Color.red : Brand.berry)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.recordingState == .recording ? "Listening" : model.recordingState.rawValue.capitalized).font(.callout.weight(.medium))
                Button(model.meetings.first(where: { $0.id == model.recordingID })?.title ?? "Meeting") { model.selectedID = model.recordingID }
                    .font(.caption).foregroundStyle(.secondary).buttonStyle(.plain).lineLimit(1)
            }
            Spacer()
            if model.recordingState == .recording {
                ForEach(model.levels.keys.sorted(), id: \.self) { channel in
                    ProgressView(value: Double(model.levels[channel] ?? 0)).frame(width: 42).help(channel).accessibilityLabel("\(channel) input level")
                }
            }
            Text(Meeting.timeLabel(model.elapsed)).monospacedDigit().foregroundStyle(.secondary)
            if model.recordingState == .recording {
                Button { Task { await model.stopRecording(pause: true) } } label: { Image(systemName: "pause.fill") }.help("Pause recording").accessibilityLabel("Pause recording")
            } else if model.recordingState == .paused {
                Button("Resume") { Task { await model.resume() } }
            }
            if model.recordingState == .finishing { ProgressView().controlSize(.small) }
            else { Button("Stop", systemImage: "stop.fill") { Task { await model.stopRecording() } }.buttonStyle(.bordered) }
        }.padding(16).background(.bar)
    }
}
