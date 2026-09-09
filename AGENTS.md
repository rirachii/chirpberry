# Chirpberry contributor instructions

Chirpberry is an original native SwiftUI meeting notebook for macOS 26 and Apple Silicon.
Read DESIGN.md, docs/architecture.md, and docs/plan.md before implementation changes.
Valsea handles live speech, translation, and structured summaries; it is a hosted service with its own account and usage costs.
Never describe cloud processing as offline or unlimited free transcription.

- Keep API keys in macOS Keychain and Authorization headers, never URLs, logs, source, or exports.
- Store each meeting atomically under Application Support; protect original notes when generating summaries.
- Persist final transcript events only; partials are mutable display state.
- Recording starts only through an explicit user action after the in-app disclosure and macOS permission prompts.
- Stop capture on stop, failure, window termination, and application exit; never leave an undisclosed background recording.
- Do not persist audio recordings by default.
- Never invent speaker identities, word timestamps, successful API output, citations, or test results.
- Bilingual text pairs belong to a whole provider segment; diarized utterances must not falsely map a complete translation to each individual speaker.
- Keep original branding, copy, composition, and source; use competitor products only as interaction references.
- Use scripts/verify.sh for core tests, native build, and website checks.
- Verify the actual built app before release, including permission, error, stop, import, export, and persistence paths.
- Publish the exact clean source commit with a checksum-verified DMG and source archive; keep the unnotarized status visible.
- Canonical Homebrew casks live in rirachii/homebrew-tap.
- Shared engineering decisions belong in tracked docs; private test media and raw research stay outside Git.
