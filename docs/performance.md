# Electron performance measurements

Use the actual packaged executable with a fresh isolated profile and synthetic documents:

```sh
cd desktop
npx tsx scripts/measure-idle.ts release/mac-arm64/Chirpberry.app/Contents/MacOS/Chirpberry 0
npx tsx scripts/measure-idle.ts release/mac-arm64/Chirpberry.app/Contents/MacOS/Chirpberry 250
```

Run these sequentially after builds and UI tests have finished. Keep manual app interaction separate from automated acceptance: competing windows can invalidate focus assertions and resource measurements. Store raw JSON outside Git.

Each run starts an isolated notebook with OS integrations disabled and the floating bar enabled. Synthetic notes contain approximately 3 KB of notes plus 100 final transcript segments each. The script removes its profile and documents after app shutdown. It makes no provider requests and reads no real credentials or calendars.

Startup measures instrumented launch through the first usable notebook control. After three seconds of warmup and a discarded initial CPU sample, ten samples are taken one second apart using Electron's process metrics. The report sums process CPU usage and working sets and records the actual `app.asar` checksum. Summed working sets can double-count shared memory; they are not unique physical memory usage.

These short local measurements do not establish cold-boot performance, energy usage, sustained capture behavior, search latency, or Windows/Linux performance. Longer idle and consented recording measurements remain release gates.

## Local baseline — 2026-09-10

Apple M4 Pro, 14 logical CPUs, 48 GiB RAM, Darwin 25.5.0 arm64. After the startup and Search fixes, the package's `app.asar` SHA-256 was `0ab9384d47121f567edf41d786a6a401afcee028bf4a2e55cc85ab4dcb1c56f2` in both runs.

| Notebook | Instrumented startup | Mean summed working set | Mean summed CPU | Mean idle wakeups/second |
| --- | ---: | ---: | ---: | ---: |
| Empty | 334 ms | 567 MiB | 0.027% | 8.7 |
| 250 notes / 25,000 final segments / 5.4 MB JSON | 497 ms | 662 MiB | 0.030% | 8.8 |

Each row represents one sequential launch and ten idle samples, not repeated statistical trials. These are local measurements with instrumentation and shared-memory overcounting; they do not establish a memory ceiling or recording-performance target.

## Synthetic recording soak

```sh
cd desktop
npm run build
node scripts/build.mjs --fixture
npx tsx scripts/soak-recording.ts 300
```

Run this separately from builds, other UI tests, and manual interaction with the test window. It accepts 30–1800 seconds and uses an isolated profile, synthetic credentials, and 250 generated background notes. The user’s installed app, notebook, Keychain, and clipboard are not test inputs. The fixture build is excluded from production packages.

Two generated mono PCM streams send 3,200-byte frames every 100 ms through the production WebSocket client to a loopback server. The server emits mutable partials, whole-segment translation pairs, repeated finals, and a last final on Stop. The real recording controller, store, preload, and notebook render the results. The test edits notes during capture, pauses and checks that traffic stops, resumes with new streams, checks exact persisted finals and phase scopes, stops, and verifies persistence and idle state after relaunch.

Metrics sample Electron processes every ten seconds with the transcript panel open. They exclude the external fixture server and do not include physical audio conversion/capture or cloud latency. Summed working sets can count shared memory more than once. This is sustained synthetic pipeline evidence, not a live microphone, Valsea, energy, or long-meeting qualification result.

### Local result — 2026-09-10

One 300-second run on the same Apple M4 Pro passed with 250 background notes and the transcript panel open. Fixture main-bundle SHA-256: `41de4b4fcb39147e36333969de166899065fa559221a1f237753122597809739`. This checksum identifies the synthetic main bundle, not the packaged app.

| Observation | Result |
| --- | ---: |
| Generated PCM through two streams | 19,052,800 bytes |
| Mutable partial events | 1,188 |
| Final segments persisted exactly once | 300 |
| Connections / explicit stream stops across Pause and Resume | 4 / 4 |
| Stop click to idle controls | 223 ms |
| Mean summed CPU across 30 samples | 1.19% |
| Mean summed working set | 981 MiB |
| First / last sampled summed working set | 812 / 1,090 MiB |

Pause closed both streams and stopped PCM traffic; Resume opened fresh streams. Edits made during recording and every final translation pair survived relaunch, duplicate finals were ignored, transient drafts were absent from saved JSON, and reopening left capture idle without new connections. No audio files were written to the notebook directory.

Memory increased by about 278 MiB during the sampled interval. Growth slowed toward the end but did not establish a plateau. This single instrumented run neither proves a leak nor clears the sustained-memory gate. Longer runs with per-process and heap profiling, post-stop observation, and real consented capture remain necessary before setting performance targets.
