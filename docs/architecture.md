# Architecture

## Desktop direction

Electron is the approved shared desktop framework. The React/TypeScript implementation candidate is in `desktop/`; the existing SwiftUI implementation remains available during migration.
Electron provides local document editing, search, organization, transcript inspection, import/export, recording, dictation, and Valsea summaries. A single main-process controller owns capture from every UI and shortcut, with per-phase streams and final-only persistence. Mac capture/Keychain/Fn reuse native code through a bounded private stdio helper; Windows/Linux audio uses an isolated capture renderer and worklet. Provider networking and credentials stay in main. Closing either capture surface reaches the shared recording owner with clipboard delivery disabled; a full Stop upgrades any pending Pause. Capture adapters retain pending helper teardown across cancellation, and application shutdown awaits native child exit after bounded force-termination escalation. See `desktop/README.md` for capability limits and verification.
Electron's sandboxed renderer loads bundled code through a restricted custom protocol. Validated preload methods route document operations to the main process; no raw filesystem, shell, or Electron API is exposed to the renderer.
The Electron candidate uses `Chirpberry Desktop/Meetings` under the OS application-data directory. Import creates a new document identity and leaves the source file untouched. It never automatically opens or migrates the native app's store.
The version-1 JSON format stays compatible with the Swift model, including whole-second ISO8601 dates, final segments, speaker scope, optional Scratchpad identity, and separate personal/generated notes. Unsupported fields or schema versions are rejected to avoid silently discarding data.
See [desktop development](../desktop/README.md) and the [framework decision](desktop-framework-evaluation.md).

## Native application

The SwiftUI application targets macOS 26 and Apple Silicon.
XcodeGen creates the ignored Xcode project from macOS/project.yml.
ChirpberryCore is a dependency-free Swift package containing document models, storage, transcript reduction, export, search, structured-summary parsing, and the Valsea REST client.
The app layer owns Keychain, audio capture, WebSocket lifecycle, EventKit, Foundation Models, and views.
`DesktopCompanion` owns the floating NSPanel, global shortcuts, and explicit dictation destination.
Scratchpad uses the same NotebookModel and atomic meeting store; capture remains a single shared lifecycle.
Dictation forces microphone-only source transcription and appends final speech to an ordinary scratchpad document.
See [desktop companion](desktop-companion.md) for window lifecycle, external insertion, and compatibility contracts.

## Data and network boundaries

Native meeting documents are separate versioned JSON files under Application Support/Chirpberry/Meetings. Electron uses the independent store described above.
Writes use atomic replacement with owner-only file permissions. Both stores validate the exact serialized output against the 32 MiB reload limit before replacing a document. Native quit waits for shared capture finalization and cancels termination if a document cannot be saved, retaining in-memory edits for export.
Unreadable files remain untouched and are reported separately from readable meetings.
Trash is a reversible document flag; the app does not permanently delete meeting files.
Personal notes and generated notes occupy different fields.
Exports never include credentials.

Audio goes directly to api.valsea.ai over an authenticated encrypted WebSocket.
The key is stored in macOS Keychain, or protected Electron safeStorage on Windows/Linux, and sent in an Authorization header, never a query string. Linux rejects the plaintext fallback backend.
Chirpberry does not save microphone or computer-audio recordings.
Audio-file import uploads the explicitly selected source file through the batch API without changing the original.
Enhance notes sends the selected meeting's notes and transcript to Valsea's formatting endpoint.
Provider policies and charges apply to hosted processing.

## Live speech

The Apple capture APIs below serve the native app and Electron's Mac helper. Electron's Windows/Linux adapter instead uses its isolated capture renderer and continuous PCM worklet; Linux has no system-audio integration. See the platform limits in [desktop development](../desktop/README.md).

Microphone-only capture uses AVAudioEngine.
The optional Mac audio mode uses ScreenCaptureKit audio and microphone outputs; no screen output handler or video recording is installed.
Audio is converted to mono 16 kHz signed 16-bit PCM with AVAudioConverter.
Microphone and Mac audio use separate bounded queues and Valsea notetaker streams, preserving their input identity.
This mode incurs two speech streams; optional diarization increases provider usage further.
No paid rate-limit override is requested.

Each connection waits for session.ready before accepting audio.
Provisional source captions are transient.
Only transcript.final events enter the persisted history.
When translated is true, text is the translation and rawText is the source.
A translation belongs to a complete provider segment, not independently to every diarized utterance.
Speaker identities are scoped to the capture session, so a resumed session does not silently inherit a different speaker's name.
Provider timestamps are displayed as segment timing; word-accurate timing is not claimed.
Pause stops capture and ends provider streams; resume creates new streams.
Stop drains queued audio and waits for final events for a bounded period.
Errors retain saved notes and final segments; unsaved audio cannot be recovered because the app does not record it to disk.

Companion renderer termination cancels Electron capture through the shared recording owner with clipboard delivery suppressed. Native audio imports append to the current document after transcription and attach translation by the imported segment's UUID, preserving live finals and personal notes across both requests. Native document decode and save reject negative or non-finite timing, timing at or above the platform integer limit, and speaker indices outside `0..<Int.max`; display formatting also tolerates invalid in-memory values. Scratchpad retains consumed formatting identity in the parent view so Notes/Summary switches cannot replay an earlier edit. Formatting executes outside SwiftUI view updates, and native undo/redo synchronizes the notes binding for persistence.

## Meeting knowledge

EventKit reads upcoming calendar events only after the user connects calendars.
It never writes to the calendar.
Related prior notes provide a local preparation view.
Search indexes titles, personal notes, enhanced notes, speaker names, source text, and translations in memory.
Native on-device question answering uses Apple Foundation Models when available, with a maximum of four retrieved source excerpts and validated source indices. Electron does not yet implement this feature.
Without an available model, the UI identifies its output as matching source excerpts.
The native chirpberry-mcp executable and Electron's portable mcp.cjs expose read-only search_meetings and get_meeting tools over stdio only when a user launches them through an AI client. The portable entrypoint requires Node 22+ and an explicit notebook directory.
No background listener, public share service, team synchronization, or outbound messaging is present.

## Verification

Core tests cover source/translation semantics, provisional/final state, deduplication, session boundaries, storage recovery, exports, parsing, and retrieval.
Provider-backed verification and actual capture tests are separate release gates from unit tests.
The website currently uses a labelled HTML illustration of the notebook.
A verified native screenshot is a separate visual acceptance task.
Release packaging must include the exact source revision, the selected app and its MCP entrypoint, source archive, manifest, and checksums. Native and Electron release scripts and artifacts are separate; [releasing](releasing.md) owns those procedures.
