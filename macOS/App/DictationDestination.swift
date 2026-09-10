import AppKit
import ApplicationServices

/// Keeps an explicit destination from the user's Dictate action. Never reads field contents.
@MainActor final class DictationDestination {
    let application: NSRunningApplication?
    private var field: AXUIElement?
    var name: String { application?.localizedName ?? "Scratchpad" }
    var available: Bool { field != nil }

    init() {
        let front = NSWorkspace.shared.frontmostApplication
        application = front?.processIdentifier == ProcessInfo.processInfo.processIdentifier ? nil : front
        if let application, AXIsProcessTrusted() { field = Self.editableField(in: application.processIdentifier) }
    }

    static func requestPermission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    func reactivate() { application?.activate() }

    func insert(_ text: String) async -> Bool {
        guard !text.isEmpty, AXIsProcessTrusted(), let application, !application.isTerminated,
              let field else { return false }
        // A changed app or field must never receive the result accidentally.
        guard let current = Self.editableField(in: application.processIdentifier), CFEqual(current, field) else { return false }
        application.activate()
        do { try await Task.sleep(for: .milliseconds(180)) } catch { return false }
        guard !Task.isCancelled, NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier,
              let focused = Self.editableField(in: application.processIdentifier), CFEqual(focused, field) else { return false }
        // Prefer direct insertion: no simulated submit keys and no clipboard mutation.
        var settable = DarwinBoolean(false)
        if AXUIElementIsAttributeSettable(field, kAXSelectedTextAttribute as CFString, &settable) == .success,
           settable.boolValue,
           AXUIElementSetAttributeValue(field, kAXSelectedTextAttribute as CFString, text as CFString) == .success {
            return true
        }
        // Unsupported editors use the saved scratchpad and its explicit Copy action.
        return false
    }

    private static func editableField(in pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        let element = unsafeBitCast(value, to: AXUIElement.self)
        var role: CFTypeRef?; var subrole: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole)
        guard (subrole as? String) != kAXSecureTextFieldSubrole,
              [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role as? String ?? "") else { return nil }
        return element
    }
}
