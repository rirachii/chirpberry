# Chirpberry

An original, open-source notebook for multilingual meetings.
Chirpberry is adopting Electron for macOS and Windows, with Linux support qualified separately. The existing SwiftUI Mac app remains available during migration and uses your Valsea account for live transcription, translation, and meeting summaries.

The [Electron implementation candidate](desktop/README.md) includes recording, clipboard dictation, Valsea transcription/translation and summaries, a floating bar, audio import, and protected credential storage alongside local notebooks. It adds upcoming Mac calendars, reviewed note sharing, and optional OpenAI meeting questions and editable response suggestions during recording. It uses a separate data folder. Automated Mac notebook and synthetic recording acceptance have passed; live OS/provider and Windows/Linux acceptance remain required before release. The native feature and release information below applies to the SwiftUI app.

<img src="macOS/Artwork/Chirpberry.png" width="112" alt="Chirpberry's mulberry bird icon" />

**First release in verification.**
The native build and automated checks are passing. The desktop companion has local UI acceptance; microphone permissions, real Valsea results, and full native acceptance are still pending.
See [verification status](docs/verification.md) before relying on the app for an important meeting.
The app is free software; Valsea processing uses your own paid account and credits.

## What is built

- Personal notes alongside a bilingual transcript, with provisional captions and persisted final segments.
- Microphone capture and optional Mac meeting audio through native Apple APIs, without a meeting bot.
- Valsea's notetaker endpoint for streaming correction, optional translation, and optional speaker detection.
- Meeting, sales, and support summaries, with editable enhanced notes and action checkboxes.
- Notebooks, pinning, reversible trash, source-language search, speaker renaming, and vocabulary context.
- Optional calendar preparation, local question answering using Apple Intelligence when available, and cited search excerpts.
- Local text and JSON import, Valsea audio import, Markdown/JSON export, and a read-only MCP helper.
- Native menus, keyboard shortcuts, menu-bar controls, Keychain credentials, and an original icon.
- A floating capture bar with language selection, dictation, meeting setup, and upcoming meetings.
- A searchable Scratchpad with autosave, Markdown formatting and Undo, separate Valsea summaries, and Copy.

Chirpberry is an independent project inspired by general meeting-notebook workflows.
It is not affiliated with Granola, Wispr, or Valsea, and does not claim their complete feature set or benchmark accuracy.
There is no team workspace, hosted sharing, mobile client, or automatic outbound messaging in this release.

## Build and use

Requires Apple Silicon, macOS 26 or newer, Xcode 26 or newer, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
git clone https://github.com/rirachii/chirpberry.git
cd chirpberry
brew install xcodegen
scripts/build.sh
open dist-native/Chirpberry.app
```

Create a meeting with Command-N and write notes immediately.
For speech, open Settings, add your Valsea API key, save it, and test the connection.
Choose a translation target in Meeting details, then choose Record meeting.
Inform participants before recording and grant the macOS permissions you choose to use.
Pause and Stop end audio capture; Resume creates fresh provider streams.
Enhance notes creates a separate summary without replacing your own writing.

Use the floating bar for quick capture: tap Fn / Globe to start dictation, then again to finish and copy the final text to the clipboard. A Scratchpad copy is saved. Global Fn needs Accessibility access from Settings > Quick capture; Control-Option-D remains a fallback. Control-Option-M opens meeting setup and Control-Option-S opens Scratchpad. Settings also offers Control–Option–D or optional Tab as the primary dictation key. Live dictation requires a Valsea key and the recording disclosure and microphone permission.
For optional external-editor insertion in the alternate shortcut modes, see the native [dictation destination rules](docs/desktop-companion.md#dictation).
The first dictation requires an in-app disclosure. The bar rests as a small handle and expands on hover; choose the top, bottom, left, or right edge in Settings > Quick capture > Dock position. It stays centered on the selected edge and cannot be dragged.
The Quick capture menu controls bar visibility and keyboard focus. Capture keeps the controls expanded.
See [desktop companion](docs/desktop-companion.md) for details and acceptance limits.

The build is ad-hoc signed and is **not notarized by Apple**.
Review [Apple's installation guidance](https://support.apple.com/en-us/102445) if macOS blocks it.
DMG and Homebrew publication follow the [release gates](docs/releasing.md); an install command is not advertised as available before its asset exists.

## Privacy and processing

Documents are saved under `~/Library/Application Support/Chirpberry/Meetings` as separate, versioned JSON files with owner-only permissions.
Chirpberry does not save audio recordings.
During capture, microphone and optional computer audio stream directly to Valsea.
Audio imports, requested translations, and requested summaries also use Valsea's cloud service and [policies](https://valsea.ai/policies/en).
Microphone plus Mac audio uses two speech streams; optional diarization adds provider cost.
There is no Chirpberry backend, account system, analytics, or automatic cloud synchronization.
The API key stays in macOS Keychain and is absent from documents and exports.

Apple Intelligence answers run on the Mac when its model is available.
Without it, local search returns clearly identified source excerpts.
Connecting the MCP helper grants the chosen AI client access to saved meeting content; that client's own processing policies then apply.

## Connect an AI client

Copy the MCP configuration in Settings or configure the installed helper manually:

```json
{
  "mcpServers": {
    "chirpberry": {
      "command": "/Applications/Chirpberry.app/Contents/Resources/bin/chirpberry-mcp",
      "args": []
    }
  }
}
```

The helper exposes only `search_meetings` and `get_meeting`, excludes trashed meetings, and uses stdio without opening a network listener.
It runs only when the AI client launches it.

## Development

```sh
npm ci --prefix site
npm ci --prefix desktop
scripts/verify.sh
cd site
npx playwright install chromium
npm run test:e2e
```

The native project is generated from `macOS/project.yml`; do not commit the generated Xcode project or build output.
Core tests use protocol fixtures and do not require an API key or microphone access.
They do not replace real provider and native acceptance tests.
Use `CHIRPBERRY_DOCUMENTS_DIR` to launch the app against an isolated test directory, or `--directory` for the MCP helper.

Read the [architecture](docs/architecture.md), [product plan](docs/plan.md), [design contract](DESIGN.md), and [website guide](site/README.md).
Contributions are welcome under the [MIT license](LICENSE).
