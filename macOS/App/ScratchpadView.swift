import SwiftUI
import ChirpberryCore

struct ScratchpadView: View {
    @ObservedObject var model: NotebookModel
    @ObservedObject var desktop: DesktopCompanion
    @State private var showSidebar = true
    @State private var query = ""
    @State private var version = "Notes"
    @State private var copyStatus = ""
    @State private var formatRequest: NoteFormatRequest?
    private var note: Meeting? { model.scratchpads.first { $0.id == model.scratchpadID } }
    private var visibleNotes: [Meeting] {
        model.scratchpads.filter { query.isEmpty || $0.searchableText.localizedCaseInsensitiveContains(query) }
    }
    private func binding(_ keyPath: WritableKeyPath<Meeting, String>) -> Binding<String> {
        Binding(get: { note?[keyPath: keyPath] ?? "" }, set: { value in
            if let id = note?.id { model.update(id, { $0[keyPath: keyPath] = value }) }
        })
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Image(systemName: "bird.fill").foregroundStyle(Brand.berry).font(.system(size: 23))
                Text("Scratchpad").font(.system(size: 15, weight: .semibold))
                Spacer()
                Button { showSidebar.toggle() } label: { Image(systemName: "sidebar.left") }
                    .help(showSidebar ? "Hide notes" : "Show notes").accessibilityLabel(showSidebar ? "Hide notes" : "Show notes")
                Button { model.createScratchpad(); version = "Notes" } label: { Image(systemName: "plus") }
                    .help("New scratchpad note").accessibilityLabel("New scratchpad note")
                Button {
                    model.selectedID = note?.id; model.notebookFilter = "All meetings"; model.query = ""; desktop.revealNotebook()
                } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                    .help("Open in notebook").accessibilityLabel("Open in notebook")
            }.buttonStyle(.plain).padding(.horizontal, 22).padding(.vertical, 18)
            Divider()
            HStack(spacing: 0) {
                if showSidebar { sidebar.frame(width: 210); Divider() }
                VStack(alignment: .leading, spacing: 0) {
                    if let note {
                        editorHeader(note)
                        if let message = model.message {
                            HStack(alignment: .top) {
                                Text(message).font(.callout).textSelection(.enabled)
                                Spacer()
                                Button { model.message = nil } label: { Image(systemName: "xmark") }
                                    .buttonStyle(.plain).accessibilityLabel("Dismiss scratchpad message")
                            }.padding(12).background(Brand.berry.opacity(0.08))
                        }
                        if version == "Summary" {
                            if note.enhancedNotes.isEmpty {
                                VStack(spacing: 12) {
                                    Image(systemName: "sparkles").font(.title).foregroundStyle(Brand.berry)
                                    Text("Make room for the main points.").font(.headline)
                                    Text("Choose a summary below. Valsea uses your notes and transcript; your original writing stays in Notes.")
                                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                            } else {
                                ScrollView { MarkdownNotes(text: note.enhancedNotes).padding(24) }
                            }
                        } else {
                            ZStack(alignment: .topLeading) {
                                NoteTextEditor(text: binding(\.notes), formatRequest: formatRequest)
                                    .accessibilityLabel("Scratchpad editor")
                                if note.notes.isEmpty {
                                    VStack(alignment: .leading, spacing: 9) {
                                        Text("A little room to think.").font(.system(size: 20, weight: .medium))
                                        Text("Write something down, or dictate a thought.").font(.callout)
                                    }.foregroundStyle(.secondary).padding(.horizontal, 26).padding(.top, 20).allowsHitTesting(false)
                                }
                            }.id(note.id)
                        }
                        if model.recordingID == note.id, model.active {
                            if let partial = model.partials["Microphone"], !partial.isEmpty {
                                Text("\(partial) · provisional").font(.callout).italic().foregroundStyle(.secondary)
                                    .lineLimit(2).padding(.horizontal, 24).padding(.vertical, 8)
                            }
                            RecordingBar(model: model)
                        }
                        editorFooter(note)
                    } else {
                        ContentUnavailableView("Your next thought starts here", systemImage: "square.and.pencil",
                                               description: Text("Create a note to start writing."))
                        Button("New note") { model.createScratchpad() }.padding(24)
                    }
                }.frame(minWidth: 340, maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(nsColor: .textBackgroundColor))
            }
        }.frame(minWidth: 620, minHeight: 440).tint(Brand.berry)
            .background(Color(nsColor: .windowBackgroundColor))
            .onAppear { model.ensureScratchpad() }
            .onChange(of: model.scratchpadID) { _, _ in version = "Notes"; copyStatus = ""; formatRequest = nil }
            .onDisappear {
                desktop.windowClosed(dictationOnly: true)
                model.flush()
            }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { model.createScratchpad() } label: { Label("New note", systemImage: "square.and.pencil") }
                .buttonStyle(.plain).font(.system(size: 14, weight: .medium)).padding(.horizontal, 18).padding(.top, 20)
            TextField("Search notes", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 14)
            List(selection: $model.scratchpadID) {
                ForEach(visibleNotes) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                        Text(item.notes.isEmpty ? "Your next thought…" : item.notes).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        Text(item.updatedAt, style: .date).font(.caption2).foregroundStyle(.secondary)
                    }.padding(.vertical, 8).tag(item.id)
                        .contextMenu {
                            Button("Move to Trash") { model.trash(item.id); model.ensureScratchpad() }
                                .disabled(item.id == model.recordingID || item.id == model.busyID)
                        }
                }
            }.listStyle(.sidebar)
            if visibleNotes.isEmpty { Text("No matching notes.").font(.callout).foregroundStyle(.secondary).padding(.horizontal, 18) }
            Label("Saved on this Mac", systemImage: "internaldrive").font(.caption).foregroundStyle(.secondary).padding(18)
        }
    }
    private func editorHeader(_ note: Meeting) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            TextField("Untitled note", text: binding(\.title)).font(.system(size: 24, weight: .semibold))
                .textFieldStyle(.plain).accessibilityLabel("Scratchpad title")
            HStack {
                Picker("Note version", selection: $version) { Text("Notes").tag("Notes"); Text("Summary").tag("Summary") }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 180)
                Spacer()
                Button { desktop.dictate(inScratchpad: true) } label: { Label("Dictate", systemImage: "mic") }
                    .disabled(model.active).help("Dictate into this note")
            }
        }.padding(24).padding(.bottom, -4)
    }
    private func editorFooter(_ note: Meeting) -> some View {
        HStack(spacing: 16) {
            Menu {
                ForEach(NoteFormat.allCases, id: \.self) { format in
                    Button(format.rawValue) { formatRequest = NoteFormatRequest(format: format) }
                }
            } label: { Label("Format", systemImage: "textformat") }.disabled(version != "Notes")
                .menuStyle(.borderlessButton).fixedSize()
            if model.busyID == note.id { ProgressView("Summarizing…").controlSize(.small) }
            else {
                Menu {
                    ForEach(NoteTemplate.allCases, id: \.self) { template in
                        Button(template.title) {
                            model.update(note.id, { $0.template = template })
                            Task { await model.enhance(note.id); if model.meetings.first(where: { $0.id == note.id })?.enhancedNotes.isEmpty == false { version = "Summary" } }
                        }
                    }
                } label: { Label("Summarize", systemImage: "sparkles") }
                    .menuStyle(.borderlessButton).fixedSize()
                    .disabled(model.busyID != nil || model.recordingID == note.id || (note.notes.isEmpty && note.segments.isEmpty))
                    .help("Generate a separate summary using Valsea credits")
            }
            Spacer(minLength: 6)
            Button {
                let content = version == "Summary" ? note.enhancedNotes : note.notes
                NSPasteboard.general.clearContents()
                copyStatus = NSPasteboard.general.setString(content, forType: .string) ? "Copied" : "Copy failed"
            } label: { Label(copyStatus.isEmpty ? "Copy" : copyStatus, systemImage: copyStatus == "Copied" ? "checkmark" : "doc.on.doc") }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(version == "Summary" ? note.enhancedNotes.isEmpty : note.notes.isEmpty)
                .onChange(of: note.notes) { _, _ in copyStatus = "" }
        }.font(.callout).padding(20)
    }
}

