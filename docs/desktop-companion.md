# Desktop companion

The floating bar and Scratchpad provide quick entry points into the same notebook and capture lifecycle as the main window.
They are local implementation features; live provider and external-editor acceptance remain separate release gates.

## Actions

| Action | Global shortcut | Behavior |
| --- | --- | --- |
| Dictate | Fn / Globe, plus Control-Option-D | Begin microphone dictation; tap again to finish and copy final text. Settings also offers Control-Option-D or Tab. |
| New meeting | Control-Option-M | Create a meeting and open recording setup. During a session, reveal the existing recording. |
| Scratchpad | Control-Option-S | Open the current scratchpad without starting audio. |
| Focus floating bar | Command-Shift-B, in Chirpberry | Focus the bar for keyboard navigation. |

The globe selects the spoken language for the next session. Meeting translation remains independently configured in the notebook.
The chevron opens upcoming meetings from authorized Mac calendars. Connection is explicit and optional; merely opening the menu does not request access.
Choosing a calendar event prepares notes without recording. Reopening the same event reuses its untrashed note.
The bar starts collapsed as a 52 × 10 point translucent handle at the bottom edge. Hover expands it immediately inward into a compact 200-point idle window; leaving folds it after 120 ms. Re-entry cancels the close. The content transition lasts 80 ms and respects Reduce Motion. Vertical edges retain a 10 × 60 point handle.
The expanded bar is a single translucent lavender-gray capsule, without a separate branding/hover badge. Native tooltips retain action labels and append feedback; the toolbar's accessibility value also carries status feedback. Capture states appear inline. Reduce Transparency uses an opaque background.
Top/bottom positions use a horizontal handle and controls. Left/right positions use a vertical handle and an upright vertical control rail.
Choose a fixed edge in Settings > Quick capture > Dock position. The handle/bar right-click menu and Quick capture > Dock bar update the same preference. Arbitrary movement and dragging are disabled at the NSPanel level.
The selected edge persists across launches. Docking uses the display's usable frame, keeping clear of the menu bar and macOS Dock; disconnected displays fall back to an available screen.
An AppKit tracking area remains active while another application has focus and follows the visible view bounds without being recreated on every layout pass. Resize-generated exits are ignored while the pointer is still inside the panel. Menu/popover interaction, keyboard-only focus, and any active capture keep the bar expanded. Pointer entry followed by exit releases the keyboard hold; status feedback does not delay idle collapse.
The Quick capture menu can show, hide, collapse, or focus the bar. Escape folds a keyboard-focused idle bar. Hiding and collapsing are disabled during capture, including pause and finalization.
Settings > Quick capture > Dictation key selects Fn / Globe (the default), Control–Option–D, or Tab. Tab takes over ordinary unmodified Tab navigation only when explicitly selected; changing modes unregisters it immediately and persists the choice. Control–Option–D remains registered in every mode. Shift-Tab and other modified combinations are not registered.
Carbon handles ordinary exclusive global shortcuts. Modifier-only Fn uses a main-run-loop Core Graphics event tap with Accessibility access. Only standalone Fn press/release events are consumed; another key or modifier during the press cancels activation and its event passes through. The tracker retains only held/combination state, never typed text. Actions run after the event callback returns, and unregistering cancels queued actions. If global Fn is unavailable, an AppKit local monitor supports Fn inside Chirpberry; app activation retries global registration after permission is granted. Changing modes or quitting removes all taps and monitors.
An AppKit local monitor also handles unmodified Tab events delivered directly to Chirpberry in Tab mode. Shared press/release tracking prevents key-repeat from starting and immediately stopping dictation. Fn activates once on release. Its standalone tap replaces the system Globe action while this mode is active; Fn combinations are passed through and require physical-key acceptance on the target Mac.
If the OS or another app rejects a shortcut registration, the bar and Settings report the unavailable key and the buttons remain usable. Accessibility permission is requested only through the explicit Enable Accessibility button.

## Dictation

The first dictation presents the Valsea processing disclosure and requires acknowledgement plus Start dictation.
Later button or shortcut activations explicitly start capture under the saved acknowledgement. Settings can reset the disclosure.
Dictation always uses one microphone stream, no system audio, no translation, and no diarization, independent of meeting settings.
Final source text appends to the scratchpad; provisional speech stays in memory. Original notes are never replaced by a summary.

