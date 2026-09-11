# Electron release readiness

Updated 2026-09-11. Chirpberry 0.2.0 remains an unnotarized implementation candidate. The native app and its document store remain separate. This checklist distinguishes implemented functionality, verification, and work that needs account or platform setup.

## Implemented

- Simplified notebook, 200-point floating companion, clipboard dictation, recording controls, final-only transcripts, translation, summaries, audio import, atomic persistence, and read-only MCP.
- Upcoming events from calendars already configured in macOS Calendar, recurring-event note preparation, reminders, and separate meeting links.
- Optional Mac call suggestions from bounded audio-process metadata, separate from Apple Calendar. Off by default; no automatic recording or browser-tab inspection. Direct provider sign-in is deferred for the first release.
- Streaming meeting questions, catch-up, suggested questions, and editable response drafts through a separate protected OpenAI key.
- Reviewed copy/Markdown sharing with private notes and transcripts opt-in, and assistant conversations excluded.
- Skippable, resumable four-step onboarding with optional service setup, first-note creation, and replay from Settings. Existing profiles keep their notebook flow.
- Graceful Electron Stop/Pause drains native queued PCM and browser partial frames before provider finalization; cancellation interrupts draining immediately. Startup checks key metadata without prompting for secret access.
- Integration-helper recovery after timeouts: a new request waits for teardown, restores shortcuts, and never replays the failed request or resumes recording. Explicit shutdown remains terminal.

## Verification

The latest local regression run passed `scripts/verify.sh`: 32 Swift core tests, 28 native model tests, 76 desktop tests, three legacy-site tests, production builds, and MCP checks. All 29 Electron scenarios passed in one complete run. Focused regressions cover graceful Stop/Pause, cancellation during drain, native sample-queue fencing, worklet partial frames and acknowledgements, and noninteractive key-presence checks. The final Swift-only queue fence was covered by the subsequent full verification run. See [review and verification](release-review-2026-09-11.md), [verification history](verification.md), and [performance](performance.md).

The full Electron stack is reviewed and merged into `main` through [PR #5](https://github.com/rirachii/chirpberry/pull/5). The GitHub matrix covers notebook tests and installer builds on macOS, Windows, and Linux; latest exact-commit results are on the PR. Passing CI does not establish physical device behavior.

A five-minute synthetic recording soak passed with 250 background notes: both streams stopped on Pause, Resume opened new streams, 300 finals persisted exactly once, and edited notes plus translations survived relaunch. The summed working set rose from 812 to 1,090 MiB; sustained memory performance remains open. No live audio or provider request was used.

The onboarding package passed eight production Electron scenarios before the release review. Artifacts prepared from `9b8f21b` are held because they precede the audio-drain and startup fixes; they must not be published. The corrected `040e04e` artifacts passed clean-source preparation, mounted payload/signature checks, source/archive hashes, and all eight production packaged UI scenarios; see the [artifact receipt](electron-candidate-artifacts.md). They remain unpublished. The tested packages have not replaced the installed helper-recovery candidate. Installation is deferred at the user's request to leave the current app running. No app quit or replacement is authorized by these local checks.

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
| Distribution | Reviewed source is merged and exact-commit Mac artifacts, checksums, and mounted-payload checks are complete. Still required: real acceptance and clean installation, final accepted-source packaging, publication and re-download verification, then the Homebrew cask and website download. Follow [releasing](releasing.md). |

No keys should be pasted into chat or committed. Signing is currently ad-hoc on Mac and unsigned on Windows; notarization, certificate-backed signing, and an automatic updater are not configured. Keep the signing status visible in any approved release.

## Feature scope still open

Direct Google/Microsoft OAuth, calendar integration outside macOS, and hosted share links are not implemented. The current calendar route uses accounts in macOS Calendar; sharing uses reviewed clipboard or Markdown export. These broader integrations need provider registration and hosting configuration. Automatic response insertion and automatic attendee messaging are also absent. The current response assistant supplies drafts for the user to review and copy.

The preserved SwiftUI NotebookModel still has its prior final-audio acceptance gate; the shared sample-queue fence does not establish that the native UI drains late PCM. This is a separate native release limitation. Electron uses the corrected controller described above.
