# Electron release readiness

Updated 2026-09-10. Chirpberry 0.2.0 remains an unnotarized implementation candidate. The native app and its document store remain separate. This checklist distinguishes implemented functionality, verification, and work that needs account or platform setup.

## Implemented

- Simplified notebook, 200-point floating companion, clipboard dictation, recording controls, final-only transcripts, translation, summaries, audio import, atomic persistence, and read-only MCP.
- Upcoming events from calendars already configured in macOS Calendar, recurring-event note preparation, reminders, and separate meeting links.
- Streaming meeting questions, catch-up, suggested questions, and editable response drafts through a separate protected OpenAI key.
- Reviewed copy/Markdown sharing with private notes and transcripts opt-in, and assistant conversations excluded.
- Integration-helper recovery after timeouts: a new request waits for teardown, restores shortcuts, and never replays the failed request or resumes recording. Explicit shutdown remains terminal.

## Verification

The latest local regression run passed `scripts/verify.sh`: 32 Swift core tests, 27 native model tests, 54 desktop tests, three website tests, production builds, and MCP checks. The test suite includes timeout recovery, concurrent retry, shutdown during recovery, and suppression of late shortcut events. See [verification history](verification.md) for packaged-app and UI evidence, and [performance](performance.md) for the measurement procedure and limits.

Current GitHub CI results are attached to [draft PR #3](https://github.com/rirachii/chirpberry/pull/3). The matrix covers notebook tests and installer builds on macOS, Windows, and Linux. Passing CI does not establish physical device behavior.

## Required before release

| Gate | Remaining acceptance |
| --- | --- |
| Valsea | Save a key directly in Settings, accept the processing disclosure, and verify live dictation, translated finals, last-segment delivery, summaries, audio import, and connection failures. |
| Meeting AI | Save a separate OpenAI key and disclosure; verify a live answer, cancellation, source review, and response usefulness during a consented meeting. |
| macOS Calendar | Complete the OS permission prompt and verify a real account's schedule, recurrence, note preparation, refresh, and disconnect. Retry is supported after a helper timeout. |
| macOS capture and shortcuts | Verify microphone/system-audio approval and denial, both streams with headphones, pause/resume/stop/close/quit, physical Fn outside Chirpberry, and foreground-window activation from the companion. |
| Performance | Measure sustained recording, a longer idle period, energy, and interaction latency with a large notebook. A short isolated idle sample is only a baseline. |
| Windows and Linux | Verify actual microphone, permission, shortcut, persistence, clean install, and upgrade behavior on each OS; Windows loopback capture needs device acceptance. Linux system audio and calendar integration are unavailable. |
| Distribution | Review the source, prepare exact-commit artifacts and checksums, verify mounted payloads and clean installation, publish and re-download assets, then verify the Homebrew cask and website download. Follow [releasing](releasing.md). |

No keys should be pasted into chat or committed. Signing is currently ad-hoc on Mac and unsigned on Windows; notarization, certificate-backed signing, and an automatic updater are not configured. Keep the signing status visible in any approved release.

## Feature scope still open

Direct Google/Microsoft OAuth, calendar integration outside macOS, and hosted share links are not implemented. The current calendar route uses accounts in macOS Calendar; sharing uses reviewed clipboard or Markdown export. These broader integrations need provider registration and hosting configuration. Automatic response insertion and automatic attendee messaging are also absent. The current response assistant supplies drafts for the user to review and copy.
