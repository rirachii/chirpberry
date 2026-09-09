# Release procedure

The canonical source repository is `rirachii/chirpberry`.
Homebrew publication belongs in `rirachii/homebrew-tap`, with a new `Casks/chirpberry.rb`.
Keep Converty and other casks unchanged.

## Prepare

Complete the acceptance gates in [verification status](verification.md#still-required).
Run `scripts/verify.sh`, the website browser suite, and the no-mistakes pipeline on the feature branch.
See the [CI workflow](../.github/workflows/ci.yml) for runner, build, regression, and signature checks; compilation does not replace native/provider acceptance.
Review changes and merge the checked branch before packaging a public release.
Never include API keys, test recordings, local notebook documents, or raw research in Git.

Update the app's Info.plist, settings footer, MCP version, website release links, and site package version together.
The first version is 0.1.0 for Apple Silicon and macOS 26+.

## Package

Packaging requires Python 3.11 or newer for `hashlib.file_digest`, in addition to the [native build prerequisites](../README.md#build-and-use).

```sh
python3 scripts/package-release.py
```

The script refuses a dirty working tree or an existing versioned DMG or source ZIP.
It builds a temporary checkout from the exact Git revision, verifies the architecture and signatures, creates a DMG with an Applications link and installation notes, mounts it read-only, and checks the bundled MCP helper.
The temporary source checkout, staging files, and mount point stay under the worktree's ignored `dist-native` directory.
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

GitHub Pages is enabled in workflow mode for `rirachii/chirpberry`, with the production route https://rirachii.github.io/chirpberry/.
After the public release and canonical cask are verified, manually dispatch `.github/workflows/pages.yml` on `main`.
The workflow has no push or pull-request deployment trigger. It builds Vite with base `/chirpberry/` and uses pinned official configure, upload, and deploy Pages actions.
Before artifact upload and deployment, `scripts/verify-public-release.py` checks the built page's advertised version, download links, and Homebrew commands against the app and site versions.
It also requires the public versioned `release.json`, the canonical cask's version/URL/SHA-256, and the SHA-256 of the downloaded public DMG to match.
The public manifest must advertise arm64 and macOS 26.0. Keep scalar `version`, `sha256`, and `url` declarations in `Casks/chirpberry.rb`; the gate supports `#{version}` in that URL.
Absent artifacts, mismatched metadata/checksums, and TLS failures refuse deployment. The check uses public HTTPS reads without credentials, does not install the cask, and does not publish artifacts.
Workflow preparation and fixture tests are separate from an actual Pages deployment; do not dispatch until the native/provider release gates are complete.

Vercel is an optional alternative with repository root directory `site` and production branch `main`.
The current CLI route is blocked by an untrusted corporate proxy certificate; do not bypass TLS verification. Keep Git-triggered production deployment disabled until the same release checks pass, or use preview deployments during preparation.
Run Vercel CLI commands from the repository root, where `.vercelignore` limits uploads to website source.
Check both download anchors, Homebrew copying and its failure fallback, desktop/mobile layouts, keyboard access, reduced motion, and the real downloaded DMG after production deployment.
Record release URLs, source revision, artifact checksums, install evidence, and remaining limitations in tracked release notes.
