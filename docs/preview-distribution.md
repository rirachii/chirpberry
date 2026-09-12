# Mac preview distribution — 2026-09-12

The owner explicitly approved publishing the exact tested package as an **experimental, unnotarized Mac preview** before the outstanding manual provider/device/performance gates. GitHub publication completed on September 12, 2026 at 04:35:47 UTC. This approval does not clear those acceptance gates, authorize recording, or authorize replacing the running app.

## Release and distribution

- [Public GitHub prerelease `v0.2.0-preview.1`](https://github.com/rirachii/chirpberry/releases/tag/v0.2.0-preview.1), published with `draft=false`, `prerelease=true`, and `latest=false`.
- [Canonical Homebrew cask PR #2](https://github.com/rirachii/homebrew-tap/pull/2), merged at `6005d6a31bb1346ea0ebf4aa16e00ea3489de352`. Both final-head checks passed at `25de45e`; the anonymous raw main-branch cask matches the reviewed file byte-for-byte.
- [Public website and onboarding guide](https://chirpberry.vercel.app/get-started), deployed from separate website source `3f68be9a7261a0f1821e838b4f15c804803d3024`, branch `build/dmg-brew-preview`. Production deployment `dpl_9syfZWwCPJm4dzJQ1svA3B4W5u72` is READY at https://chirpberry-bulrf8s8g-rirachiis-projects.vercel.app. Its locally committed `docs/distribution-preview.md` records the website evidence. The website has no Git remote and is not part of the desktop repository.

The public tag resolves to exact reviewed source `040e04e9f69ee96f6c06db70320ff1aa9a988d0f`, already merged into `main`. It contains the DMG, app ZIP, complete source ZIP, two blockmaps, `release.json`, and `SHA256SUMS.txt`. All seven GitHub-reported SHA-256 digests match the local files. The authenticated draft DMG was downloaded again and matched `2a08e4a9e281947678ff9353da1bc9d10aa4bb2d70aa067c1ab8826b232bf074`. Fresh anonymous downloads of the DMG (134,961,915 bytes), source ZIP (2,000,524 bytes), and SHA256SUMS.txt returned HTTP 200 and matched the prepared hashes. Source SHA-256: `bf0b203abf7263e929e13bfe720d088f9c73327d87d82ecb5e0d774f053eaf0d`; checksum-file SHA-256: `4844f67ea1397c3c5e6c414ed1473549e62fb7f3c274b9562ce7b5f7f1699938`. The original `release.json` remains unchanged and records its historical preparation state.

## Homebrew verification

The cask declares Apple Silicon/macOS 26, the exact versioned DMG URL and checksum, and declarative installation into `Applications/Chirpberry Electron Candidate/Chirpberry.app`. It includes unnotarized and service-setup caveats. It has no privileged install, launch, quarantine/Gatekeeper modification, or user-data deletion hooks.

Homebrew style, basic audit, and workflow YAML checks passed. An isolated local tap used the checksum-verified authenticated draft download in Homebrew's cache. A real cask install into a temporary `--appdir` succeeded; its archive matched the tested Electron package and deep signature verification passed. Cask uninstall removed the temporary app. The local QA tap and its specific trust entry were removed afterward, and Homebrew developer mode was restored to off.

Gatekeeper assessment rejected the unnotarized installed preview. An attempted packaged MCP launch exited with signal 9; no quarantined first-launch acceptance is claimed. No security controls were changed. The subsequent public checks are recorded below. The cask workflow limits PR checks to metadata and makes public-download/install verification an explicit post-publication dispatch.

The [public macOS workflow](https://github.com/rirachii/homebrew-tap/actions/runs/34673634654) passed at `a5705ff`: style, basic and online audits, actual cask installation into a disposable application directory, strict deep signature verification, MCP executable presence, and uninstall. The unrestricted online audit first rejected only the intentional prerelease label, so CI excludes only `github_prerelease_version`. A subsequent anonymous GitHub metadata quota failure was resolved by using the workflow's read-only token for that audit step; installation receives no token. No other audit or security check was disabled. The [post-merge workflow](https://github.com/rirachii/homebrew-tap/actions/runs/34673772970) repeated and passed those checks from canonical `main` at `6005d6a31bb1346ea0ebf4aa16e00ea3489de352`.

The first local install unintentionally triggered Homebrew's automatic old-version/cache cleanup. It was interrupted. An active `opt`-link check and `brew missing` then found no broken active links or missing dependencies. Subsequent commands disabled cleanup; the tap's QA instructions now require `HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_INSTALL_CLEANUP=1`, and `HOMEBREW_NO_ANALYTICS=1`.

## Website verification

The existing setup panel now has one DMG action, Mac requirements, signing status, release limits, checksums, Homebrew/Speech tabs with copy feedback, and advanced source instructions. Lint, TypeScript, 11 motion tests, and the static build passed. Browser checks covered both homepage and guide at 1440, 390, and 320 pixels: exact public release URLs, synthetic clipboard success/failure, source instructions, no page overflow, accessibility, and no runtime errors or failed local requests. The guide still exposes download metadata, the brew command, and signing status without JavaScript. The anonymous public download verification is recorded separately above. After deployment, the same browser suite passed again on the public alias at all three widths. Homepage, guide, robots.txt, sitemap.xml, and all 16 referenced entry assets returned HTTP 200; fingerprinted assets retained immutable caching. The compact live setup panel was visually inspected.

The website build reported dependency audit findings, documented in its own distribution receipt. It is a static export without hosted server functions or uploads; dependency maintenance remains open and no clean audit is claimed. The desktop artifacts were not rebuilt or changed for this website publication.

## Owner-approved experimental publication

The remaining stable-release checklist is still open: live Valsea and OpenAI behavior, fresh-user OS permissions and first launch, actual Calendar/call suggestions, physical Fn, and sustained-meeting performance. The owner explicitly approved experimental publication with these limitations visible in the release, cask, and website. No stable-release, Windows/Linux device, or native-app acceptance is claimed.

For future updates, publish and verify the exact GitHub assets first, then merge and test the canonical cask, then deploy the website. Do not advertise draft URLs as working downloads. Keep the native app and running Electron candidate untouched; the installed candidate archive is still `d523064270a299a75553cf4a2eb21fe5f0e762fa7e5f4fc5886b162bc40e718f`.
