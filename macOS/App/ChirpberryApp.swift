import SwiftUI
import AppKit
import ChirpberryCore

@main struct ChirpberryApp: App {
    @StateObject private var model = NotebookModel()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        Window("Chirpberry", id: "notebook") {
            NotebookView(model: model)
                .tint(Brand.berry)
                .onAppear { delegate.model = model; delegate.revealNotebook = reveal }
                .onDisappear { Task { if !(await model.prepareToQuit()) { reveal() } } }
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
        }
        MenuBarExtra("Chirpberry", systemImage: model.active ? "waveform.circle.fill" : "bird") {
            Button("Open Chirpberry") { reveal() }
            Button("New meeting") { reveal(); model.createMeeting() }
            Divider()
            if model.active {
                Text("\(model.recordingState.rawValue.capitalized) · \(Meeting.timeLabel(model.elapsed))")
                Button("Stop recording") { Task { await model.stopRecording() } }
            } else { Button("Start recording…") { reveal(); model.openRecordingSetup() } }
            Button("Quit Chirpberry") { NSApplication.shared.terminate(nil) }
        }
    }
    private func reveal() { openWindow(id: "notebook"); NSApplication.shared.activate(ignoringOtherApps: true) }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: NotebookModel?
    var revealNotebook: (() -> Void)?
    private var awaitingTermination = false
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        guard !awaitingTermination else { return .terminateLater }
        if model.active {
            let alert = NSAlert(); alert.messageText = "Stop recording and quit?"
            alert.informativeText = "Chirpberry will finish the transcript and save your notes before closing."
            alert.addButton(withTitle: "Stop and quit"); alert.addButton(withTitle: "Keep open")
            guard alert.runModal() == .alertFirstButtonReturn else { return .terminateCancel }
            awaitingTermination = true
            Task {
                let saved = await model.prepareToQuit()
                awaitingTermination = false
                sender.reply(toApplicationShouldTerminate: saved)
                if !saved { showSaveFailure() }
            }
            return .terminateLater
        }
        guard model.flush() else { showSaveFailure(); return .terminateCancel }
        return .terminateNow
    }
    private func showSaveFailure() {
        revealNotebook?()
        let alert = NSAlert(); alert.messageText = "Your notes could not be saved."
        alert.informativeText = "Chirpberry will stay open so you can export a copy or resolve the storage problem and try again."
        alert.addButton(withTitle: "Keep open")
        alert.runModal()
    }
}

enum Brand { static let berry = Color(red: 0.53, green: 0.29, blue: 0.47) }
