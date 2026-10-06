# Chirpberry workspace

Use `chirpberry/` as the single local workspace for active Chirpberry development.
The desktop app, public website, and shared Homebrew tap retain their existing repository histories and publication boundaries.

## Layout

| Path | Purpose | Repository |
| --- | --- | --- |
| `desktop/` | Current Electron app | `rirachii/chirpberry` |
| `macOS/` | Preserved SwiftUI app | `rirachii/chirpberry` |
| `site/` | Preserved native marketing draft | `rirachii/chirpberry` |
| `website/` | Current public Vercel website and onboarding guide | Independent local Git repository, no remote configured |
| `homebrew-tap/` | Local link to the existing sibling `homebrew-tap` checkout | `rirachii/homebrew-tap` |

The desktop repository ignores `website/` and `homebrew-tap` because these are local workspace connections, not vendored source or submodules.
Run Git commands inside the repository being changed.
Cloning the desktop repository alone does not recreate the website checkout or the local tap link.
The website's source and deployment receipts are tracked in its own repository.

## Consolidation baseline

The October 6, 2026 consolidation selected the latest completed source and preserved unfinished drafts separately.
The desktop baseline is `c00f6ad`, fetched from `origin/main` that day.
It includes the native notebook, Electron release candidate, notebook simplification, meeting assistant, Apple Calendar detection, onboarding journey, and branch-protection documentation.
The website baseline is `c2890c9`, including public onboarding, preview downloads, download-before-walkthrough behavior, and the footer outline correction.
The active app and website use local `chore/consolidate-workspace` branches for workspace documentation.
The existing canonical Homebrew checkout was already at `9c484e2` and contains the preview cask and protection documentation.

No unfinished native, website, or direct calendar-sign-in changes were integrated into these baselines.
Consolidation does not publish a new desktop release or deploy the website.

Verification exposed a Swift 6.4 build-layout change: the default Swift Build engine puts a combined `ChirpberryCore.o` and module beside the products, while the older SwiftPM layout has per-file objects in `ChirpberryCore.build` and modules in `Modules`.
The native-helper packaging script now recognizes both layouts.
The failing `npm run build:native --prefix desktop` command passed after that compatibility fix.
Application behavior, website source, release pins, and deployment identities otherwise retain their completed baselines.

## Run and verify

From the workspace root:

```sh
# Electron
npm start --prefix desktop
npm run verify --prefix desktop

# Preserved app and legacy site
scripts/verify.sh

# Current public website
cd website
npm run dev -- --port 3001
npm run lint
npx tsc --noEmit --incremental false
npm run test:motion
npm run build
```

Use the website's own `AGENTS.md`, `DESIGN.md`, README, and deployment receipts for public-site changes.
Use the shared tap's own instructions for cask changes.
Desktop release acceptance and website publication remain governed by [the release procedure](releasing.md).

## Verification on October 6, 2026

| Check | Result |
| --- | --- |
| All ten archived folders | Original source hashes, file modes, revisions, branches, working-tree diffs, and untracked files matched |
| Worktree registrations and dependency links | No prunable worktrees or broken dependency symlinks |
| `scripts/verify.sh` | Passed: 32 Swift core tests, MCP protocol checks, 3 legacy-site tests/build, native capture-helper build, Electron typecheck/76 tests/build, signed native app build, and 28 native model tests |
| Public website checkout | Lint, TypeScript, 11 motion tests, and static production build passed from `website/` |
| Git whitespace checks | Passed in both active repositories |

These are local source, build, and archive checks.
They do not establish new live-provider, physical-device, installer, release-publication, or production-deployment acceptance.

## Preserved work

The former top-level folders were relocated into the sibling `_archive/chirpberry/2026-10-06/` directory.
Source file hashes, file modes, Git revisions, branches, working-tree diffs, and untracked files were checked before and after relocation.
Ignored files and old build products were retained; unchanged dependency installations from completed app and website checkouts were moved into the active workspace for reuse.
The private `before.json` archive manifest records the original source hashes and Git states.

| Former folder | Archive entry | Preserved state |
| --- | --- | --- |
| `chirpberry` | `chirpberry-native-draft` | Original `build/native-notebook` branch and uncommitted native/Electron draft |
| `chirpberry-calendar-connect` | Same name | `build/calendar-signin` and all unfinished sign-in changes |
| `chirpberry-electron-release` | Same name | Completed release-candidate worktree |
| `chirpberry-homebrew-preview` | Same name | Complete independent preview-tap clone |
| `chirpberry-meeting-assistant` | Same name | Completed meeting-assistant worktree and private notes |
| `chirpberry-meeting-detection` | Same name | Completed Calendar/call-suggestion worktree |
| `chirpberry-notebook-ui` | Same name | Completed notebook worktree and private notes |
| `chirpberry-onboarding` | Same name | Completed onboarding/protection worktree |
| `chirpberry-redesign` | `chirpberry-website-draft` | Original website `main` branch and uncommitted publication/design changes |
| `chirpberry-web-onboarding` | Same name | Latest completed website worktree |

Archived worktrees remain registered with their original repositories.
Inspect them with `git worktree list` from the app or website repository, and use `git status` inside the chosen archived checkout to resume a draft.
Use `git worktree move` to relocate a registered worktree so its metadata remains valid.
The archive includes private local environment/configuration files and research artifacts; keep it outside shared Git history.
Keep new shared engineering decisions in tracked repository documentation.
