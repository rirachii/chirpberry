import AppKit
import EventKit
import Foundation
import ChirpberryCore

// A private stdio bridge. Audio is bounded in memory and never written to a file.
final class Output: @unchecked Sendable {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "chirpberry.bridge.output")
    private var pending = 0
    func send(_ value: [String: Any], audio: Bool = false) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return false }
        lock.lock()
        if audio && pending >= 32 { lock.unlock(); return false }
        pending += 1; lock.unlock()
        queue.async {
            do { try FileHandle.standardOutput.write(contentsOf: data + Data([10])) } catch { exit(0) }
            self.lock.lock(); self.pending -= 1; self.lock.unlock()
        }
        return true
    }
}

@MainActor final class Bridge: NSObject, NSApplicationDelegate {
    let output = Output()
    let capture = AudioCapture()
    let shortcuts = CompanionShortcuts()
    let calendar = EKEventStore()
    var failedAudio = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let output = output
        capture.onAudio = { [weak self] data, channel, level in
            if !output.send(["event": "audio", "channel": channel == "Mac audio" ? "System audio" : channel,
                             "pcm": data.base64EncodedString(), "level": level], audio: true) {
                Task { @MainActor in
                    guard let self, !self.failedAudio else { return }; self.failedAudio = true
                    await self.capture.stop()
                    _ = output.send(["event": "failure", "message": "Audio could not be delivered fast enough. Capture stopped."])
                }
            }
        }
        capture.onFailure = { message in _ = output.send(["event": "failure", "message": message]) }
        shortcuts.onAction = { action in _ = output.send(["event": "shortcut", "action": action]) }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = Data()
            while true {
                let data = FileHandle.standardInput.availableData
                if data.isEmpty { Task { @MainActor in await self?.shutdown() }; return }
                buffer.append(data)
                if buffer.count > 65536 { Task { @MainActor in await self?.shutdown() }; return }
                while let newline = buffer.firstIndex(of: 10) {
                    let line = buffer.prefix(upTo: newline); buffer.removeSubrange(...newline)
                    guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                          let id = object["id"] as? String, id.count <= 100, let command = object["command"] as? String else { continue }
                    Task { @MainActor in await self?.handle(id: id, command: command, arguments: object["arguments"] as? [String: Any] ?? [:]) }
                }
            }
        }
    }
    func handle(id: String, command: String, arguments: [String: Any]) async {
        do {
            var result: Any = true
            switch command {
            case "ping": result = ["version": 1, "microphone": true, "systemAudio": true, "calendar": true]
            case "credential.status": result = !(try ValseaKeychain.read()).isEmpty
            case "credential.read": result = try ValseaKeychain.read()
            case "credential.save":
                guard let key = arguments["key"] as? String, key.count <= 4096, !key.contains("\n"), !key.contains("\r") else { throw CoreError.invalid("Enter a valid API key.") }
                try ValseaKeychain.save(key.trimmingCharacters(in: .whitespacesAndNewlines))
            case "audio.start":
                failedAudio = false
                await capture.stop()
                try await capture.start(includeSystemAudio: arguments["systemAudio"] as? Bool == true)
            case "audio.stop": await capture.stop()
            case "shortcuts.configure":
                shortcuts.unregister()
                let failures = arguments["enabled"] as? Bool == true ? shortcuts.register(shortcut: .fn) : []
                result = ["fn": shortcuts.fnAvailable, "failures": failures]
            case "accessibility.request":
                result = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
            case "calendar.upcoming":
                guard try await calendar.requestFullAccessToEvents() else { throw CoreError.invalid("Calendar access is off. Enable it in System Settings to prepare meeting notes.") }
                let from = Date(), until = from.addingTimeInterval(7 * 86400)
                result = calendar.events(matching: calendar.predicateForEvents(withStart: from, end: until, calendars: nil))
                    .filter { !$0.isAllDay }.sorted { $0.startDate < $1.startDate }.prefix(100).map { event -> [String: Any] in
                        ["id": event.eventIdentifier ?? UUID().uuidString, "title": event.title ?? "Meeting",
                         "start": ISO8601DateFormatter().string(from: event.startDate), "end": ISO8601DateFormatter().string(from: event.endDate),
                         "location": event.location ?? ""]
                    }
            default: throw CoreError.invalid("This bridge command is not supported.")
            }
            _ = output.send(["id": id, "result": result])
        } catch {
            // OS errors may contain local metadata. Return actionable, bounded errors only.
            let message: String
            if command.hasPrefix("audio.") { await capture.stop(); message = "Capture could not start. Check Microphone and Screen & System Audio Recording permissions for Chirpberry Capture." }
            else if command.hasPrefix("credential.") { message = "Keychain could not access the Valsea key. Unlock your login keychain and try again." }
            else if command.hasPrefix("calendar.") { message = "Calendar access is unavailable. Allow Chirpberry Capture in System Settings, then try again." }
            else { message = "The Mac integration could not complete this action." }
            _ = output.send(["id": id, "error": message])
        }
    }
    func shutdown() async { shortcuts.unregister(); await capture.stop(); NSApp.terminate(nil) }
}

@main struct Entry {
    @MainActor static func main() {
        signal(SIGPIPE, SIG_IGN)
        let application = NSApplication.shared
        let bridge = Bridge(); application.delegate = bridge
        withExtendedLifetime(bridge) { application.run() }
    }
}
