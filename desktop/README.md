# Chirpberry Electron desktop

Electron 0.2.0 is the implementation candidate for shared desktop delivery. The original SwiftUI app remains available while live OS/provider acceptance is completed. This candidate is not a published release.

## Run and package

Requires Node.js 22.12+ and npm. Mac capture requires macOS 26, Apple Silicon, Xcode command-line tools, and Swift. Windows and Linux use Electron's capture process; Mac-only build steps skip on those systems.

```sh
npm ci --prefix desktop
npm start --prefix desktop
npm run verify --prefix desktop
npm run test:e2e --prefix desktop
npm run package --prefix desktop
npm run package:installers --prefix desktop
```

`start` builds the Mac helper where applicable and opens the actual Electron app. `package` creates an unpacked host app. `package:installers` creates Mac arm64 DMG/ZIP, Windows NSIS, or Linux AppImage under `desktop/release/`. All commands disable publication. Mac candidates are ad-hoc signed and unnotarized; Windows installers are unsigned. A candidate installer is not a passed clean-install test.

Install the Mac candidate into `/Applications/Chirpberry Electron Candidate/Chirpberry.app`: create that distinct folder and copy the app into it. The product name stays Chirpberry. Never replace the native `/Applications/Chirpberry.app` before acceptance; cancel any Finder replacement prompt and choose a new candidate folder. The DMG omits a direct Applications shortcut and includes the coexistence procedure in `INSTALL.txt`.

## Implemented behavior

- Meeting notes and Scratchpads, independent original and summary notes, search, notebooks, pinning, reversible Trash, speaker naming, and native text editing/Undo.
- A two-pane notebook by default, with a collapsible sidebar and optional Transcript inspector. New note focuses the editor. One collection selector covers All notes, Pinned, notebooks, and Trash; the native Search notes command restores a hidden sidebar.
- One toolbar keeps Record meeting prominent and capture state, Pause/Resume, and Stop visible during recording, including when browsing other collections. Note actions (`…`, or right-click a note) contains Dictate to clipboard, Pin, Move to notebook, export/copy, and Trash. Library holds New scratchpad, Import notes, and Transcribe audio file. Menus support arrow keys, Home/End, Escape, and outside-click dismissal.
- Atomic, serialized document saves; disk failures preserve in-memory edits for export. JSON, Markdown, and text import creates a new identity and leaves originals untouched.
- Explicit recording/disclosure controls; microphone and optional system audio, live source/translation segments, final-only persistence, pause/resume, bounded provider queues, and stop on error, either notebook or companion closure, or exit. A full Stop upgrades an in-flight Pause; closure or cancellation disables clipboard delivery.
- Valsea WebSocket authentication in headers. Renderer processes cannot read credentials or call provider endpoints. Mac uses Keychain; Windows uses Electron safeStorage/DPAPI; Linux refuses plaintext `basic_text` storage and needs an unlocked system keyring.
- Microphone dictation appends final original-language text to the selected note/Scratchpad, then copies only that session's new speech on successful explicit Stop. Pause, cancellation, failure, and empty speech leave the clipboard unchanged.
- A floating bar expands from 52×10 to 200×60 points. Entry opens immediately; exit waits 120 ms; active capture keeps the bar open. Settings chooses a screen edge. Its idle actions are Dictate to clipboard, Record meeting, Open scratchpad, and Open notebook; Record meeting creates a note and starts capture using the saved settings after disclosure is accepted.
- Opt-in Fn/Globe on Mac through Accessibility, with Control–Option–D fallback. Windows/Linux use Ctrl+Alt+D. Meeting and Scratchpad use Ctrl+Alt+M/S. Settings reports dictation shortcut availability; meeting and Scratchpad registration failures are not individually surfaced and need platform acceptance.
- Structured Valsea summaries and action items preserve original notes; edits made to the summary during a request are protected. Audio file import sends only the explicitly selected file, up to 10 MB, to Valsea and saves the returned original-language transcript in a new meeting. It does not translate imported audio or keep an internal audio copy.
- Explicit Mac calendar access to prepare notes from the next seven days. No automatic calendar uploads or automatic recordings.
- Read-only stdio MCP for local notes. The portable entrypoint is `node desktop/dist/mcp.cjs --directory /absolute/notebook/Meetings` (Node 22+). Without `--directory`, it reads the default Electron notebook location described below; it does not use the app's development-directory environment overrides. Packaged apps include `mcp.cjs` in Resources; the Mac package also includes the existing native `chirpberry-mcp` executable. Supply the Electron notebook directory explicitly to that native helper.