struct NoteFormatRequest: Identifiable {
    let id = UUID()
    let format: NoteFormat
}

private struct NoteTextEditor: NSViewRepresentable {
    @Binding var text: String
    let formatRequest: NoteFormatRequest?
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
        if editor.string != text {
            let selection = editor.selectedRange()
            editor.string = text
            editor.setSelectedRange(NSRange(location: min(selection.location, (text as NSString).length), length: 0))
        }
        if let request = formatRequest, request.id != context.coordinator.appliedRequest {
            context.coordinator.appliedRequest = request.id
            let selection = editor.selectedRange()
            guard let result = request.format.apply(to: editor.string, selection: selection) else { return }
            // Use NSTextView's editing contract so formatting participates in Undo.
            let replacementLength = (result.text as NSString).length - (editor.string as NSString).length + selection.length
            let replacement = (result.text as NSString).substring(with: NSRange(location: selection.location, length: replacementLength))
            if editor.shouldChangeText(in: selection, replacementString: replacement) {
                editor.textStorage?.replaceCharacters(in: selection, with: replacement)
                editor.didChangeText(); editor.setSelectedRange(result.selection)
                editor.window?.makeFirstResponder(editor)
            }
        }
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        var appliedRequest: UUID?
        init(text: Binding<String>) { self.text = text }
        func textDidChange(_ notification: Notification) {
            if let editor = notification.object as? NSTextView { text.wrappedValue = editor.string }
        }
    }
}
