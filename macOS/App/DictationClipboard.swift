import AppKit

@MainActor final class DictationClipboard {
    private(set) var requested = false
    private let pasteboard: NSPasteboard
    init(pasteboard: NSPasteboard = .general) { self.pasteboard = pasteboard }
    func arm() { requested = true }
    func cancel() { requested = false }

    @discardableResult func finish(_ text: String, allowed: Bool) -> Bool {
        defer { requested = false }
        guard requested, allowed, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }
}
