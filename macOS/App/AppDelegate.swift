import AppKit

@MainActor class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: NotebookModel?
    weak var desktop: DesktopCompanion?
    private var terminationPending = false

    func confirmStop() -> Bool {
        let alert = NSAlert(); alert.messageText = "Stop recording and quit?"
        alert.informativeText = "Chirpberry will finish the transcript and save your notes before closing."
        alert.addButton(withTitle: "Stop and quit"); alert.addButton(withTitle: "Keep open")
        return alert.runModal() == .alertFirstButtonReturn
    }
    func reply(_ sender: NSApplication, saved: Bool) { sender.reply(toApplicationShouldTerminate: saved) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        if terminationPending { return .terminateLater }
        if model.active {
            guard confirmStop() else { return .terminateCancel }
            terminationPending = true
            Task {
                await model.stopRecording(deliverDictation: false)
                let saved = model.flush()
                if saved { desktop?.shutdown() }
                terminationPending = false
                reply(sender, saved: saved)
            }
            return .terminateLater
        }
        guard model.flush() else { return .terminateCancel }
        desktop?.shutdown(); return .terminateNow
    }
}
