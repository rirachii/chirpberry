# Prepared DMG and Homebrew distribution — 2026-09-12

The owner requested DMG and Homebrew creation. The package is uploaded as a **draft prerelease**, the canonical cask has a draft PR, and the website download UI is implemented and tested in its separate checkout. No public installer, cask merge, or production website change is claimed by this receipt.

## Reviewable deliverables

- [GitHub draft release](https://github.com/rirachii/chirpberry/releases/tag/untagged-fdcb02c8e8b12408ccc7), planned tag `v0.2.0-preview.1`. Owner access is required while it is a draft.
- [Canonical Homebrew cask PR #2](https://github.com/rirachii/homebrew-tap/pull/2), branch `build/chirpberry-preview`, commit `420d33e`.
- Separate website checkout `chirpberry-web-onboarding`, branch `build/dmg-brew-preview`, commit `5accee3`. Its `docs/distribution-preview.md` records the publication order and local UI verification. This website branch is not deployed and has no Git remote.

The draft targets exact reviewed source `040e04e9f69ee96f6c06db70320ff1aa9a988d0f`, already merged into `main`. It contains the DMG, app ZIP, complete source ZIP, two blockmaps, `release.json`, and `SHA256SUMS.txt`. All seven GitHub-reported SHA-256 digests match the local files. The authenticated draft DMG was downloaded again and matched `2a08e4a9e281947678ff9353da1bc9d10aa4bb2d70aa067c1ab8826b232bf074`. Anonymous public availability remains pending.

## Homebrew verification

The cask declares Apple Silicon/macOS 26, the exact versioned DMG URL and checksum, and declarative installation into `Applications/Chirpberry Electron Candidate/Chirpberry.app`. It includes unnotarized and service-setup caveats. It has no privileged install, launch, quarantine/Gatekeeper modification, or user-data deletion hooks.

Homebrew style, basic audit, and workflow YAML checks passed. An isolated local tap used the checksum-verified authenticated draft download in Homebrew's cache. A real cask install into a temporary `--appdir` succeeded; its archive matched the tested Electron package and deep signature verification passed. Cask uninstall removed the temporary app. The local QA tap and its specific trust entry were removed afterward, and Homebrew developer mode was restored to off.

Gatekeeper assessment rejected the unnotarized installed preview. An attempted packaged MCP launch exited with signal 9; no quarantined first-launch acceptance is claimed. No security controls were changed. Online audit and anonymous fetch must run after publication. The cask workflow limits PR checks to metadata and makes public-download/install verification an explicit post-publication dispatch.

The first local install unintentionally triggered Homebrew's automatic old-version/cache cleanup. It was interrupted. An active `opt`-link check and `brew missing` then found no broken active links or missing dependencies. Subsequent commands disabled cleanup; the tap's QA instructions now require `HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_INSTALL_CLEANUP=1`, and `HOMEBREW_NO_ANALYTICS=1`.

## Website verification

The existing setup panel now has one DMG action, Mac requirements, signing status, release limits, checksums, Homebrew/Speech tabs with copy feedback, and advanced source instructions. Lint, TypeScript, 11 motion tests, and the static build passed. Browser checks covered both homepage and guide at 1440, 390, and 320 pixels: correct future URLs, synthetic clipboard success/failure, source instructions, no page overflow, accessibility, and no runtime errors or failed local requests. The guide still exposes download metadata, the brew command, and signing status without JavaScript. Local UI checks do not establish availability of the future public links.

## Publication remains a separate step

The tracked release procedure requires live OS/provider acceptance before publication. Those results remain incomplete. Creating these drafts does not clear that requirement or authorize recording. If the owner explicitly chooses experimental publication before those checks, record that direction and retain the preview limitations in the release, cask, and website.

Publish/verify the exact GitHub assets first, then merge and test the canonical cask, then deploy the prepared website branch. Do not advertise broken draft URLs as working downloads. Keep the native app and running Electron candidate untouched; the installed candidate archive is still `d523064270a299a75553cf4a2eb21fe5f0e762fa7e5f4fc5886b162bc40e718f`.
