# Electron implementation and acceptance

User authorized completing the Electron migration on 2026-09-10. The existing native app remains available until the replacement is verified. The removed Preview app bundle must not be mistaken for a completed release; its source is the starting point.

## Implementation order

1. Shared recording controller: disclosure, one active capture, readiness, final-only persistence, pause/resume, bounded finalization, failures, and stop on close/exit.
2. Valsea streaming and summary modules with authenticated headers, validated events, bounded queues and responses, no audio files, and protected credentials.
3. Mac helper reusing native audio conversion/capture, Keychain, and Fn tracking. Windows microphone and loopback capture through an isolated Electron capture renderer; Linux microphone support with truthful platform limitations.
4. Notebook recording/settings/disclosure UI, separate summaries, live source/translation segments, and the 200-point floating companion with immediate entry/120 ms exit behavior. Fn finishes dictation into the clipboard on macOS; explicit fallback shortcuts on other platforms.
5. Meeting preparation/calendar access where supported, audio import, Scratchpad, and read-only MCP integration.
6. Installer configuration, helper bundling, signing/notarization hooks, checksums/source manifest, platform CI, packaged-app tests, resource measurements, and a clean-source release candidate.

## Test interfaces

Tests exercise the recording controller with synthetic audio/provider adapters, the provider connection with an in-process WebSocket server, document persistence through the real store, and user flows through Electron. OS capture and credentials vary behind explicit adapters. No test starts real recording or reads real credentials without a consented live acceptance step. Provider fixtures never count as successful live transcription.

## Acceptance still required

Live Valsea needs a key entered in Chirpberry Settings. Microphone, system audio, Fn/Accessibility, Windows runtime/installer behavior, and signing/notarization are separate gates. Any unavailable gate must remain visible in the verification report. Do not publish or relabel an incomplete prototype as the finished meeting/dictation app.
