# Electron source review — 2026-09-11

Scope: the complete Electron candidate stack through PR #5, compared with `main` at `a6b2cce6c01bc233b015e362bc0b2f66e550cbf2`. Initial candidate head was `9b8f21b8c00c4ca37d3bdec398592989696742dd`. Standards and specification reviews ran independently against AGENTS.md, DESIGN.md, architecture, product plan, and feature contracts. This is source review and local verification, not public-release approval.

## Standards

One confirmed finding: explicit Stop/Pause discarded captured PCM while finalizing transcription. The controller entered `finishing` and aborted before draining, the Mac adapter detached listeners before the helper's stop acknowledgement, and browser capture destroyed its context without flushing the partial worklet frame.

Resolved for Electron with an explicit drain phase, retained native PCM/abort listeners, browser partial-frame and IPC-acknowledgement flushing, and bounded teardown. Cancellation, failure, disclosure revocation, and window termination revoke drain eligibility immediately. The follow-up review identified a native queue-ordering gap; the shared capture source now stops producers then fences the serial sample queue before returning to the helper's stop acknowledgement. A held synthetic callback verifies that ordering. The independent follow-up found no remaining confirmed ordering blocker or regression in the Electron candidate and cleared its source merge after required checks.

The preserved SwiftUI NotebookModel has its own earlier `recording`-only PCM gate. The shared queue fence does not fix or verify native UI tail delivery. That remains a native-app acceptance limitation, separate from the approved Electron delivery path.

## Spec

One confirmed finding: startup read both Keychain secrets before the notebook and guide appeared. A rebuilt Mac helper could request Keychain UI before onboarding, contrary to DESIGN.md's launch behavior.

Resolved with presence-only status checks. Mac asks for attributes, suppresses both legacy and modern authentication UI, and restores the previous policy synchronously. Windows/Linux check ciphertext-file presence; key removal deletes that file. Actual secret reads follow explicit recording, summary/import, or meeting-AI actions. Presence does not prove unlock or provider authentication; cloud disclosures remain independently required. The independent follow-up found no remaining merge-blocking issue in the startup fix.

The legacy Keychain UI guard remains intentionally in use despite SDK deprecation warnings, because the saved keys use the login keychain and the modern query option alone does not cover every legacy prompt. It never suspends while changing the helper's process-local UI policy.

## Local evidence

- Before the fix, focused Stop, Pause, and cancellation-during-drain assertions reproduced the controller failure.
- `scripts/verify.sh` passed after the final native queue change: 32 Swift core, 28 native model, 76 Electron unit/integration, three legacy-site tests, MCP checks, and native/Electron/site builds.
- All 29 Electron UI scenarios passed in one complete run after the TypeScript fixes. The subsequent native-only queue change passed its focused model regression and full build/check suite.
- Synthetic tests exercise final PCM before native acknowledgement, interrupting a hung native drain, worklet tail bytes, per-frame acknowledgement, consumer overflow, context-close ordering, metadata-only credential commands, ciphertext removal, and restoration of Mac Keychain UI policy.
- The Keychain test queries a unique nonexistent test service. No real keys, microphone capture, provider traffic, or Calendar account contents are needed for these regressions.

The unpublished installer set from `9b8f21b` is held; it predates these fixes. Corrected exact-commit artifacts and packaged acceptance must be recorded separately. The installed app is left untouched at the user's request. Live service setup, permission/device behavior, sustained performance, cross-platform clean installation, and public distribution remain tracked in [release readiness](release-readiness.md).
