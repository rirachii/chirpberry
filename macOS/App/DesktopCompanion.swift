import AppKit
import SwiftUI
import Combine
import ChirpberryCore

@MainActor final class DesktopCompanion: NSObject, ObservableObject, NSWindowDelegate {
    @Published var barVisible = false
    @Published private(set) var barExpanded = false
    @Published private(set) var dock: BarDock = BarDock(rawValue: UserDefaults.standard.string(forKey: "floatingBarDock") ?? "") ?? .bottom
    @Published private(set) var dictationShortcut = DictationShortcut(rawValue: UserDefaults.standard.string(forKey: "dictationShortcut") ?? "") ?? .fn
    @Published private(set) var shortcutProblem: String?
    var dictationShortcutLabel: String { dictationShortcut.label }
    @Published var feedback: String? {
        didSet {
            feedbackTask?.cancel()
            guard feedback != nil else { scheduleCollapse(); return }
            if barVisible { expandBar(); scheduleCollapse() }
            feedbackTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(7)) } catch { return }
                self?.feedback = nil
            }
        }
    }
    @Published var destinationName = "Scratchpad"
    @Published var canInsert = false
    @Published var deliveringDictation = false
    private(set) weak var model: NotebookModel?
    private var bar: NSPanel?
    private var subscriptions: Set<AnyCancellable> = []
    private let shortcuts = CompanionShortcuts()
    private let clipboard = DictationClipboard()
    private var destination: DictationDestination?
    private var pendingNoteID: UUID?
    private var openWindow: ((String) -> Void)?
    private var isClosing = false
    private var feedbackTask: Task<Void, Never>?
    private var deliveryTask: Task<Void, Never>?
    private var collapseTask: Task<Void, Never>?
    private var dockScreen: NSScreen?
    private var popoverOpen = false
    private var keyboardPinned = false
    private var menuDepth = 0
    private var recordingActive = false
    private var hoverSuppressedUntilExit = false
    private var pointerInside = false

    func attach(model: NotebookModel, openWindow: @escaping (String) -> Void) {
        guard self.model == nil else { return }
        self.model = model; self.openWindow = openWindow
        model.onDictationFinished = { [weak self] id, text, deliver in
            guard let self else { return }
            if self.clipboard.requested {
                let copied = self.clipboard.finish(text, allowed: deliver && !self.isClosing)
                self.destination = nil
                self.feedback = copied ? "Copied to clipboard" : model.message ?? (text.isEmpty ? "No final speech received; clipboard unchanged" : "Saved to your scratchpad; clipboard unchanged")
                return
            }
            let target = self.destination
            self.destination = nil
            self.deliveringDictation = deliver && target != nil
            self.deliveryTask = Task { @MainActor in
                defer { self.deliveringDictation = false }
                if deliver, let target, await target.insert(text) { self.feedback = "Inserted in \(target.name)" }
                else {
                    guard !Task.isCancelled else { return }
                    self.feedback = model.message ?? (text.isEmpty ? "No final speech received" : "Saved to your scratchpad")
                    if deliver, !self.isClosing { model.scratchpadID = id; self.revealScratchpad() }
                }
            }
        }
        model.$recordingState.removeDuplicates().sink { [weak self] state in
            guard let self else { return }
            self.recordingActive = state != .idle
            if state != .idle { self.showBar(); self.feedback = nil; self.expandBar() }
            else { self.scheduleCollapse() }
            self.reposition()
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: NSMenu.didBeginTrackingNotification)
            .sink { [weak self] _ in self?.menuDepth += 1; self?.collapseTask?.cancel() }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: NSMenu.didEndTrackingNotification)
            .sink { [weak self] _ in
                guard let self else { return }; self.menuDepth = max(0, self.menuDepth - 1); self.scheduleCollapse()
            }.store(in: &subscriptions)
        shortcuts.onAction = { [weak self] action in
            switch action { case 1: self?.dictate(); case 2: self?.newMeeting(); case 3: self?.revealScratchpad(); default: break }
        }
        configureShortcuts()
        NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in
                guard let self, self.dictationShortcut == .fn, !self.shortcuts.fnAvailable, self.model?.active != true else { return }
                self.configureShortcuts()
            }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.reposition() }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: .NSCalendarDayChanged)
            .sink { [weak model] _ in model?.refreshCalendarIfAuthorized() }.store(in: &subscriptions)
        model.refreshCalendarIfAuthorized()
        if UserDefaults.standard.object(forKey: "showFloatingBar") as? Bool != false { showBar() }
    }

    func revealNotebook() { openWindow?("notebook"); NSApp.activate(ignoringOtherApps: true) }
    func revealScratchpad() {
        guard let model else { return }
        model.ensureScratchpad(); openWindow?("scratchpad"); NSApp.activate(ignoringOtherApps: true)
    }
    func newMeeting() {
        guard let model else { return }
        guard !deliveringDictation, !model.showDictationSetup, !model.showRecordingSetup else { return }
        guard !model.active else { model.selectedID = model.recordingID; revealNotebook(); return }
        model.createMeeting(); revealNotebook(); model.openRecordingSetup()
    }
    func dictate(inScratchpad: Bool = false) {
        guard let model else { return }
        guard !deliveringDictation else { return }
        if model.active {
            if model.capturePurpose == .dictation { Task { await model.stopRecording() } }
            else { feedback = "Stop the meeting before dictating" }
            return
        }
        guard !model.showDictationSetup, !model.showRecordingSetup else { return }
        feedback = nil
        let toClipboard = !inScratchpad && dictationShortcut == .fn
        clipboard.cancel()
        if toClipboard { clipboard.arm() }
        let useActiveApp = !toClipboard && !inScratchpad && UserDefaults.standard.object(forKey: "dictateIntoActiveApp") as? Bool != false
        destination = useActiveApp ? DictationDestination() : nil
        destinationName = toClipboard ? "Clipboard" : destination?.name ?? "Scratchpad"; canInsert = destination?.available == true
        let id: UUID
        if inScratchpad { model.ensureScratchpad(); id = model.scratchpadID! }
        else { id = model.createScratchpad() }
        pendingNoteID = id
        model.prepareDictation(noteID: id)
        if UserDefaults.standard.bool(forKey: "dictationDisclosureAccepted") {
            beginDictation()
        } else { revealNotebook() }
    }
    func beginDictation(rememberDisclosure: Bool = false) {
        guard let model, let id = pendingNoteID, !model.active else { return }
        if rememberDisclosure { UserDefaults.standard.set(true, forKey: "dictationDisclosureAccepted") }
        model.selectedID = id; model.showDictationSetup = false; pendingNoteID = nil
        destination?.reactivate()
        showBar()
        Task { await model.startRecording() }
    }
    func cancelDictation() { model?.showDictationSetup = false; destination = nil; pendingNoteID = nil; clipboard.cancel() }

    func toggleBar() {
        if barVisible {
            guard model?.active != true else { feedback = "Stop recording before hiding the bar"; return }
            collapseTask?.cancel(); keyboardPinned = false; barExpanded = false
            bar?.orderOut(nil); barVisible = false; UserDefaults.standard.set(false, forKey: "showFloatingBar")
        } else { UserDefaults.standard.set(true, forKey: "showFloatingBar"); showBar() }
    }
    func focusBar() {
        keyboardPinned = true; showBar(); expandBar(); bar?.makeKeyAndOrderFront(nil)
        bar?.makeFirstResponder(bar?.contentView)
    }
    func showBar() {
        guard let model else { return }
        if bar == nil {
            let panel = CompanionPanel(contentRect: .zero,
                                       styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.title = "Chirpberry floating bar"
            panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
            panel.level = .floating; panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isMovable = false; panel.isMovableByWindowBackground = false
            panel.isReleasedWhenClosed = false; panel.delegate = self
            let host = CompanionHostingView(rootView: FloatingBar(model: model, desktop: self))
            host.onPointer = { [weak self] inside in self?.pointerChanged(inside) }
            host.onEscape = { [weak self] in self?.collapseBar() }
            panel.contentView = host
            bar = panel; reposition()
        }
        reposition()
        bar?.orderFrontRegardless(); barVisible = true
    }
    func reposition() {
        guard let bar else { return }
        let screens = NSScreen.screens
        let screen = dockScreen.flatMap { current in screens.first { $0 == current } }
            ?? bar.screen ?? NSScreen.main
        guard let screen else { return }
        dockScreen = screen
        bar.setFrame(dock.frame(in: screen.visibleFrame, expanded: barExpanded, recording: recordingActive), display: true)
    }
    func setDock(_ edge: BarDock) {
        dock = edge; UserDefaults.standard.set(edge.rawValue, forKey: "floatingBarDock")
        reposition(); scheduleCollapse()
    }
    func setDictationShortcut(_ shortcut: DictationShortcut) {
        dictationShortcut = shortcut
        UserDefaults.standard.set(shortcut.rawValue, forKey: "dictationShortcut")
        configureShortcuts()
    }
    private func configureShortcuts() {
        if feedback == shortcutProblem { feedback = nil }
        let failed = shortcuts.register(shortcut: dictationShortcut)
        shortcutProblem = failed.isEmpty ? nil : "Unavailable: \(failed.joined(separator: ", ")). Choose another dictation key or use the bar buttons."
        if let shortcutProblem { feedback = shortcutProblem }
    }
    func expandBar() {
        collapseTask?.cancel()
        guard !barExpanded else { return }
        barExpanded = true; reposition()
    }
    func pointerChanged(_ inside: Bool) {
        if !inside {
            // Resizing the panel can emit an exit while the pointer is still over it.
            if let bar, bar.frame.contains(NSEvent.mouseLocation) { return }
            if pointerInside { keyboardPinned = false }
            hoverSuppressedUntilExit = false
        }
        pointerInside = inside
        guard !hoverSuppressedUntilExit else { return }
        if inside { expandBar() } else { scheduleCollapse() }
    }
    func setPopoverOpen(_ open: Bool) {
        popoverOpen = open
        if open { expandBar() } else { scheduleCollapse() }
    }
    func collapseBar() {
        keyboardPinned = false
        guard !recordingActive, !deliveringDictation, !popoverOpen else { return }
        collapseTask?.cancel(); barExpanded = false; reposition()
        hoverSuppressedUntilExit = bar?.frame.contains(NSEvent.mouseLocation) == true
    }
    private func scheduleCollapse() {
        collapseTask?.cancel()
        guard barExpanded else { return }
        collapseTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(120)) } catch { return }
            guard let self, !self.recordingActive, !self.deliveringDictation, !self.popoverOpen,
                  !self.keyboardPinned, self.menuDepth == 0 else { return }
            // Geometry changes can synthesize mouse-exit events; check the actual pointer before folding.
            if let bar = self.bar, bar.frame.contains(NSEvent.mouseLocation) { return }
            self.barExpanded = false; self.reposition()
        }
    }
    func windowDidResignKey(_ notification: Notification) {
        keyboardPinned = false; scheduleCollapse()
    }
    func windowWillClose(_ notification: Notification) {
        barVisible = false
        windowClosed()
    }
    func windowClosed(dictationOnly: Bool = false) {
        guard let model else { return }
        if !dictationOnly || model.capturePurpose == .dictation {
            deliveryTask?.cancel(); destination = nil; clipboard.cancel()
            if model.active { Task { await model.stopRecording(deliverDictation: false) } }
        }
    }
    func shutdown() {
        isClosing = true; destination = nil; clipboard.cancel(); collapseTask?.cancel(); deliveryTask?.cancel(); feedbackTask?.cancel(); shortcuts.unregister(); subscriptions.removeAll()
    }
}

private final class CompanionHostingView<Content: View>: NSHostingView<Content> {
    var onPointer: ((Bool) -> Void)?
    var onEscape: (() -> Void)?
    private var pointerTracking: NSTrackingArea?
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onEscape?() } else { super.keyDown(with: event) }
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        // inVisibleRect follows layout changes without replacing the active tracking area.
        guard pointerTracking == nil else { return }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); pointerTracking = area
    }
    override func mouseEntered(with event: NSEvent) { onPointer?(true) }
    override func mouseExited(with event: NSEvent) { onPointer?(false) }
}


private final class CompanionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override var acceptsFirstResponder: Bool { false }
}
