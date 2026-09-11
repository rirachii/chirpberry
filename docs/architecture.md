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
Electron startup checks saved-key presence without decrypting a secret. The Mac helper requests attributes only with both legacy and modern authentication UI disabled, restoring its prior UI policy synchronously. Presence does not prove that the key unlocks or authenticates. Actual secret reads follow explicit recording, import, summary, or meeting-AI actions; cloud disclosures remain independently required.
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
Stop drains queued audio and waits for final events for a bounded period. Electron permits PCM during an explicit graceful Stop/Pause drain only; cancellation, failure, disclosure revocation, and window termination immediately abort that drain. The Mac helper fences its shared sample queue after stopping the producers, then acknowledges Stop after queued output. The browser worklet flushes its partial frame and waits for IPC acknowledgements before contexts close; main destroys a stalled capture window after three seconds. Provider finalization starts after the audio drain.
Errors retain saved notes and final segments; unsaved audio cannot be recovered because the app does not record it to disk.

Companion renderer termination cancels Electron capture through the shared recording owner with clipboard delivery suppressed. Native audio imports create a new document before transcription, append to that document by its captured ID, and attach translation by the imported segment's UUID, preserving concurrent live finals and personal notes across both requests. Native document decode and save reject negative or non-finite timing, timing at or above the platform integer limit, and speaker indices outside `0..<Int.max`; display formatting also tolerates invalid in-memory values. Scratchpad retains consumed formatting identity in the parent view so Notes/Summary switches cannot replay an earlier edit. Formatting executes outside SwiftUI view updates, and native undo/redo synchronizes the notes binding for persistence.

## Meeting knowledge

EventKit reads upcoming calendar events only after the user connects calendars.
It never writes to the calendar.
Electron's Upcoming tracker refreshes every minute while connected, preserves event-occurrence identity, coalesces concurrent refreshes and note creation, and discards pending results after disconnect. Explicit Connect may request permission; background refresh never requests it. Calendar errors keep the last schedule visibly stale. Optional reminders are local notifications; event links must be HTTPS. Native related prior notes provide a local preparation view.
Calendar connection state is restored during runtime initialization before the notebook opens and changes through explicit calendar actions or changed calendar settings. Companion loading and shortcut configuration must not reapply a captured calendar setting after an asynchronous wait; doing so can erase a connection made during startup.
Optional Mac call suggestions use a separate metadata-only controller and a bounded Core Audio helper query. Only recognized source enums leave the helper; no audio, windows, or tab content are read. Detection is off by default, independent of calendars, and cannot start recording. A fresh Start notes action enters the existing capture owner. Tokens expire, dismissal suppresses repeats, capture suppresses prompts, and shutdown discards pending results. See [call suggestions](meeting-detection.md).
Search indexes titles, personal notes, enhanced notes, speaker names, source text, and translations in memory.
Native on-device question answering uses Apple Foundation Models when available, with a maximum of four retrieved source excerpts and validated source indices. Without an available native model, the UI identifies its output as matching source excerpts.
Electron's optional meeting assistant uses main-process OpenAI Responses streaming with a separate protected API key and disclosure, `store: false`, no tools, and bounded input/output and timeouts. Each request snapshots only the selected meeting's notes, generated summary, and persisted final speech; source IDs resolve to immutable excerpts. Threads hold up to eight answers per meeting across twenty meetings in session memory. Cancellation, deletion, and shutdown ignore late chunks. Switching notes cannot retarget a response; assistant cancellation is independent of capture.
Reviewed sharing builds a main-process snapshot from explicitly selected note sections. A ten-minute token binds copy/export to that exact content. Notes and transcript are opt-in; assistant conversations never enter the document or share payload. Markdown export uses atomic replacement. The [meeting assistant contract](meeting-assistant.md) owns setup and acceptance details.
The native chirpberry-mcp executable and Electron's portable mcp.cjs expose read-only search_meetings and get_meeting tools over stdio only when a user launches them through an AI client. See [Electron MCP usage](../desktop/README.md#implemented-behavior) for runtime and notebook-directory selection.
No background listener, public share service, team synchronization, or outbound messaging is present.

## Verification

Core tests cover source/translation semantics, provisional/final state, deduplication, session boundaries, storage recovery, exports, parsing, and retrieval.
The long-lived Mac integration helper can recover after a timeout or process failure on the next request. Recovery awaits the previous process's exit, ignores its late events, starts one replacement, and restores the saved shortcut configuration. The failed action is never replayed. Explicit shutdown is terminal, and capture helpers retain terminal cancellation semantics; integration recovery cannot resume recording.

Provider-backed verification and actual capture tests are separate release gates from unit tests. The current outstanding gates are tracked in [release readiness](release-readiness.md).
The repository `site/` directory is the legacy native marketing draft. The current public onboarding website has a separate source checkout and deployment; see [website ownership](releasing.md#public-website).
Release packaging must include the exact source revision, the selected app and its MCP entrypoint, source archive, manifest, and checksums. Native and Electron release scripts and artifacts are separate; [releasing](releasing.md) owns those procedures.

## First-run setup state

`shared/onboarding.ts` defines a bounded step enum and strict IPC update. `settings.json` stores the current step atomically through the serialized settings patch queue. New profiles default to `welcome`; existing valid settings without this field load as `complete` without changing other preferences. The renderer receives key-presence status only and uses the existing protected key-save endpoint. Guide updates cannot patch unrelated settings or start capture. Calendar and detection reuse their existing explicit-action endpoints. The guide hides while capture is active; main rejects setup updates during recording and stops capture if disclosure is revoked across an asynchronous settings write. Replay uses local step state and does not reset completion.
