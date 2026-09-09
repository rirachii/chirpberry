# Release procedure

The canonical source repository is `rirachii/chirpberry`.
Homebrew publication belongs in `rirachii/homebrew-tap`, with a new `Casks/chirpberry.rb`.
Keep Converty and other casks unchanged.

## Prepare

Complete `docs/verification.md`, including an actual unlocked-Mac session and live Valsea results.
Run `scripts/verify.sh`, the website browser suite, and the no-mistakes pipeline on the feature branch.
Review changes and merge the checked branch before packaging a public release.
Never include API keys, test recordings, local notebook documents, or raw research in Git.

Update the app's Info.plist, settings footer, MCP version, website release links, and site package version together.
The first version is 0.1.0 for Apple Silicon and macOS 26+.

## Package

```sh
python3 scripts/package-release.py
```

The script refuses a dirty working tree or an existing artifact path.
It builds a temporary checkout from the exact Git revision, verifies the architecture and signatures, creates a DMG with an Applications link and installation notes, mounts it read-only, and checks the bundled MCP helper.
It creates a versioned source archive, release manifest, and SHA-256 checksums under `dist-native/releases/vVERSION`.
The source commit in `release.json` must match the public tag.
Packaging checks do not replace native or provider acceptance.

Current signing is ad-hoc, without Developer ID or Apple notarization.
Keep that status visible in the website, DMG notes, release body, and cask caveats.
Do not add quarantine removal, Gatekeeper changes, or privileged installation hooks.

## Publish

Create a GitHub release at the checked commit with the DMG, source ZIP, `release.json`, and `SHA256SUMS.txt`.
Verify the downloaded public DMG matches the local SHA-256 before publishing the cask or production download link.
The cask pins the versioned GitHub URL and checksum, declares arm64 and macOS Tahoe requirements, installs `Chirpberry.app`, and preserves user data during uninstall.
Run Homebrew style and audit, then test an actual installation without overwriting an existing app.
Do not claim a clean install from a download-only check.

Create the Vercel project with repository root directory `site` and production branch `main`.
Keep Git-triggered deployment disabled until release assets exist, or use preview deployments during preparation.
Check both download anchors, Homebrew copying, responsive layout, and the real downloaded DMG after production deployment.
Record release URLs, source revision, artifact checksums, install evidence, and remaining limitations in tracked release notes.
