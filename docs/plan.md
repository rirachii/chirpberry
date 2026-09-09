# Implementation and release plan

## Product

Build an independent open-source Mac meeting notebook named Chirpberry, optimized for Valsea's streaming speech and translation API.
Keep source speech and translations together, personal notes separate from generated notes, and all saved meeting documents on the Mac.
Speech and requested summaries are sent directly to the user's Valsea account.

## Steps

1. Verify the reference workflows and exact Valsea protocol, then record the original product contract.
2. Build tested meeting models, atomic storage, transcript reduction, structured summary parsing, retrieval, and Markdown/JSON export.
3. Implement Keychain credentials, microphone and system-audio capture, a bounded streaming queue, explicit session lifecycle, pause/stop, and recovery.
4. Build the native notebook, live bilingual transcript, note enhancement, templates, speaker renaming, search, folders, calendar entry points, audio/text import, and export.
5. Add on-device question answering when Apple Intelligence is available, with cited local search available independently.
6. Exercise provider integration with consented synthetic speech and the user's Valsea credentials, along with failure, restart, data preservation, and permission flows.
7. Create the original icon, website, documentation, CI, and no-mistakes review.
8. Package the verified build, publish GitHub source and DMG, validate a clean Homebrew installation, deploy the website, and test its real download.

## Reference scope

Granola establishes personal notes enhanced using meeting context, microphone/computer capture without a meeting bot, calendar entry points, summaries, search, and reusable meeting knowledge.
Wispr Notetaker adds transcript correction, speaker renaming, personal vocabulary, and use of meeting history by other tools.
Chirpberry's first release centers on those single-user Mac workflows plus live bilingual transcripts.
Team workspaces, hosted share links, Gmail/Slack ingestion, mobile clients, and automated outbound follow-ups require separate authorization and are not implied by the desktop release.
No claim of complete competitor parity or superior accuracy should appear in marketing.

## Release gates

Real Valsea success and error tests are distinct from recorded protocol fixtures.
A missing credential does not count as a passed integration test.
Code signing, Apple notarization, tested OS versions, GitHub publication, Homebrew install, and website deployment must each be reported independently.
The primary production hosting route is manually dispatched GitHub Pages, gated on the public release and canonical cask; Vercel remains optional.
