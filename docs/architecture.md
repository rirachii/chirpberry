# Architecture

## Native application

The SwiftUI application targets macOS 26 and Apple Silicon.
XcodeGen creates the ignored Xcode project from macOS/project.yml.
ChirpberryCore is a dependency-free Swift package containing document models, storage, transcript reduction, export, search, structured-summary parsing, and the Valsea REST client.
The app layer owns Keychain, audio capture, WebSocket lifecycle, EventKit, Foundation Models, and views.

## Data and network boundaries

Meeting documents are separate versioned JSON files under Application Support/Chirpberry/Meetings.
Writes use atomic replacement with owner-only file permissions.
Unreadable files remain untouched and are reported separately from readable meetings.
Trash is a reversible document flag; the app does not permanently delete meeting files.
Personal notes and generated notes occupy different fields.
Exports never include credentials.

Audio goes directly to api.valsea.ai over an authenticated encrypted WebSocket.
The key is stored in macOS Keychain and sent in an Authorization header, never a query string.
Chirpberry does not save microphone or computer-audio recordings.
Audio-file import uploads the explicitly selected source file through the batch API without changing the original.
Enhance notes sends the selected meeting's notes and transcript to Valsea's formatting endpoint.
Provider policies and charges apply to hosted processing.

## Live speech

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

## Meeting knowledge

EventKit reads upcoming calendar events only after the user connects calendars.
It never writes to the calendar.
Related prior notes provide a local preparation view.
Search indexes titles, personal notes, enhanced notes, speaker names, source text, and translations in memory.
On-device question answering uses Apple Foundation Models when available, with a maximum of four retrieved source excerpts and validated source indices.
Without an available model, the UI identifies its output as matching source excerpts.
The bundled chirpberry-mcp executable exposes read-only search_meetings and get_meeting tools over stdio only when a user launches it through an AI client.
No background listener, public share service, team synchronization, or outbound messaging is present.

## Verification

Core tests cover source/translation semantics, provisional/final state, deduplication, session boundaries, storage recovery, exports, parsing, and retrieval.
Provider-backed verification and actual capture tests are separate release gates from unit tests.
The website currently uses a labelled HTML illustration of the notebook.
A verified native screenshot is a separate visual acceptance task.
Release packaging must include the exact source revision, native app, MCP executable, source archive, manifest, and checksums.
