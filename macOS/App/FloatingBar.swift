import SwiftUI
import ChirpberryCore

struct FloatingBar: View {
    @ObservedObject var model: NotebookModel
    @ObservedObject var desktop: DesktopCompanion
    @AppStorage("sourceLanguage") private var language = "auto"
    @State private var showLanguages = false
    @State private var showMeetings = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Group {
            if desktop.barExpanded { expandedBar.transition(.opacity) }
            else { collapsedHandle.transition(.opacity) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.08), value: desktop.barExpanded)
        .tint(Brand.berry)
        .contextMenu { dockMenu }
        .onChange(of: showLanguages || showMeetings) { _, open in desktop.setPopoverOpen(open) }
        .onExitCommand { showLanguages = false; showMeetings = false; desktop.collapseBar() }
    }

    private var collapsedHandle: some View {
        Button { desktop.focusBar() } label: {
            Capsule()
                .fill(Color(red: 0.37, green: 0.35, blue: 0.40).opacity(reduceTransparency ? 1 : 0.32))
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(0.45), lineWidth: 1))
                .frame(width: desktop.dock.isVertical ? 10 : 52, height: desktop.dock.isVertical ? 60 : 10)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel("Expand Chirpberry bar · \(desktop.dock.title) edge")
        .help("Hover to expand. Dock position is set in Settings → Quick capture.")
    }
    private var expandedBar: some View {
        toolbar.padding(desktop.dock.isVertical ? 6 : 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private var toolbar: some View {
        let layout = desktop.dock.isVertical ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 2))
        return layout {
            if model.active { recordingControls }
            else {
                control("Spoken language: \(language == "auto" ? "Automatic" : language.capitalized)", icon: "globe") {
                    showLanguages.toggle()
                }
                .popover(isPresented: $showLanguages, arrowEdge: popoverEdge) { languagePicker }
                divider
                control("Dictate · \(desktop.dictationShortcutLabel)", icon: "mic.fill", wide: true, accented: true) { desktop.dictate() }
                meetingControls
                divider
            }
            control("Scratchpad · ⌃⌥S", icon: "square.and.pencil") { desktop.revealScratchpad() }
        }
        .disabled(desktop.deliveringDictation)
        .padding(desktop.dock.isVertical ? 6 : 5)
        .background(Color(red: 0.37, green: 0.35, blue: 0.40).opacity(reduceTransparency ? 1 : 0.62), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.24), lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 5, y: 2)
        .accessibilityValue(desktop.feedback ?? status)
    }
    private var meetingControls: some View {
        let layout = desktop.dock.isVertical ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
        return layout {
            control("New meeting · ⌃⌥M", icon: "record.circle") { desktop.newMeeting() }
            Button {
                model.refreshCalendarIfAuthorized(); showMeetings.toggle()
            } label: {
                Image(systemName: desktop.dock == .top ? "chevron.down" : desktop.dock == .left ? "chevron.right" : desktop.dock == .right ? "chevron.left" : "chevron.up")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: desktop.dock.isVertical ? 34 : 20, height: desktop.dock.isVertical ? 20 : 34)
            }.buttonStyle(.plain).foregroundStyle(.white.opacity(0.85))
                .help(desktop.feedback ?? "Upcoming meetings (\(model.upcoming.count))")
                .accessibilityLabel("Upcoming meetings")
                .popover(isPresented: $showMeetings, arrowEdge: popoverEdge) { upcomingMeetings }
        }
    }
    @ViewBuilder private var dockMenu: some View {
        Text("Dock to screen edge")
        ForEach(BarDock.allCases, id: \.self) { edge in
            Button { desktop.setDock(edge) } label: {
                if desktop.dock == edge { Label(edge.title, systemImage: "checkmark") }
                else { Text(edge.title) }
            }
        }
        Divider()
        Button("Open notebook") { desktop.revealNotebook() }
        Button("Hide bar") { desktop.toggleBar() }.disabled(model.active)
    }
    private var popoverEdge: Edge {
        switch desktop.dock { case .top: .bottom; case .bottom: .top; case .left: .trailing; case .right: .leading }
    }
    private var divider: some View {
        Rectangle().fill(.white.opacity(0.15))
            .frame(width: desktop.dock.isVertical ? 21 : 1, height: desktop.dock.isVertical ? 1 : 21)
            .padding(desktop.dock.isVertical ? .vertical : .horizontal, 2)
    }
    private var status: String {
        switch model.recordingState {
        case .recording: model.capturePurpose == .dictation ? "Dictating · microphone only" : "Meeting in progress"
        case .connecting: "Connecting to Valsea…"
        case .paused: "Paused · microphone off"
        case .finishing: "Finishing transcript…"
        case .idle: "Ready"
        }
    }
    private func control(_ label: String, icon: String, wide: Bool = false, accented: Bool = false, action: @escaping () -> Void) -> some View {
        CompanionButton(label: label, icon: icon, wide: wide && !desktop.dock.isVertical, accented: accented,
                        feedback: desktop.feedback, action: action)
    }
    private var recordingControls: some View {
        Group {
            Image(systemName: model.capturePurpose == .dictation ? "mic.fill" : "waveform")
                .font(.system(size: 17, weight: .medium)).foregroundStyle(model.recordingState == .recording ? Color(red: 1, green: 0.63, blue: 0.72) : .white)
                .frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(recordingLabel).font(.system(size: 11, weight: .semibold))
                Text(Meeting.timeLabel(model.elapsed)).font(.system(size: 12, design: .monospaced))
            }.foregroundStyle(.white).frame(width: 64, alignment: .leading).help(status)
            if model.recordingState == .recording {
                ProgressView(value: Double(model.levels["Microphone"] ?? 0)).tint(.pink).frame(width: 28)
                    .accessibilityLabel("Microphone input level")
                control("Pause recording", icon: "pause.fill") { Task { await model.stopRecording(pause: true) } }
            } else if model.recordingState == .paused {
                control("Resume recording", icon: "play.fill") { Task { await model.resume() } }
            } else { ProgressView().controlSize(.small).colorScheme(.dark).frame(width: 34) }
            control(model.capturePurpose == .dictation ? "Finish dictation" : "Stop recording", icon: "stop.fill", accented: true) {
                Task { await model.stopRecording() }
            }.disabled(model.recordingState == .finishing)
            divider
        }
    }
    private var recordingLabel: String {
        switch model.recordingState {
        case .connecting: "Connecting"
        case .paused: "Paused"
        case .finishing: "Finishing"
        case .recording, .idle: model.capturePurpose == .dictation ? "Dictation" : "Meeting"
        }
    }
    private var languagePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Spoken language", systemImage: "globe").font(.headline)
            Text("Used for your next dictation or meeting.").font(.callout).foregroundStyle(.secondary)
            Picker("Language", selection: $language) {
                Text("Automatic · mixed languages").tag("auto")
                ForEach(["english", "singlish", "vietnamese", "chinese", "japanese", "korean", "indonesian", "malay", "thai", "hindi", "arabic"], id: \.self) {
                    Text($0.capitalized).tag($0)
                }
            }.labelsHidden().frame(maxWidth: .infinity)
            Text("Meeting translation is configured separately in your notebook.").font(.caption).foregroundStyle(.secondary)
            Button("Done") { showLanguages = false }.frame(maxWidth: .infinity, alignment: .trailing)
        }.padding(20).frame(width: 290)
    }
    private var upcomingMeetings: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Upcoming meetings").font(.headline)
                Spacer()
                Button { model.refreshCalendarIfAuthorized() } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).accessibilityLabel("Refresh upcoming meetings").disabled(!model.calendarConnected)
            }
            if !model.calendarConnected {
                Text("Bring a meeting title and attendees into your notes. Calendar access is optional.").font(.callout).foregroundStyle(.secondary)
                Button(model.calendarLoading ? "Connecting…" : "Connect calendars") {
                    Task { await model.connectCalendar() }
                }.buttonStyle(.borderedProminent).disabled(model.calendarLoading)
                if let message = model.message { Text(message).font(.caption).foregroundStyle(.secondary) }
            } else if model.upcoming.isEmpty {
                Label("Nothing coming up", systemImage: "calendar").font(.subheadline.weight(.medium))
                Text("Your next seven days are clear. Start a note whenever you need one.").font(.callout).foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(model.upcoming.prefix(12).enumerated()), id: \.offset) { _, event in
                            Button {
                                guard !model.active else { return }
                                model.createFromCalendar(event); showMeetings = false; desktop.revealNotebook()
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(event.title ?? "Meeting").font(.system(size: 13, weight: .semibold)).lineLimit(2)
                                    Text(event.startDate.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                        }
                    }
                }.frame(maxHeight: 280)
                Text("Opens preparation notes. Recording starts when you choose.").font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            Button { showMeetings = false; desktop.newMeeting() } label: { Label("New meeting", systemImage: "plus") }
        }.padding(20).frame(width: 320).tint(Brand.berry)
    }
}

