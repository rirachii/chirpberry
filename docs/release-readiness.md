# Electron release readiness

Updated 2026-09-10. Chirpberry 0.2.0 remains an unnotarized implementation candidate. The native app and its document store remain separate. This checklist distinguishes implemented functionality, verification, and work that needs account or platform setup.

## Implemented

- Simplified notebook, 200-point floating companion, clipboard dictation, recording controls, final-only transcripts, translation, summaries, audio import, atomic persistence, and read-only MCP.
- Upcoming events from calendars already configured in macOS Calendar, recurring-event note preparation, reminders, and separate meeting links.
- Optional Mac call suggestions from bounded audio-process metadata, separate from Apple Calendar. Off by default; no automatic recording or browser-tab inspection. Direct provider sign-in is deferred for the first release.
- Streaming meeting questions, catch-up, suggested questions, and editable response drafts through a separate protected OpenAI key.
- Reviewed copy/Markdown sharing with private notes and transcripts opt-in, and assistant conversations excluded.
- Integration-helper recovery after timeouts: a new request waits for teardown, restores shortcuts, and never replays the failed request or resumes recording. Explicit shutdown remains terminal.

## Verification

The latest local regression run passed `scripts/verify.sh`: 32 Swift core tests, 27 native model tests, 62 desktop tests, three website tests, production builds, and MCP checks. All 26 Electron scenarios passed, including foreground-focus transfer from the companion. The separate Apple Calendar/detection package also passed six production Electron scenarios, signature/permission-declaration checks, fixture-exclusion checks, and a real bounded metadata query. The test suite includes timeout recovery, concurrent retry, shutdown during recovery, and suppression of late shortcut events. See [verification history](verification.md) for packaged-app and UI evidence, and [performance](performance.md) for the measurement procedure and limits.

Current GitHub CI results are attached to [draft PR #3](https://github.com/rirachii/chirpberry/pull/3). The matrix covers notebook tests and installer builds on macOS, Windows, and Linux. Passing CI does not establish physical device behavior.

A five-minute synthetic recording soak passed with 250 background notes: both streams stopped on Pause, Resume opened new streams, 300 finals persisted exactly once, and edited notes plus translations survived relaunch. The summed working set rose from 812 to 1,090 MiB; sustained memory performance remains open. No live audio or provider request was used.

The final tested Mac package has not replaced the installed helper-recovery candidate. Installation is deferred at the user's request to leave the current app running. No app quit or replacement is authorized by these local checks.

## Required before release

| Gate | Remaining acceptance |
| --- | --- |
| Valsea | Protected Keychain save/read has been confirmed locally. Complete in-app processing setup and verify live dictation, translated finals, last-segment delivery, summaries, audio import, and connection failures. A saved key does not establish provider acceptance. |
| Meeting AI | Save a separate OpenAI key and disclosure; verify a live answer, cancellation, source review, and response usefulness during a consented meeting. |
| macOS Calendar | The user reported granting Calendar access. A separate helper read still returned access unavailable; verify authorization and a real account's schedule, recurrence, note preparation, refresh, and disconnect through the app. Retry is supported after a helper timeout. |
| Call suggestions | Verify real Zoom, Teams, and Meet browser input attribution, lobby/mute behavior, notification delivery, explicit Start, dismissal, end-of-call rearm, and idle overhead. A successful metadata query and synthetic prompts do not establish real-call accuracy. See [detection acceptance](meeting-detection.md). |
| macOS capture and shortcuts | Verify microphone/system-audio approval and denial, both streams with headphones, pause/resume/stop/close/quit, physical Fn outside Chirpberry, and foreground-window activation from the companion. |
| Performance | Investigate growth observed in the five-minute synthetic recording run with longer per-process/heap measurements and post-stop observation. Measure consented real capture, longer idle, energy, and large-notebook interaction latency. The current synthetic and short idle measurements do not clear this gate. |
| Windows and Linux | Verify actual microphone, permission, shortcut, persistence, clean install, and upgrade behavior on each OS; Windows loopback capture needs device acceptance. Linux system audio and calendar integration are unavailable. |
| Distribution | Review the source, prepare exact-commit artifacts and checksums, verify mounted payloads and clean installation, publish and re-download assets, then verify the Homebrew cask and website download. Follow [releasing](releasing.md). |

No keys should be pasted into chat or committed. Signing is currently ad-hoc on Mac and unsigned on Windows; notarization, certificate-backed signing, and an automatic updater are not configured. Keep the signing status visible in any approved release.

## Feature scope still open

Direct Google/Microsoft OAuth, calendar integration outside macOS, and hosted share links are not implemented. The current calendar route uses accounts in macOS Calendar; sharing uses reviewed clipboard or Markdown export. These broader integrations need provider registration and hosting configuration. Automatic response insertion and automatic attendee messaging are also absent. The current response assistant supplies drafts for the user to review and copy.
