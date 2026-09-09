import Foundation

public struct FormattedNotes: Sendable {
    public var markdown: String
    public var actions: [ActionItem]
    public static func parse(_ data: Data) throws -> Self {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CoreError.invalid("The summary response was not an object.") }
        if let raw = object["raw_content"] as? String, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return Self(markdown: raw, actions: [])
        }
        var sections: [String] = []
        let fields: [(String, String)] = [("summary", "Summary"), ("agenda_items", "Agenda"), ("decisions", "Decisions"),
            ("key_discussions", "Discussion"), ("notes", "Notes"), ("customer_sentiment", "Customer sentiment"),
            ("sentiment_reasoning", "Sentiment context"), ("deal_stage", "Deal stage"), ("next_steps", "Next steps"),
            ("issue_summary", "Issue"), ("root_cause", "Root cause"), ("resolution_status", "Status"),
            ("resolution_summary", "Resolution"), ("follow_up_actions", "Follow-up"), ("semantic_flags", "Context")]
        for (key, title) in fields {
            if let value = object[key] as? String, !value.isEmpty { sections.append("### \(title)\n\n\(value)") }
            if let values = object[key] as? [String], !values.isEmpty { sections.append("### \(title)\n\n" + values.map { "- \($0)" }.joined(separator: "\n")) }
        }
        for (key, title) in [("objections", "Objections"), ("purchase_signals", "Purchase signals"), ("key_quotes", "Quotes")] {
            if let values = object[key] as? [[String: Any]], !values.isEmpty {
                let lines = values.map { value in ["phrase", "interpretation", "suggested_response"].compactMap { value[$0] as? String }.joined(separator: "\n") }
                sections.append("### \(title)\n\n" + lines.map { "- \($0)" }.joined(separator: "\n"))
            } else if let values = object[key] as? [String], !values.isEmpty { sections.append("### \(title)\n\n" + values.map { "- \($0)" }.joined(separator: "\n")) }
        }
        let actions = (object["action_items"] as? [[String: Any]] ?? []).compactMap { item -> ActionItem? in
            guard let description = item["description"] as? String, !description.isEmpty else { return nil }
            return ActionItem(description: description, owner: item["owner"] as? String, deadline: item["deadline"] as? String)
        }
        guard !sections.isEmpty || !actions.isEmpty else { throw CoreError.invalid("Valsea returned no usable notes. Your original notes and transcript are preserved.") }
        return Self(markdown: sections.joined(separator: "\n\n"), actions: actions)
    }
}
