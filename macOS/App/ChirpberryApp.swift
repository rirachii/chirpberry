import SwiftUI
import AppKit
import ChirpberryCore

@main struct ChirpberryApp: App {
    @StateObject private var model = NotebookModel()
    @StateObject private var desktop = DesktopCompanion()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        Window("Chirpberry", id: "notebook") {
            NotebookView(model: model, desktop: desktop)
                .tint(Brand.berry)
                .onAppear {
                    delegate.model = model; delegate.desktop = desktop
                    desktop.attach(model: model) { openWindow(id: $0) }
                }
                .onDisappear { desktop.windowClosed(); model.flush() }
        }
        .defaultSize(width: 1250, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New meeting") { reveal(); model.createMeeting() }.keyboardShortcut("n")
                Button("Import notes or audio…") { reveal(); model.showImporter = true }.keyboardShortcut("o")
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { reveal(); model.showSettings = true }.keyboardShortcut(",")
            }
            CommandMenu("Meeting") {
                Button("Start or resume recording…") { reveal(); model.openRecordingSetup() }.keyboardShortcut("r", modifiers: [.command, .shift])
                Button("Stop recording") { Task { await model.stopRecording() } }.disabled(!model.active).keyboardShortcut(".", modifiers: [.command])
                Divider()
                Button("Ask your notes…") { reveal(); model.showAsk = true }.keyboardShortcut("k", modifiers: [.command])
                Button("Upcoming meetings…") { reveal(); model.showUpcoming = true }
                Button("Export Markdown…") { model.exportKind = "md" }.disabled(model.selected == nil).keyboardShortcut("e", modifiers: [.command, .shift])
            }
            CommandMenu("Quick capture") {
                Button("Dictate…") { desktop.dictate() }.keyboardShortcut("d", modifiers: [.control, .option])
                Button("New meeting…") { desktop.newMeeting() }.keyboardShortcut("m", modifiers: [.control, .option])
                Button("Scratchpad") { desktop.revealScratchpad() }.keyboardShortcut("s", modifiers: [.control, .option])
                Divider()
                Button(desktop.barVisible ? "Hide floating bar" : "Show floating bar") { desktop.toggleBar() }.disabled(model.active)
                Button("Collapse floating bar") { desktop.collapseBar() }.disabled(model.active)
                Menu("Dock bar") {
                    ForEach(BarDock.allCases, id: \.self) { edge in
                        Button { desktop.setDock(edge) } label: {
                            if desktop.dock == edge { Label(edge.title, systemImage: "checkmark") }
                            else { Text(edge.title) }
                        }
                    }
                }
                Button("Focus floating bar") { desktop.focusBar() }.keyboardShortcut("b", modifiers: [.command, .shift])
            }
        }
        Window("Chirpberry Scratchpad", id: "scratchpad") {
            ScratchpadView(model: model, desktop: desktop)
        }.defaultSize(width: 860, height: 580)
        MenuBarExtra("Chirpberry", systemImage: model.active ? "waveform.circle.fill" : "bird") {
            Button("Open Chirpberry") { reveal() }
            Button("New meeting…       ⌃⌥M") { desktop.newMeeting() }
            Button("Dictate…                 \(desktop.dictationShortcutLabel)") { desktop.dictate() }.disabled(model.active && model.capturePurpose != .dictation)
            Button("Scratchpad              ⌃⌥S") { desktop.revealScratchpad() }
            Button(desktop.barVisible ? "Hide floating bar" : "Show floating bar") { desktop.toggleBar() }.disabled(model.active)
            Divider()
            if model.active {
                Text("\(model.recordingState.rawValue.capitalized) · \(Int(model.elapsed / 60)) min")
                Button("Stop recording") { Task { await model.stopRecording() } }
            } else { Button("Start recording…") { reveal(); model.openRecordingSetup() } }
            Button("Quit Chirpberry") { NSApplication.shared.terminate(nil) }
        }
    }
    private func reveal() { openWindow(id: "notebook"); NSApplication.shared.activate(ignoringOtherApps: true) }
}
