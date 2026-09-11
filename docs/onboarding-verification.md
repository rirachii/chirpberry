# Onboarding verification — 2026-09-11

The `build/onboarding-journey` candidate adds a four-step first-run guide on top of Apple Calendar and optional local call suggestions. It is not a public desktop release.

- `scripts/verify.sh` passed: 32 Swift core tests, 27 native model tests, the read-only MCP smoke test, 3 legacy-site tests/build, and Electron typecheck, 64 unit/integration tests, native helper build, and production bundle.
- Electron UI acceptance: 27 scenarios passed in the complete run. Two old scenarios selected windows by array position and failed after onboarding changed startup timing. They now select the notebook by its renderer URL; both passed on focused rerun. All 29 scenarios have passed.
- New journey scenarios cover restart/resume, legacy settings, skip and replay, notes without accounts, persistence, compact dark/light accessibility, protected-key input clearing, Calendar denial/retry, optional detection, and no capture during setup. Credentials, Calendar and call metadata in the service setup scenario are synthetic.
- `npm run package --prefix desktop` produced an ad-hoc signed Mac ARM64 app. The packaged app passed all 8 production UI scenarios; 21 fixture-only scenarios were intentionally skipped. Deep strict code-signature verification passed.
- Packaged `app.asar` SHA-256: `4da8ba22a2743329df2696c687ed5e50d96da69f6ddff48c2086491d078ec57e`.
- The installed candidate was not replaced or quit. Its `app.asar` remained `d523064270a299a75553cf4a2eb21fe5f0e762fa7e5f4fc5886b162bc40e718f`.

Live Valsea/OpenAI requests, OS consent on a clean install, real Calendar account behavior, real Zoom/Teams/browser detection accuracy, physical Fn use, and Windows/Linux device acceptance remain independent release gates. There is no public DMG or Homebrew cask. The separate public website guide must link to this candidate's published source commit and disclose the preview status.
