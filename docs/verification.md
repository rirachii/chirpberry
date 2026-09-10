# Verification status

Last updated 2026-09-10.
This is an engineering checkpoint, not a claim that live provider or native acceptance has passed.

## Electron 0.2.0 implementation candidate

Implemented on 2026-09-10: recording and pause/resume, microphone/system-audio adapters, Valsea streaming/translation/summaries, protected keys, final clipboard dictation, 200-point companion, Mac calendar preparation, audio import, and portable read-only MCP. The product is named Chirpberry and uses its own `Chirpberry Desktop` profile. The native app is preserved.

Current local evidence:

- TypeScript checks and production bundling pass. Seventeen unit/integration checks pass: storage/recovery, Swift interchange, continuous PCM, WebSocket authentication/readiness/draining, failure/cancellation, final-only clipboard delivery, summary parsing/error privacy, and read-only MCP.
- Development and packaged Mac notebook acceptance pass: edit/restart, import/export with stubbed OS dialog selections, trash, search, keyboard controls, sandbox isolation, and automated accessibility in wide/light and compact/dark layouts.
- Separate synthetic Electron recording acceptance passes: disclosure, transient drafts, pause/resume, last-final save and clipboard, summary, audio import, settings accessibility, companion width 200/52, and rejection of notebook-store access from the companion. This build uses labelled fixtures, has no live microphone/provider access, and is excluded from packaging.
- The actual Mac helper compiles from shared native sources and responds to its private protocol. The packaged app's deep strict code-signature verification passes; it is ad-hoc signed and unnotarized. Production archive inspection found no fixture/test modules.

Release remains gated on real microphone/system-audio permission and capture, a saved Valsea key and successful live transcript/summary/import, physical Fn outside the app, calendar authorization, Windows/Linux runtime and clean-install evidence, and clean-source publication checks. No claim of perfect behavior or live transcription follows from fixture tests. CI now covers Mac, Windows, and Linux notebook/fixture tests and installer builds; results must be recorded after those jobs run.

## Passed locally

- 26 Swift core tests: transcript source/translation semantics, provisional/final state, duplicate handling, speaker scope, JSON round-trips, corrupt-file recovery, file permissions, exports, summaries, search, HTTP error handling, upload size/header boundaries, Unicode limits, continuous PCM conversion at 44.1/48 kHz, scratchpad compatibility, selected-text formatting, and inward expansion geometry at all four screen edges.
- Eighteen native model/shortcut/clipboard/hover tests: scratchpad persistence/relaunch and independent selection, disclosure without capture, simultaneous-session exclusion, reversible Trash, suppression of delivery on window closure including finalization, storage failure before connection, held-key repeat suppression, Fn activation once on release, combination rejection, cancellation of queued shortcuts, isolated clipboard final delivery/preservation on empty, failed, and cancelled sessions, and hover opening/closing with re-entry, feedback, keyboard-focus, and popover interactions.
- MCP process tests: initialization, discovery, read-only annotations, search, full reads, invalid UUID rejection, and trash exclusion.
- Three website release-contract tests and the production Vite build.
- Four Brave/Playwright browser tests: WCAG A/AA automated audit, widths from 320 to 1440 pixels, language examples, installation help, both copy buttons, clipboard denial fallback, and JavaScript-disabled navigation.
- Desktop and phone website screenshot review.
- Native Release arm64 compilation and ad-hoc signature verification on macOS 26.5.1 with Xcode 26.
- Desktop companion native UI checks on an unlocked Mac using isolated synthetic notes: rendered bar and Scratchpad, disclosure/cancel without capture, upcoming-meetings connection state, keyboard focus, in-app shortcut equivalents, editing, selected-text formatting and Undo, Copy feedback, no-match search, sidebar collapse, and saved notes after quit/relaunch.
- Fixed docking UI checks in the built app: Settings exposes the four edge choices; Top, Left, and Bottom update the rendered orientation; Escape returns horizontal and vertical controls to the small handle; and Bottom survives quit/relaunch. The final build's menu no longer exposes a centering command. Dragging is disabled at the NSPanel level and no drag gesture is exposed. The app was left collapsed at Bottom.
- Compact bar screenshot review: the idle horizontal window is 240 points wide (previously 300), with a 60-point resting capsule (previously 78). In an isolated notebook with the first-use disclosure forced on through launch arguments, Tab opened dictation setup without recording; Cancel left capture idle. Switching Dictation key to Control–Option–D restored normal Tab navigation. The OS accepted the global registrations; the automated key press exercises the app-local delivery path, not a physical key in another app.
- Appearance update: reviewed the rebuilt idle bar without its separate name/hover badge. The capsule uses a lighter lavender-gray background at 62% opacity and a softer shadow; the horizontal window is now 60 points tall. Original actions remain present with their accessibility labels.
- Further width reduction and Fn clipboard mode: reviewed the built 220-point horizontal window (from 240), with a 52-point resting handle (from 60). The actual app shows Dictate · Fn and Settings selects Fn / Globe · clipboard. The executable launched from the development environment reported no event-tap registration error; this does not establish permission for a normal app launch. Control–Option–D opened the disclosure naming Clipboard as the destination. Cancel left capture idle. Starting with no saved Valsea key displayed the expected Settings instruction and returned to idle without audio or provider access. These checks used an isolated document directory; the first-use disclosure was left enabled afterward. UI automation cannot synthesize Fn, so physical Fn and Fn combinations remain unverified.
- Requested 200-point width: reduced the idle horizontal window from 220 to 200 points, with tighter spacing and a 40-point microphone button. Reviewed the rebuilt bar with all five buttons visible and unclipped. The 52-point resting handle remains unchanged. `scripts/verify.sh` passed, and the updated app was reopened.
- Hover responsiveness: five regression tests failed against the prior controller and passed after reducing exit delay from 450 to 120 ms, releasing keyboard hold after pointer interaction, and allowing idle collapse while feedback remains available. Re-entry cancels the pending close; popovers retain the bar. The content transition is now 80 ms and the AppKit tracking area is retained across layout changes. `scripts/verify.sh` passed. In the rebuilt app, keyboard focus exposed all five controls and Escape restored the resting handle; the 200-point bar was visually reviewed and left collapsed. These checks do not measure physical pointer-event timing.

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
- Live dictation and final clipboard output, external-editor insertion in alternate shortcut modes, Accessibility permission denial/approval, physical Fn activation and Fn combinations outside Chirpberry, dark appearance, narrow-window and full-screen Spaces acceptance. The companion UI checks above do not establish these results.
- Physical pointer hover/exit timing while another app is active, screen disconnection, and multi-display docking. The UI automation used here has no pointer-only hover operation.
- No-mistakes pipeline review and GitHub CI.
- Exact-commit DMG packaging and mount verification, public asset download checksum, Homebrew installation, and production site download.

The companion UI session ran on an unlocked Mac. Earlier full-notebook acceptance remains incomplete.
Provider acceptance is waiting for a Valsea credential; the companion session confirmed there is no saved Chirpberry Valsea Keychain item without reading or exposing credentials.
The final app launched normally reports Fn unavailable. System Settings has an enabled Chirpberry Accessibility entry, but the current build still needs its authorization resolved. The standard Add flow for authorizing the current build is waiting at the macOS Touch ID/password prompt; no credentials were requested in chat and no OS permission database was modified. Returning to Chirpberry after authorization retries Fn registration.
No credential or paid credit purchase is included in the repository.
These gates must be completed and recorded before marking the first release verified.
