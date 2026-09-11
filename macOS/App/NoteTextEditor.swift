import SwiftUI
import ChirpberryCore

struct NoteFormatRequest: Identifiable {
    let id = UUID()
    let format: NoteFormat
}

final class NoteFormatConsumption {
    private var appliedRequest: UUID?
    func consume(_ id: UUID) -> Bool {
        guard appliedRequest != id else { return false }
        appliedRequest = id
        return true
    }
}

struct NoteTextEditor: NSViewRepresentable {
    @Binding var text: String
    let formatRequest: NoteFormatRequest?
    let formatConsumption: NoteFormatConsumption
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        let editor = scroll.documentView as! NSTextView
        editor.isRichText = false; editor.allowsUndo = true
        editor.font = .systemFont(ofSize: 16); editor.textColor = .textColor
        editor.backgroundColor = .textBackgroundColor
        editor.textContainerInset = NSSize(width: 20, height: 18)
        editor.isAutomaticQuoteSubstitutionEnabled = true
        editor.isAutomaticSpellingCorrectionEnabled = true
        editor.setAccessibilityLabel("Scratchpad editor")
        editor.delegate = context.coordinator
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.text = $text
        guard let editor = scroll.documentView as? NSTextView else { return }
        context.coordinator.observeUndo(of: editor)
        if editor.string != text {
            let selection = editor.selectedRange()
            editor.string = text
            editor.setSelectedRange(NSRange(location: min(selection.location, (text as NSString).length), length: 0))
        }
        if let request = formatRequest, formatConsumption.consume(request.id) {
            DispatchQueue.main.async { [weak editor, weak coordinator = context.coordinator] in
                guard let editor, let coordinator, editor.delegate === coordinator else { return }
                coordinator.apply(request.format, to: editor)
            }
        }
    }
    static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
        (scroll.documentView as? NSTextView)?.delegate = nil
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        private weak var undoManager: UndoManager?
        private var undoObservers: [NSObjectProtocol] = []
        init(text: Binding<String>) { self.text = text }
        deinit { for observer in undoObservers { NotificationCenter.default.removeObserver(observer) } }
        func observeUndo(of editor: NSTextView) {
            guard let manager = editor.undoManager, manager !== undoManager else { return }
            for observer in undoObservers { NotificationCenter.default.removeObserver(observer) }
            undoManager = manager
            undoObservers = [Notification.Name.NSUndoManagerDidUndoChange, .NSUndoManagerDidRedoChange].map { name in
                NotificationCenter.default.addObserver(forName: name, object: manager, queue: .main) { [weak self, weak editor] _ in
                    guard let self, let editor, editor.delegate === self else { return }
                    self.synchronize(editor)
                }
            }
        }
        func apply(_ format: NoteFormat, to editor: NSTextView) {
            observeUndo(of: editor)
            let selection = editor.selectedRange()
            guard let result = format.apply(to: editor.string, selection: selection) else { return }
            let replacementLength = (result.text as NSString).length - (editor.string as NSString).length + selection.length
            let replacement = (result.text as NSString).substring(with: NSRange(location: selection.location, length: replacementLength))
            if editor.shouldChangeText(in: selection, replacementString: replacement) {
                editor.textStorage?.replaceCharacters(in: selection, with: replacement)
                editor.didChangeText(); editor.setSelectedRange(result.selection)
                editor.window?.makeFirstResponder(editor)
            }
        }
        private func synchronize(_ editor: NSTextView) {
            if text.wrappedValue != editor.string { text.wrappedValue = editor.string }
        }
        func textDidChange(_ notification: Notification) {
            if let editor = notification.object as? NSTextView { synchronize(editor) }
        }
    }
}
