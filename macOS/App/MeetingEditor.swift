import SwiftUI
import ChirpberryCore

struct MeetingEditor: View {
    @ObservedObject var model: NotebookModel
    let meetingID: UUID
    @State private var tab = "My notes"
    @State private var showTranscript = true
    @State private var editingEnhanced = false
    @State private var rename: SpeakerRename?
    @State private var showDetails = false
    private var meeting: Meeting { model.meetings.first { $0.id == meetingID } ?? Meeting() }
    private func binding(_ keyPath: WritableKeyPath<Meeting, String>) -> Binding<String> {
        Binding(get: { meeting[keyPath: keyPath] }, set: { value in model.update(meetingID, { $0[keyPath: keyPath] = value }) })
    }
    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HSplitView {
                VStack(spacing: 0) {
                    HStack {
                        Picker("Note version", selection: $tab) { Text("My notes").tag("My notes"); Text("Enhanced").tag("Enhanced") }.pickerStyle(.segmented).frame(maxWidth: 230)
                        Spacer()
                        if tab == "Enhanced", !meeting.enhancedNotes.isEmpty {
                            Button { editingEnhanced.toggle() } label: { Image(systemName: editingEnhanced ? "checkmark" : "pencil") }
                                .buttonStyle(.plain).help(editingEnhanced ? "Finish editing" : "Edit enhanced notes").accessibilityLabel(editingEnhanced ? "Finish editing enhanced notes" : "Edit enhanced notes")
                        }
                    }.padding(18)
                    if tab == "My notes" {
                        ZStack(alignment: .topLeading) {
                            if meeting.notes.isEmpty { Text("What matters to you?\nJot down names, questions, and the little things.").foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 6).allowsHitTesting(false) }
                            TextEditor(text: binding(\.notes)).font(.system(size: 15)).scrollContentBackground(.hidden).accessibilityLabel("My notes editor")
                        }.padding(.horizontal, 20).padding(.bottom, 20)
                    } else if !meeting.hasEnhancedContent {
                        VStack(spacing: 14) {
                            Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Brand.berry)
                            Text("Your notes, with the gaps filled in.").font(.headline)
                            Text("Valsea combines your notes and transcript into a structured summary. Your original notes stay here.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                            enhanceButton
                        }.padding(30).frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if editingEnhanced {
                        TextEditor(text: binding(\.enhancedNotes)).font(.system(size: 15)).padding(20).accessibilityLabel("Enhanced notes editor")
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 24) {
                                MarkdownNotes(text: meeting.enhancedNotes)
                                if !meeting.actions.isEmpty {
                                    Text("Actions").font(.title3.weight(.semibold))
                                    ForEach(meeting.actions) { action in
                                        Toggle(isOn: Binding(get: { action.completed }, set: { complete in
                                            model.update(meetingID, { if let index = $0.actions.firstIndex(where: { $0.id == action.id }) { $0.actions[index].completed = complete } })
                                        })) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(action.description).strikethrough(action.completed)
                                                let detail = [action.owner, action.deadline].compactMap { $0 }.joined(separator: " · ")
                                                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary) }
                                            }
                                        }.toggleStyle(.checkbox)
                                    }
                                }
                                Text("Generated notes can contain mistakes. Review them before sharing.").font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
                        }
                    }
                    HStack {
                        Menu {
                            ForEach(NoteTemplate.allCases, id: \.self) { template in Button(template.title) { model.update(meetingID, { $0.template = template }) } }
                        } label: { Label(meeting.template.title, systemImage: "doc.text") }.menuStyle(.borderlessButton).frame(maxWidth: 185)
                        Spacer()
                        enhanceButton
                    }.padding(16).background(.bar)
                }.frame(minWidth: 310)
                if showTranscript { transcript.frame(minWidth: 270, idealWidth: 330, maxWidth: 470) }
            }
        }
        .sheet(item: $rename) { item in
            SpeakerRenameView(name: item.name) { newName in model.update(meetingID, { $0.speakerNames[item.key] = newName }) }
        }
        .popover(isPresented: $showDetails) { details.padding(22).frame(width: 320) }
    }
    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(meeting.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { showDetails = true } label: { Image(systemName: "slider.horizontal.3") }.help("Meeting details").accessibilityLabel("Meeting details")
                Button { showTranscript.toggle() } label: { Image(systemName: "sidebar.right") }.help("Show or hide transcript").accessibilityLabel("Toggle transcript")
                Menu {
                    Button("Copy Markdown") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(meeting.markdown, forType: .string) }
                    Button("Export Markdown…") { model.exportKind = "md" }
                    Button("Export Chirpberry JSON…") { model.exportKind = "json" }
                    Divider()
                    Button(meeting.isPinned ? "Unpin" : "Pin meeting") { model.update(meetingID, { $0.isPinned.toggle() }) }
                    Button(meeting.isTrashed ? "Restore" : "Move to Trash") { model.trash(meetingID) }
                } label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).frame(width: 25).help("Meeting actions").accessibilityLabel("Meeting actions")
            }.buttonStyle(.plain)
            TextField("Untitled meeting", text: binding(\.title)).font(.system(size: 28, weight: .semibold)).textFieldStyle(.plain).accessibilityLabel("Meeting title")
            HStack(spacing: 12) {
                Label(meeting.notebook, systemImage: "folder").font(.caption).foregroundStyle(.secondary)
                if !meeting.attendees.isEmpty { Text(meeting.attendees.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Spacer()
                Label(meeting.targetLanguage.capitalized, systemImage: "translate").font(.caption).foregroundStyle(Brand.berry)
            }
        }.padding(24)
    }
    @ViewBuilder private var enhanceButton: some View {
        if model.busyID == meetingID { ProgressView("Enhancing…").controlSize(.small) }
        else {
            Button { Task { await model.enhance(meetingID); if meeting.hasEnhancedContent { tab = "Enhanced" } } } label: { Label("Enhance notes", systemImage: "sparkles") }
                .disabled(model.busyID != nil || (meeting.notes.isEmpty && meeting.segments.isEmpty) || meeting.isTrashed)
        }
    }
    private var transcript: some View {
        VStack(spacing: 0) {
            HStack { Text("Transcript").font(.headline); Spacer(); Text("\(meeting.segments.count) segments").font(.caption).foregroundStyle(.secondary) }.padding(18)
            Divider()
            if meeting.segments.isEmpty && model.recordingID != meetingID {
                VStack(spacing: 12) {
                    Image(systemName: "quote.bubble").font(.largeTitle).foregroundStyle(.tertiary)
                    Text("Every language, in the conversation.").font(.headline).multilineTextAlignment(.center)
                    Text("Start recording to see original speech and translated segments here.").font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.padding(28).frame(maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            ForEach(meeting.segments) { segment in segmentView(segment) }
                            if model.recordingID == meetingID {
                                ForEach(model.partials.keys.sorted(), id: \.self) { key in
                                    if let partial = model.partials[key], !partial.isEmpty {
                                        VStack(alignment: .leading, spacing: 7) {
                                            Text("\(key) · Provisional").font(.caption).foregroundStyle(.secondary)
                                            Text(partial).italic().foregroundStyle(.secondary)
                                        }.padding(.vertical, 6)
                                    }
                                }
                            }
                            Color.clear.frame(height: 1).id("latest")
                        }.padding(20)
                    }
                    .onChange(of: meeting.segments.count) { _, _ in if model.recordingID == meetingID { proxy.scrollTo("latest", anchor: .bottom) } }
                }
            }
        }.background(Color(nsColor: .controlBackgroundColor).opacity(0.45))
    }
    private func segmentView(_ segment: TranscriptSegment) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(Meeting.timeLabel(segment.timestamp)).monospacedDigit()
                Spacer()
                Text(segment.sourceLanguage?.capitalized ?? segment.channel)
            }.font(.caption).foregroundStyle(.secondary)
            if segment.utterances.isEmpty {
                speakerButton(segment, speaker: nil)
                Text(segment.original.isEmpty ? "Original text was not supplied by Valsea." : segment.original).textSelection(.enabled)
            } else {
                ForEach(Array(segment.utterances.enumerated()), id: \.offset) { _, utterance in
                    speakerButton(segment, speaker: utterance.speaker)
                    Text(utterance.transcript).textSelection(.enabled)
                }
            }
            if let translated = segment.translation {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(segment.targetLanguage?.capitalized ?? "Translation") · whole segment").font(.caption).foregroundStyle(Brand.berry)
                    Text(translated).textSelection(.enabled)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Brand.berry.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
            }
        }.font(.system(size: 13.5))
    }
    private func speakerButton(_ segment: TranscriptSegment, speaker: Int?) -> some View {
        let name = meeting.speakerName(channel: segment.channel, speaker: speaker, scope: segment.speakerScope)
        return Button(name) { rename = SpeakerRename(key: Meeting.speakerKey(channel: segment.channel, speaker: speaker, scope: segment.speakerScope), name: name) }
            .font(.caption.weight(.semibold)).foregroundStyle(Brand.berry).buttonStyle(.plain).help("Rename this speaker within this capture session")
    }
    private var details: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Meeting details").font(.headline)
            TextField("Notebook", text: binding(\.notebook)).textFieldStyle(.roundedBorder)
            Picker("Translate to", selection: binding(\.targetLanguage)) {
                ForEach(TranslationLanguage.targets, id: \.self) { Text($0.capitalized).tag($0) }
            }.disabled(model.recordingID == meetingID)
            Text("Names and vocabulary").font(.subheadline)
            TextEditor(text: binding(\.vocabulary)).frame(height: 80).border(.quaternary)
            Text("Used as Valsea context when you start or resume recording.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct SpeakerRename: Identifiable { var id: String { key }; var key: String; var name: String }
struct SpeakerRenameView: View {
    @Environment(\.dismiss) var dismiss
    @State var name: String
    var save: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Who is speaking?").font(.title2.weight(.semibold))
            TextField("Speaker name", text: $name).textFieldStyle(.roundedBorder)
            Text("This updates matching speaker labels within the same capture session.").foregroundStyle(.secondary).font(.callout)
            HStack { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction); Spacer(); Button("Save name") { save(name.trimmingCharacters(in: .whitespacesAndNewlines)); dismiss() }.keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
        }.padding(26).frame(width: 380)
    }
}

struct MarkdownNotes: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(text.components(separatedBy: .newlines).enumerated()), id: \.offset) { _, line in
                if line.hasPrefix("#") {
                    Text(String(line.drop(while: { $0 == "#" || $0 == " " }))).font(.system(size: 18, weight: .semibold)).padding(.top, 8)
                } else if !line.isEmpty { Text(.init(line)).font(.system(size: 15)).lineSpacing(4).textSelection(.enabled) }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
