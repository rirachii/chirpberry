# Chirpberry contributor instructions

Chirpberry is an original meeting notebook adopting Electron for shared desktop delivery.
The existing SwiftUI app in `macOS/` targets macOS 26 and Apple Silicon; the Electron implementation candidate lives in `desktop/`.
Electron is the approved desktop direction. See `docs/desktop-framework-evaluation.md` and `desktop/README.md` for migration status.
Preserve the native implementation and its in-progress work until equivalent Electron behavior is verified. Do not point the Electron candidate at the native document store by default.
Read DESIGN.md, docs/architecture.md, and docs/plan.md before implementation changes.
Valsea handles live speech, translation, and structured summaries; it is a hosted service with its own account and usage costs.
Never describe cloud processing as offline or unlimited free transcription.

- Keep API keys in macOS Keychain and the appropriate protected OS credential store on other platforms, and use Authorization headers, never URLs, logs, source, or exports. Electron provider requests run only in main; keys never reach renderer processes.
- Store each meeting atomically in the OS application-data directory (Application Support on macOS); protect original notes when generating summaries.
- Persist final transcript events only; partials are mutable display state.
- Recording starts only through an explicit user action after the in-app disclosure and OS permission prompts.
- Stop capture on stop, failure, window termination, and application exit; never leave an undisclosed background recording.
- Do not persist audio recordings by default.
- Never invent speaker identities, word timestamps, successful API output, citations, or test results.
- Bilingual text pairs belong to a whole provider segment; diarized utterances must not falsely map a complete translation to each individual speaker.
- Keep original branding, copy, composition, and source; use competitor products only as interaction references.
- Use scripts/verify.sh for core tests, native build, website checks, and Electron verification. Run `npm run test:e2e --prefix desktop` for actual Electron UI acceptance.
- Verify the actual built app before release, including permission, error, stop, import, export, and persistence paths.
- Publish the exact clean source commit with a checksum-verified DMG and source archive; keep the unnotarized status visible.
- Canonical Homebrew casks live in rirachii/homebrew-tap.
- Shared engineering decisions belong in tracked docs; private test media and raw research stay outside Git.
