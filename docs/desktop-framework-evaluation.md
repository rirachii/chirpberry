# Desktop framework evaluation

Status: Electron adopted by the user on 2026-09-09. Migration is staged; full feature parity is not yet implemented.
Evaluated on 2026-09-09 for Windows support, possible Linux support, and desktop resource use.

## Competitor evidence

Read-only inspection of installed macOS application packages found:

| Application | Inspected app version | Runtime evidence |
| --- | --- | --- |
| Granola | 7.543.3 | `Contents/Frameworks/Electron Framework.framework` and Electron renderer/GPU helper applications |
| Wispr Flow | 1.6.793 | `Contents/Frameworks/Electron Framework.framework` and Electron renderer/GPU helper applications |

Both inspected Mac builds use Electron. Wispr's official [MDM documentation](https://docs.wisprflow.ai/articles/9363440133-deploy-wispr-flow-via-mdm) also lists the bundle identifier `com.electron.wispr-flow`.
These observations do not establish either product's complete internal architecture, Windows implementation, Linux support, or comparative performance. App versions and implementations can change.

## Tradeoffs

[Electron](https://www.electronjs.org/docs/latest/) bundles Chromium and Node.js and supports macOS, Windows, and Linux. Its shared browser engine reduces rendering-engine variation across platforms.
[Tauri](https://v2.tauri.app/concept/process-model/) combines a Rust core with system webviews, reducing the bundled runtime size. Its [webview engines](https://v2.tauri.app/reference/webview-versions/) differ across platforms.
Smaller bundles alone do not establish lower total memory use, better battery life, or faster recording. No comparative Chirpberry prototype has been measured.

## Adopted direction

Use Electron with a React/TypeScript interface and native integrations for specialized audio and OS operations. Prioritize macOS and Windows; Linux is a framework target whose capture and release support must be qualified separately. The observed competitor builds support its suitability for related workflows, not a claim that Electron is the fastest framework.

See [Desktop direction in the architecture guide](architecture.md#desktop-direction) for the implemented capture adapters and process boundaries, and [verification status](verification.md) for their acceptance evidence.

Before replacing the current SwiftUI application, validate microphone and computer-audio capture, explicit permission and recording lifecycle behavior, pause/stop, and sustained streaming on target systems. Measure startup, total process memory, idle energy use, and sustained recording resource use. [Electron's capture documentation](https://www.electronjs.org/docs/latest/api/desktop-capturer/) identifies platform-specific behavior that still needs testing.

The existing product/privacy contracts continue to apply. The Electron candidate in `desktop/` now includes the notebook, capture/provider lifecycle, clipboard dictation, protected credentials, the companion, summaries, audio import, Mac calendar preparation, and read-only MCP. It retains an isolated document store and requires explicit disclosure before any cloud action. See the verification report for which paths have actual OS/provider evidence.

See [Electron development and migration status](../desktop/README.md) for commands, acceptance coverage, and remaining platform integrations. Keep the current SwiftUI app available until the replacement passes its independent release gates.
