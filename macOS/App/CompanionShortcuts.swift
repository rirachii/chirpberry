import AppKit
import Carbon

enum DictationShortcut: String, CaseIterable {
    case fn, controlOptionD, tab
    var title: String {
        switch self { case .fn: "Fn / Globe · clipboard"; case .controlOptionD: "Control–Option–D"; case .tab: "Tab" }
    }
    var label: String { switch self { case .fn: "Fn"; case .controlOptionD: "⌃⌥D"; case .tab: "Tab" } }
}

/// Only modifier state and whether another key was used are retained, never typed text.
struct FnPressTracker {
    private var held = false
    private var usedWithAnotherKey = false
    private var capturedPress = false

    mutating func process(keyCode: UInt16, flagsChanged: Bool, fnDown: Bool, otherModifiers: Bool) -> (consume: Bool, activate: Bool) {
        if flagsChanged, keyCode == UInt16(kVK_Function) {
            if fnDown {
                if !held { held = true; usedWithAnotherKey = otherModifiers; capturedPress = !otherModifiers }
                return (capturedPress, false)
            }
            let result = (capturedPress, held && !usedWithAnotherKey && !otherModifiers)
            self = Self()
            return result
        }
        if held { usedWithAnotherKey = true }
        return (false, false)
    }
}

@MainActor final class CompanionShortcuts {
    private var hotkeys: [EventHotKeyRef] = []
    private var handler: EventHandlerRef?
    private var localTabMonitor: Any?
    private var localFnMonitor: Any?
    private var fnTap: CFMachPort?
    private var fnSource: CFRunLoopSource?
    private var fnPress = FnPressTracker()
    private var registration = UUID()
    private var heldKeys: Set<UInt32> = []
    var fnAvailable: Bool { fnTap != nil }
    var onAction: ((UInt32) -> Void)?

    func register(shortcut: DictationShortcut) -> [String] {
        unregister()
        var eventTypes = [kEventHotKeyPressed, kEventHotKeyReleased].map {
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32($0))
        }
        let context = Unmanaged.passUnretained(self).toOpaque()
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var hotkey = EventHotKeyID()
            let result = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                          MemoryLayout<EventHotKeyID>.size, nil, &hotkey)
            guard result == noErr else { return result }
            guard hotkey.signature == 0x43485250 else { return OSStatus(eventNotHandledErr) }
            let owner = Unmanaged<CompanionShortcuts>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { owner.handleKey(hotkey.id, pressed: GetEventKind(event) == UInt32(kEventHotKeyPressed)) }
            return noErr
        }, eventTypes.count, &eventTypes, context, &handler)
        guard status == noErr else { return ["Keyboard shortcuts"] }
        var failed: [String] = []
        var bindings: [(UInt32, Int, UInt32, String)] = [
            (1, kVK_ANSI_D, UInt32(controlKey | optionKey), "⌃⌥D"),
            (2, kVK_ANSI_M, UInt32(controlKey | optionKey), "⌃⌥M"),
            (3, kVK_ANSI_S, UInt32(controlKey | optionKey), "⌃⌥S")
        ]
        if shortcut == .tab { bindings.append((4, kVK_Tab, 0, "Tab")) }
        for (id, key, modifiers, label) in bindings {
            var reference: EventHotKeyRef?
            let result = RegisterEventHotKey(UInt32(key), modifiers,
                                            EventHotKeyID(signature: 0x43485250, id: id), GetApplicationEventTarget(), UInt32(kEventHotKeyExclusive), &reference)
            if result == noErr, let reference { hotkeys.append(reference) } else { failed.append(label) }
        }
        if shortcut == .tab, !failed.contains("Tab") {
            // Directly delivered app events do not pass through the global hotkey dispatcher.
            localTabMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
                let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift, .function])
                guard event.keyCode == UInt16(kVK_Tab), modifiers.isEmpty else { return event }
                self?.handleKey(4, pressed: event.type == .keyDown)
                return nil
            }
        }
        if shortcut == .fn, !registerFn() { failed.append("Fn (enable Accessibility access)") }
        return failed
    }

    private func registerFn() -> Bool {
        // Carbon cannot register the modifier-only Fn key. Use an event tap on the main run loop.
        // Swallow only the selected Fn press/release; pass ordinary typing and Fn combinations on.
        let mask = (CGEventMask(1) << CGEventType.flagsChanged.rawValue) |
            (CGEventMask(1) << CGEventType.keyDown.rawValue) | (CGEventMask(1) << 14)
        let context = Unmanaged.passUnretained(self).toOpaque()
        fnTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                 eventsOfInterest: mask, callback: { _, type, event, context in
            guard let context else { return Unmanaged.passUnretained(event) }
            let owner = Unmanaged<CompanionShortcuts>.fromOpaque(context).takeUnretainedValue()
            let consume = MainActor.assumeIsolated {
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    owner.fnPress = FnPressTracker()
                    if let tap = owner.fnTap { CGEvent.tapEnable(tap: tap, enable: true) }
                    return false
                }
                let flags = event.flags
                let result = owner.fnPress.process(keyCode: type == .flagsChanged ? UInt16(truncatingIfNeeded: event.getIntegerValueField(.keyboardEventKeycode)) : 0,
                    flagsChanged: type == .flagsChanged, fnDown: flags.contains(.maskSecondaryFn),
                    otherModifiers: !flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty)
                // Keep the event tap fast; disk/network/UI work runs after this callback returns.
                if result.activate { owner.enqueueFnAction() }
                return result.consume
            }
            return consume ? nil : Unmanaged.passUnretained(event)
        }, userInfo: context)
        if let fnTap {
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, fnTap, 0)
            fnSource = source
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            CGEvent.tapEnable(tap: fnTap, enable: true)
            return true
        }
        // An app-local fallback remains usable before global Accessibility permission is granted.
        localFnMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown, .systemDefined]) { [weak self] event in
            guard let self else { return event }
            let result = self.fnPress.process(keyCode: event.type == .flagsChanged ? event.keyCode : 0, flagsChanged: event.type == .flagsChanged,
                fnDown: event.modifierFlags.contains(.function),
                otherModifiers: !event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty)
            if result.activate { self.enqueueFnAction() }
            return result.consume ? nil : event
        }
        return false
    }

    func enqueueFnAction() {
        let current = registration
        DispatchQueue.main.async { [weak self] in
            guard let self, self.registration == current else { return }
            self.onAction?(1)
        }
    }

    func handleKey(_ id: UInt32, pressed: Bool) {
        guard (1...4).contains(id) else { return }
        if pressed {
            guard heldKeys.insert(id).inserted else { return }
            onAction?(id == 4 ? 1 : id)
        } else { heldKeys.remove(id) }
    }

    func unregister() {
        registration = UUID()
        heldKeys.removeAll()
        fnPress = FnPressTracker()
        if let localFnMonitor { NSEvent.removeMonitor(localFnMonitor) }; localFnMonitor = nil
        if let fnTap { CGEvent.tapEnable(tap: fnTap, enable: false); CFMachPortInvalidate(fnTap) }; fnTap = nil
        if let fnSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), fnSource, .commonModes) }; fnSource = nil
        if let localTabMonitor { NSEvent.removeMonitor(localTabMonitor) }; localTabMonitor = nil
        hotkeys.forEach { UnregisterEventHotKey($0) }; hotkeys.removeAll()
        if let handler { RemoveEventHandler(handler) }; handler = nil
    }
}