In the default Fn mode, Dictate copies the completed source text to the clipboard after an explicit successful Stop. It never inserts or sends that text into another app. Empty results, failures, cancellation, window closure, and quit leave the clipboard unchanged. Clipboard delivery is consumed once per armed session and partial text is never copied. The first disclosure names Clipboard as the destination.
In Control–Option–D or Tab mode, the optional Insert dictation into the active app setting remembers the frontmost application's supported editable field at the user's action. With Accessibility permission, insertion uses Apple's selected-text API.
The destination must still be the same application and field before insertion. Secure text fields are excluded. The implementation reads field metadata, not its text, and neither pastes through synthesized keystrokes nor submits messages.
If permission, the field, or direct insertion is unavailable, the result remains in Scratchpad with an explicit Copy action.
Settings can restrict dictation to Chirpberry. The Scratchpad Dictate button always appends to its current note.

Only one capture can run. Pause ends streams; resume creates fresh ones. Stop drains final events before delivering a result.
Closing the notebook, closing Scratchpad during dictation, closing the bar, and quitting stop capture. Window closure and quit never change the clipboard, insert into another app, or reopen a closed scratchpad.
The bar remains visible during capture; no automatic background recording or saved audio file is added.

## Scratchpad and storage

Scratchpads are ordinary version-1 meeting documents with optional `entryKind: "scratchpad"` metadata and the Scratchpad notebook label.
Older files without the field still decode. Scratchpads participate in local search, export, reversible Trash, and the existing read-only MCP tools.
The compact window maintains its own selection so opening it does not replace the selected meeting.
Autosave uses the same atomic owner-only store. Failure to save prevents a new recording and aborts an active one.
Bold, italic, heading, bullet, and checklist commands operate on the selected UTF-16 text range. Formatting participates in Undo.
Summarize uses the existing Valsea meeting, sales, or support format and writes a separate Summary. Copy uses the displayed version.

## Validation

Run `scripts/verify.sh` for Swift package tests, MCP checks, site checks, the native Release build, and the standalone native model tests.
The `ChirpberryModelTests` Xcode scheme compiles the actual notebook/capture source with isolated document directories, without starting microphone capture or calling Valsea.
Core coverage includes legacy document decoding, scratchpad round trips, multilingual formatting, stale ranges, and preservation of original typed text.
Dock geometry tests cover all four edges, inward expansion around the pointer, recording dimensions, and displays with negative or offset coordinates.
Model coverage includes persistence/relaunch, independent selection, explicit setup, capture exclusion, reversible Trash, closed-session delivery suppression, and storage failure before connection. Native shortcut tests cover held-key repeat suppression, a second press after release, Fn combination rejection, and cancelling queued actions when bindings change. Clipboard tests use an isolated named pasteboard to verify final delivery exactly once and preservation on empty, failed, or cancelled sessions.
Hover regression tests exercise the actual DesktopCompanion controller without attaching a notebook or registering shortcuts: immediate entry, prompt exit, re-entry cancellation, feedback persistence without pinning, transition from keyboard to pointer control, and popover retention. Native pointer-event delivery remains a separate UI acceptance check.

Native UI acceptance must use `CHIRPBERRY_DOCUMENTS_DIR` with temporary synthetic notes. Never reset the user's notebook or OS permissions for testing.
Check bar hover/focus and menus, scratchpad search/edit/format/Undo/Copy, collapse/expand, close/relaunch, and narrow layouts.
For docking, check collapsed startup, hover while another app is active, delayed exit, popover retention, all four setting choices, fixed positioning with dragging disabled, saved-edge relaunch, and screen disconnection.
Separately verify a consented Valsea dictation, final delivery on Stop, pause/resume, permission denial, changed or unsupported destination fields, a secure field, application switching, and full-screen Spaces.
Reference APIs: [NSPanel](https://developer.apple.com/documentation/appkit/nspanel), [Accessibility insertion](https://developer.apple.com/documentation/applicationservices/axuielementsetattributevalue(_:_:_:)).
