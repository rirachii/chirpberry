# Verification status

Last updated 2026-09-09.
This is an engineering checkpoint, not a claim that live provider or native acceptance has passed.

## Passed locally

- 20 Swift core tests: transcript source/translation semantics, provisional/final state, duplicate handling, speaker scope, JSON round-trips, corrupt-file recovery, file permissions, exports, summaries, search, HTTP error handling, upload size/header boundaries, Unicode limits, and continuous PCM conversion at 44.1/48 kHz.
- MCP process tests: initialization, discovery, read-only annotations, search, full reads, invalid UUID rejection, and trash exclusion.
- Three website release-contract tests and the production Vite build.
- Four Brave/Playwright browser tests: WCAG A/AA automated audit, widths from 320 to 1440 pixels, language examples, installation help, both copy buttons, clipboard denial fallback, and JavaScript-disabled navigation.
- Desktop and phone website screenshot review.
- Native Release arm64 compilation and ad-hoc signature verification on macOS 26.5.1 with Xcode 26.

The PCM tests found and fixed a converter callback that supplied more frames than requested.
The website audit found and fixed insufficient contrast in small preview labels.
Fixture responses are synthetic test data and are not evidence of real Valsea success.

## Still required

- Native light/dark appearance, narrow-window behavior, keyboard and VoiceOver labels on an unlocked Mac.
- Real microphone permission denial/approval, start, pause, resume, stop, closing the window, and quitting during capture.
- System-audio permission and capture from a consented test call, including headphones and both input streams.
- Live Valsea session readiness, final source/translation pairing, last-segment delivery on Stop, a structured summary, and audio import.
- Real connection failure, insufficient-credit handling where available, and API-key save/reload.
- Native create/edit/relaunch persistence, export/import, speaker rename, trash/restore, calendar authorization, and Apple Intelligence availability paths.
- No-mistakes pipeline review and GitHub CI.
- Exact-commit DMG packaging and mount verification, public asset download checksum, Homebrew installation, and production site download.

The native test session is blocked by the workstation lock screen.
Provider acceptance is waiting for a Valsea credential; no credential or paid credit purchase is included in the repository.
These gates must be completed and recorded before marking the first release verified.