Linux currently offers microphone capture; system audio and calendars are unavailable. Windows offers a microphone and screen-loopback capture path; actual device behavior still needs Windows acceptance. The Electron app does not currently implement Apple Intelligence answers or automatic insertion into external editors. Clipboard dictation is the selected workflow.

## Storage and OS setup

Open Settings, save your Valsea API key, accept the recording/cloud-processing disclosure, and save settings. On Mac an existing Chirpberry Keychain item can supply the key, subject to macOS granting the rebuilt helper access. Start Dictate to clipboard from Note actions or the companion, or choose Record meeting, and respond to the OS microphone prompt. Enable system audio only for a consented meeting and authorize the corresponding OS prompt. Enable global shortcuts separately; for Fn, use Enable Fn Accessibility access, grant access in System Settings, then return and save settings to retry registration. A successful shortcut registration does not verify a physical Fn tap outside the app.

The bundle identity is `com.rirachii.chirpberry.desktop`, product name **Chirpberry**, with `Chirpberry Desktop/Meetings` under Electron's application-data directory. The original native app and the removed Preview have separate profiles. Do not point this candidate at either original document store; use Import.

Mac keys use the existing Chirpberry Valsea Keychain item. The bundled **Chirpberry Capture** helper owns microphone, system audio, calendar, and Fn permissions. Quit the original Mac app before enabling Electron global shortcuts to avoid conflicts. Saving settings retries registration after Accessibility is allowed. Rebuilt ad-hoc signatures may need their permission authorization refreshed. Never change TCC databases, Gatekeeper, or quarantine settings to bypass OS protection.

`CHIRPBERRY_PROFILE_DIR` and `CHIRPBERRY_DOCUMENTS_DIR` select isolated development directories. `CHIRPBERRY_DISABLE_OS_INTEGRATIONS=1` disables real audio and credential integrations for diagnostic tests; it never substitutes fake transcription. Synthetic adapters exist only in `tests/fixtures`, are compiled to ignored `test-build/`, and are excluded from production packaging.

## Architecture and verification

- `shared/`: version-1 Swift-compatible document schemas, capture/settings schemas, export formatting, and continuous PCM conversion.
- `main/store.ts`, `recording.ts`, `realtime.ts`, `rest.ts`: persistence, one capture owner, validated/bounded Valsea streaming, and explicit provider requests.
- `main/native.ts`, `native/Bridge.swift`: private bounded stdio bridge reusing actual native capture, PCM, Keychain, and Fn source. Shutdown and cancellation retain and await helper teardown, escalating to termination after the grace period if the helper hangs. Stopping an already closed capture helper never starts a replacement.
- `capture/`, `main/browser-audio.ts`: isolated per-recording renderer, worklet, microphone/Windows loopback, sender-validated PCM, and narrow permissions. It has no key or provider access.
- `main/runtime.ts`, `companion.ts`, `preload.ts`: OS integration orchestration, companion, and role-checked APIs. The companion cannot load/export the notebook store.
- `renderer/`: sandboxed React notebook with a restrictive CSP and no Node or outbound network access.

Unit/integration checks cover real file persistence, failures, cancellation, phase-scoped transcripts, final clipboard delivery, audio continuity, local WebSocket auth/lifecycle, summary parsing, read-only MCP, and Swift document interchange. Electron acceptance covers the notebook and a separate labelled synthetic recording build. Synthetic tests do not record audio or contact Valsea.

For packaged notebook acceptance, set `CHIRPBERRY_EXECUTABLE` to the executable and run `npx playwright test` from `desktop/`. On Mac: `release/mac-arm64/Chirpberry.app/Contents/MacOS/Chirpberry`. All fixture tests intentionally skip against production packages.

Use `npm run release:prepare --prefix desktop` only from a clean reviewed source commit. It refuses dirty or changed source and existing versioned release output, builds installers in fresh invocation-specific staging, verifies Mac DMG payload/signatures, and creates exact-source archives, manifests, and SHA-256 checksums. It does not publish or certify live acceptance. See [verification](../docs/verification.md), [migration acceptance](../docs/electron-migration.md), and [release procedure](../docs/releasing.md).
