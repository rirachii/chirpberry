# Verification status

Last updated 2026-09-09.
This is an engineering checkpoint, not a claim that live provider or native acceptance has passed.

## Passed locally

- 20 Swift core tests: transcript source/translation semantics, provisional/final state, duplicate handling, speaker scope, JSON round-trips, corrupt-file recovery, file permissions, exports, summaries, search, HTTP error handling, upload size/header boundaries, Unicode limits, and continuous PCM conversion at 44.1/48 kHz.
- MCP process tests: initialization, discovery, read-only annotations, search, full reads, invalid UUID rejection, and trash exclusion.
- 15 native document/notebook regression tests, including the synthetic bilingual journey, and seven offline public-release gate tests.
- Three website release-contract tests and the production Vite build.
- Four Brave/Playwright browser tests: WCAG A/AA automated audit, widths from 320 to 1440 pixels, language examples, installation help, both copy buttons, clipboard denial fallback, and JavaScript-disabled navigation.
- Desktop and phone website screenshot review.
- Native Release arm64 compilation and ad-hoc signature verification on macOS 26.5.1 with Xcode 26.
- R12 reproduced with `NSImage(systemSymbolName:)`: `checkmark.quote` returned nil. The cited-source label now uses `checkmark.circle`; runtime checks resolved both it and the uncited `doc.text` symbol. This symbol check does not establish on-device answer acceptance.

The PCM tests found and fixed a converter callback that supplied more frames than requested.
The website audit found and fixed insufficient contrast in small preview labels.
Fixture responses are synthetic test data and are not evidence of real Valsea success.

## Still required

`bash scripts/test-regressions.sh` runs the focused document and notebook lifecycle regression target on macOS 26+.
It compiles the production model, connection, and capture sources in an unhosted test bundle, using synthetic provider/capture dependencies and worktree-local document fixtures.
Coverage includes import ownership and save-before-insertion, Stop/Pause/abort finalization during quit, failed-save recovery, terminal events, timing/speaker bounds, encoded file size, and action-only summaries.
The bilingual notebook journey also exercises final-only persistence, duplicate events, speaker naming, summary regeneration with completed actions, reload, bilingual search, export/import, and trash/restore.
To retain its synthetic JSON and Markdown outputs for review, set `TEST_RUNNER_CHIRPBERRY_TEST_EVIDENCE_DIR` to an existing evidence directory when running the regression script. These outputs are fixture data, not live provider or native UI evidence.
It does not open the native app, capture audio, read Keychain credentials, or establish a provider connection.
CI's `macos-26` job builds the native app from a clean checkout, verifies its signatures, and runs this regression target.
The public release deployment gate has offline tests at `scripts/tests/test_public_release.py`; these are synthetic metadata/download checks, not evidence of a public release or a Pages deployment.

- Native light/dark appearance, narrow-window behavior, keyboard and VoiceOver labels on an unlocked Mac.
- Real microphone permission denial/approval, start, pause, resume, stop, closing the window, and quitting during capture.
- System-audio permission and capture from a consented test call, including headphones and both input streams.
- Live Valsea session readiness, final source/translation pairing, last-segment delivery on Stop, a structured summary, and audio import.
- Real connection failure, insufficient-credit handling where available, and API-key save/reload.
- Native create/edit/relaunch persistence, export/import, speaker rename, trash/restore, calendar authorization, and Apple Intelligence availability paths.
- No-mistakes pipeline review and GitHub CI.
- Exact-commit DMG packaging and mount verification, public asset download checksum, Homebrew installation, and production site download.

The parent CUA session reports that the workstation is now unlocked. On the initial `69a7fe3` build, it verified the empty state, explicit example, enhanced action checkoff, personal-note editing, speaker renaming, and Settings; disk JSON confirmed the edits and 0600 permissions.
These are limited checks on that initial build, not final-head native acceptance. They were not repeated by the review-fix run; the remaining native and capture acceptance paths above still require verification.
Provider acceptance is waiting for a Valsea credential; no credential or paid credit purchase is included in the repository.
The parent reports that a deliberately invalid test key received HTTP 401 from the translations endpoint. No Valsea key has been saved, and live success remains unverified.

The parent also reports installation checks on the older `811aa82170a23f8d1aae8901994aa5fa1fe48ad1` candidate DMG, SHA-256 `fa35d01aed4c60488553b885435b038b1bc943d15add1390f19a3b39a0a5f31c`, copied to Downloads. A temporary Homebrew local-file cask installed it into an isolated Applications directory and codesign verification passed, but launching the quarantined helper returned SIGKILL 9 and `spctl` rejected the installed app. There were zero Developer ID Application identities.
The temporary QA cask, app, tap, and narrowly scoped local trust entry were removed; no quarantine or Gatekeeper changes were made. This is installation evidence, not downloaded-app launch acceptance, and does not establish packaging or acceptance of `1b6b9b3` or subsequent fixes.

Public source/PR publication and a preview site are authorized. Public release assets, the canonical Homebrew cask, and production downloads remain gated on completing and recording native/provider acceptance and exact-final-commit packaging and installation checks.
