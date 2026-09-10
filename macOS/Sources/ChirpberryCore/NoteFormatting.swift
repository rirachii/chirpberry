import Foundation

public enum NoteFormat: String, CaseIterable, Sendable {
    case bold = "Bold", italic = "Italic", heading = "Heading", bullets = "Bullet list", checklist = "Checklist"

    /// AppKit selections are UTF-16 ranges. Reject stale ranges rather than damaging text.
    public func apply(to text: String, selection: NSRange) -> (text: String, selection: NSRange)? {
        guard let range = Range(selection, in: text) else { return nil }
        let selected = String(text[range])
        let replacement: String
        let cursorOffset: Int
        switch self {
        case .bold, .italic:
            let marker = self == .bold ? "**" : "_"
            replacement = marker + selected + marker
            cursorOffset = marker.utf16.count
        case .heading, .bullets, .checklist:
            let prefix = self == .heading ? "## " : self == .bullets ? "- " : "- [ ] "
            replacement = selected.components(separatedBy: "\n").map { prefix + $0 }.joined(separator: "\n")
            cursorOffset = prefix.utf16.count
        }
        let result = text.replacingCharacters(in: range, with: replacement)
        return (result, NSRange(location: selection.location + cursorOffset, length: selected.utf16.count))
    }
}

public enum DictationText {
    public static func appending(_ finalText: String, to notes: String) -> String {
        let words = finalText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return notes }
        return notes + (notes.isEmpty || notes.last?.isWhitespace == true ? "" : " ") + words
    }
}
