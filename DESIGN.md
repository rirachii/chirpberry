# Chirpberry design

A quiet, native notebook for conversations that move between languages.
Use a warm ivory reading surface, deep ink text, and one mulberry accent (#884B78).
System SF typography and SF Symbols form the native interface; controls follow macOS spacing, focus, keyboard, dark appearance, and accessibility conventions.
The sidebar organizes meetings and notebooks, the main column keeps editable personal notes central, and a transcript inspector shows source speech beside its translation.
The live state is unmistakable and includes pause and stop actions.
Translation is attached to a complete utterance, with source labels and final versus provisional state visible.
Use native glass only for chrome and floating controls, keeping long text on opaque readable surfaces.

The Electron interface carries over the ivory, ink, and mulberry palette and the note-first reading order. Use OS system fonts and one portable icon family (Lucide) for its web controls. Keep keyboard focus, native text editing and Undo, dark appearance, and reduced-motion support.
The Electron candidate exposes recording, provider summaries, and the companion through the main-process recording owner. First use requires explicit cloud disclosure and protected credentials. Keep live drafts visually distinct from saved finals. The companion is 200×60 points expanded and 52×10 at rest, opens on entry, and collapses 120 ms after exit unless capture is active. Report unavailable platform integrations honestly in Settings.

The website uses a warm editorial layout with a large product screenshot and the same mulberry accent.
Use one clear download action, a selectable Homebrew command, and honest setup requirements.
Avoid fabricated testimonials, benchmark claims, and promises of feature parity that have not been verified.
Reference: Granola's note-first workflow, Wispr's transcript correction and speaker controls, and the design-contract structure from https://github.com/voltagent/awesome-design-md.

## Desktop companion

The floating bar rests as a translucent 52 × 10 point horizontal capsule (10 × 60 on a vertical edge), expanding on hover into a compact smoky lavender-gray capsule with a mulberry microphone button and white SF Symbols. Its background uses 62% opacity, with an opaque fallback for Reduce Transparency. Idle horizontal controls fit in a 200 × 60 point window; action targets are 34 points tall. No branding badge or custom hover tag sits above the controls.
Dock it to the top, bottom, left, or right of a display's usable area. Top/bottom use horizontal controls; left/right use vertical controls with upright icons.
Expand toward the center of the display without moving the resting handle out from under the pointer. Bottom is the initial default; remember the selected edge.
Expand immediately on pointer entry and fold after 120 ms away, with an 80 ms content transition. Re-entry cancels a pending close. Keep the bar open for popovers, menus, keyboard-only focus, and every non-idle capture state. Once the pointer enters and leaves, release the keyboard hold. Status feedback stays available in tooltips and accessibility values without keeping an idle bar expanded.
Respect Reduce Motion for the content transition. The bar is fixed and cannot be dragged. Settings > Quick capture > Dock position selects the edge; the right-click menu and Quick capture > Dock bar update that same setting.
It stays available across Spaces without activating Chirpberry merely by appearing.
Four entry points cover spoken language, dictation, a new meeting with an upcoming-meetings disclosure, and Scratchpad.
Native tooltips describe each action and shortcut. Feedback is appended to the control tooltips and retained in the bar's accessibility value. During capture, replace the idle actions with an inline named recording state, elapsed time, an actual microphone level, pause/resume, and Stop.
Fn / Globe toggles clipboard dictation by default: one standalone tap starts and the next finishes, copying only final text after a successful stop. A Scratchpad copy is retained. Held keys do not retrigger; using Fn with another key cancels the dictation action. Global Fn requires Accessibility permission; Control–Option–D remains a fallback. Settings also offers optional Tab dictation and explicitly describes its replacement of Tab navigation. The processing disclosure still precedes first capture.
Do not hide an active recording bar. Keep all actions labelled for accessibility and offer keyboard focus through Quick capture > Focus floating bar.

Scratchpad is a separate, resizable native window with a collapsible note list, search, a title, an opaque text editor, and Copy.
Use Notes and Summary as separate versions. Formatting inserts Markdown at the selection and supports native Undo.
The supplied Wispr Flow screenshots establish the quick-access workflow; keep Chirpberry's branding, single capsule composition, copy, and implementation original.
See docs/desktop-companion.md for capture, permission, persistence, and shortcut contracts.