private struct CompanionButton: View {
    let label: String
    let icon: String
    var wide = false
    var accented = false
    var feedback: String?
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .medium))
                .frame(width: wide ? 40 : 34, height: 34)
                .background(accented ? Brand.berry : hovering ? .white.opacity(0.12) : .clear, in: Capsule())
                .contentShape(Capsule())
        }.buttonStyle(.plain).foregroundStyle(.white)
            .help([label, feedback].compactMap { $0 }.joined(separator: "\n")).accessibilityLabel(label)
            .onHover { hovering = $0 }
    }
}

struct DictationSetupView: View {
    @ObservedObject var model: NotebookModel
    @ObservedObject var desktop: DesktopCompanion
    @State private var informed = false
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("A thought, out loud.", systemImage: "mic.fill").font(.title2.weight(.semibold)).foregroundStyle(Brand.berry)
            Text("Dictate to \(desktop.destinationName)").font(.headline)
            Text("Your microphone streams to Valsea for transcription using your API key and credits. Final words are saved in your scratchpad. No audio recording is saved.").foregroundStyle(.secondary)
            if desktop.destinationName == "Clipboard" {
                Text("When you finish, the final transcription is copied to your clipboard. Chirpberry does not paste or send it anywhere.").font(.callout).foregroundStyle(.secondary)
            } else if desktop.destinationName != "Scratchpad" {
                if desktop.canInsert {
                    Text("When you finish, Chirpberry inserts your words into the original text field. If that field is unavailable, copy them from the scratchpad.").font(.callout)
                } else {
                    Text("Direct insertion needs Accessibility access and a supported text field. This dictation will stay in your scratchpad.").font(.callout)
                    Button("Enable Accessibility…") { DictationDestination.requestPermission() }
                    Text("After granting access, cancel and start dictation again from your text field.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Toggle("I understand; anyone speaking knows they will be transcribed", isOn: $informed).toggleStyle(.checkbox)
            Text("After this setup, the Dictate button or \(desktop.dictationShortcutLabel) starts and finishes dictation. You can change the key or review this disclosure again in Settings.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { desktop.cancelDictation() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Start dictation") { desktop.beginDictation(rememberDisclosure: true) }.buttonStyle(.borderedProminent)
                    .disabled(!informed).keyboardShortcut(.defaultAction)
            }
        }.padding(28).frame(width: 460).tint(Brand.berry)
    }
}
