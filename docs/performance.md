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

Apple M4 Pro, 14 logical CPUs, 48 GiB RAM, Darwin 25.5.0 arm64. The package's `app.asar` SHA-256 was `d523064270a299a75553cf4a2eb21fe5f0e762fa7e5f4fc5886b162bc40e718f` in both runs.

| Notebook | Instrumented startup | Mean summed working set | Mean summed CPU | Mean idle wakeups/second |
| --- | ---: | ---: | ---: | ---: |
| Empty | 671 ms | 571 MiB | 0.026% | 8.9 |
| 250 notes / 25,000 final segments / 5.4 MB JSON | 531 ms | 665 MiB | 0.034% | 9.1 |

Each row represents one sequential launch and ten idle samples, not repeated statistical trials. The populated notebook's shorter launch is not evidence that larger notebooks are faster. These are local measurements with instrumentation and shared-memory overcounting; they do not establish a memory ceiling or recording-performance target.
