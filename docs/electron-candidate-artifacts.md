# Electron 0.2.0 candidate artifact receipt — 2026-09-11

Status: **unpublished, ad-hoc signed and unnotarized**. These artifacts do not establish clean-install, live service, OS permission, real-call detection, or sustained-performance acceptance. Public DMG/Homebrew publication remains blocked by the [release checklist](release-readiness.md).

## Source and artifacts

Exact reviewed source: `040e04e9f69ee96f6c06db70320ff1aa9a988d0f`, merged into `main` through [PR #5](https://github.com/rirachii/chirpberry/pull/5) at `900d0a22a7a141bb6f517066dac074fb30121762`. Preparation ran from this clean commit using `npm run release:prepare --prefix desktop`. The source ZIP archives the full repository, including the native helper dependencies and queue-fence fix.

Local artifact directory: `desktop/release/v0.2.0-darwin-arm64/` (ignored build output).

| Artifact | SHA-256 |
| --- | --- |
| `Chirpberry-0.2.0-arm64.dmg` | `2a08e4a9e281947678ff9353da1bc9d10aa4bb2d70aa067c1ab8826b232bf074` |
| Packaged `Contents/Resources/app.asar` | `e3b4e58b701f13773aa58f1a8bd5564d88e3702cc1bdcc3037adca527f6b971c` |

`release.json` and `SHA256SUMS.txt` contain all DMG/ZIP/source/blockmap checksums. Every manifest hash was verified again after preparation; representative source-archive files match the reviewed checkout byte-for-byte.

## Acceptance evidence

- Clean-source preparation reran desktop verification, built fresh installers, verified the mounted DMG payload against the staged app, verified strict deep signatures and actual signed microphone/Calendar declarations, and checked the MCP executable.
- The app extracted from the versioned ZIP passed strict deep signature verification and all eight production Electron UI scenarios; 21 fixture-only scenarios skipped deliberately. Tests used isolated documents/profiles with OS integrations disabled.
- `scripts/verify.sh` passed 32 Swift core, 28 native model, 76 Electron unit/integration, and three legacy-site tests, MCP checks, and production builds. All 29 Electron UI scenarios passed locally. [Detailed review](release-review-2026-09-11.md) records the native-only follow-up and test scope.
- All required CI jobs passed. CI evidence: [core and legacy website](https://github.com/rirachii/chirpberry/actions/runs/34566126530), [Electron Mac/Windows/Linux tests and installer builds](https://github.com/rirachii/chirpberry/actions/runs/34566126553). CI candidates are build artifacts, not public releases or device acceptance.
- The installed candidate's archive remains `d523064270a299a75553cf4a2eb21fe5f0e762fa7e5f4fc5886b162bc40e718f`. No installed app was quit or replaced.

The earlier artifacts are retained under `desktop/release/held-9b8f21b-pre-drain-fix/` with a HOLD notice. They predate the audio-drain and startup fixes and must never be published. Regenerate public-release artifacts from the final accepted clean commit after the outstanding manual gates; do not relabel a held or modified package.

The public guide was refreshed to this source commit in Vercel deployment `dpl_H6tDzhFBUTdofVchdKWLPvPgcKGk` from separate website source `9de0954`. The public alias and `/get-started` passed desktop/mobile, accessibility, navigation, and no-JavaScript checks. Website source and its receipt are committed locally in the separate checkout, which has no Git remote; they are not part of this desktop repository.

## Draft distribution follow-up — 2026-09-12

The same exact-source artifacts are now uploaded to a GitHub draft prerelease, with every server-reported hash verified. A canonical Homebrew cask draft PR and a tested, undeployed website download section are prepared. See [the distribution receipt](preview-distribution.md) for links, actual install/uninstall evidence, the Gatekeeper result, local QA side effects, and the remaining publication decision. The public alias and installer availability have not changed.
