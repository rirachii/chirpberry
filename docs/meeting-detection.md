# Apple Calendar and optional call suggestions

First-release decision: use calendars already in Apple Calendar and opt-in call suggestions on Mac. Direct Google/Microsoft sign-in is deferred; this build requires no OAuth app registration. Preserve any separate OAuth experiment without including it in the release candidate.

## Setup and interaction

Upcoming → **Connect Apple Calendar** requests macOS Calendar access, then reads the next seven days. Accounts already added in Calendar work without another login in Chirpberry. **Open Calendar app** opens the fixed system application; add a missing account through Calendar → Add Account. Connecting, preparing a note, and Join never start capture. **Continue without a calendar** returns to the notebook; manual notes and recording remain available.

**Suggest notes when a call starts** is off by default and independent of Calendar. It is available in Upcoming and Settings on supported Mac builds. Enabling it allows local audio-process metadata checks while Chirpberry is open. A nonmodal banner offers **Start notes** and **Dismiss**. If speech setup is incomplete, **Set up recording** opens Settings and starts nothing. A silent OS notification opens the notebook only; it never records or steals focus on arrival. System notification settings may prevent that notification; the banner remains available.

Start notes consumes a fresh suggestion exactly once, creates a new meeting, and enters the existing recording owner. The main process checks the disclosure, saved-key status, capture capability, current activity, and concurrent recording state. Normal OS permissions, provider requests, final persistence, stop, and failure behavior apply. Suggestions cannot stop an existing recording. No event title or attendee is inferred from activity, and no calendar event is automatically attached.

## Detection boundary

The Mac helper reads Core Audio's process-object list, bundle ID, and active-input flag. It creates no audio tap or stream and reads no screen, window title, tab, URL, meeting content, or clipboard. It filters locally to a fixed allowlist and returns at most eight source enums; process IDs and arbitrary app inventories never cross the bridge. Detection has no network calls and no activity history on disk. Only the user's enabled preference persists.

The allowlist covers Zoom, Teams, Chrome, Edge, Brave, Firefox, Safari, and Arc when Core Audio attributes input to the recognized app or its known helper bundle. The input property indicates running input IO, not proof that a person joined a meeting. Browser calls are labeled **Possible call in Chrome** (or the browser name), never **Google Meet detected**. Web speech, a microphone test, or a call lobby may cause a suggestion. A muted call, unrecognized helper, unsupported browser, or absent microphone input may be missed. Safari/WebKit and other shared helpers may not be attributable; unknown owners are ignored rather than guessed. Real application/version acceptance remains separate from allowlist matching.

Windows and Linux detection are unavailable in this implementation. Electron alone does not provide this Mac API on those platforms. Manual recording remains the fallback.

## Lifecycle and bounds

- Poll every five seconds after the previous request completes; never overlap probes. Require sustained input across two samples before suggesting. Query no more than 4,096 process objects, validate bridge results, and time out a query after three seconds.
- Offer one prompt across concurrent recognized sources, prioritizing native call apps. Dismissal and capture suppress repeats until at least one minute without that source's observed input. Sources that appear while a prompt is visible join its suppression period.
- Clear a prompt when its source disappears, capture starts, detection is disabled, or a query fails. Reject start tokens older than two minutes or whose last positive sample is at least fifteen seconds old. Polling gaps do not grant permission to start from stale activity.
- Keep probe errors generic, clear the prompt, and retry after thirty seconds. The existing helper recovery policy applies. Disable/shutdown invalidates pending results; shutdown cancels the timer and closes the notification. Re-enabling cannot overlap a still-pending probe.
- Defer metadata checks while the integration helper is handling another request or retiring. Clear the suggestion and require fresh samples afterward. Background probe deadlines must not interrupt Keychain or Calendar consent dialogs.
- Calendar and detection preference patches merge against the current settings inside the serialized write queue, so concurrent independent connection actions do not discard each other's settings.

## Acceptance

`desktop/tests/meeting-detection.test.ts` checks sustained activity, false positives from brief activity, dismissal/rearm, expiry, one-time token consumption, recording suppression, validation errors, recovery, pending disable/re-enable, coalescing, and shutdown. `meeting-activity-native.test.mjs` compiles the real Swift reader on Mac, verifies allowlist rejection, and runs a bounded read-only metadata query without printing private app data.

`desktop/tests/e2e/meeting-detection.spec.ts` drives the real Electron UI with a fixture-only metadata source and synthetic audio: opt-in, setup gate, dismissed/stale token rejection, generic browser copy, explicit Start notes, active-recording replay rejection, Stop, exact final persistence, relaunch, disabled integrations, compact dark appearance, reduced motion, and accessibility. Production builds exclude the fixture adapters and timing overrides. Existing calendar E2E checks cover connection, occurrence identity, permission failure, refresh, and disconnect.

Before release, verify a real account's events and a consented Zoom, Teams, and Google Meet call on the packaged Mac build. Check active input, mute/lobby behavior, no recording before Start, notifications with the app in the background, dismissal, call end, and a second call. These are open device gates; synthetic acceptance and a successful metadata query do not prove real call accuracy.

## Sources

- Apple [EventKit access](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui).
- Apple [active process input](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput). The macOS SDK `AudioHardware.h` defines `kAudioHardwarePropertyProcessObjectList`, `kAudioProcessPropertyBundleID`, and `kAudioProcessPropertyIsRunningInput`; the bundle-ID result is caller-released.
- Apple [Calendar accounts](https://support.apple.com/guide/calendar/add-or-delete-calendar-accounts-icl4308d6701/mac).
