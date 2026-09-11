# Reference research

Reviewed 2026-09-09.

- https://www.granola.ai/ establishes a note-first interface, enhancement from captured meeting context, calendar briefs, and later retrieval.
- https://wisprflow.ai/notetaker describes bot-free Mac capture, correction, speaker reassignment, vocabulary, imports, and meeting history exposed through MCP.
- https://valsea.ai/docs/realtime-notetaker documents the authenticated notetaker WebSocket, provisional and final transcript events, optional translation, and optional diarization.
- https://valsea.ai/docs/api/format documents meeting minutes, sales summaries, and service logs, including the raw-content fallback.
- https://valsea.ai/docs/api is the authoritative public endpoint directory; the dashboard requires account authentication.

The implementation follows the protocol and generic interaction patterns.
Competitor source, media, branding, and distinctive layouts are not copied.
Valsea's advertised language coverage is broader than any one endpoint; expose only documented translation targets and avoid blanket language or accuracy promises.

## Desktop simplification references — 2026-09-10

Research requested for a simpler Electron interface, then approved for implementation. The initial recommendations below record that research; the resulting behavior is owned by the Electron section of [DESIGN.md](../DESIGN.md).

The requested gallery is [Recent](https://recent.design/). Its [Interface category](https://recent.design/?category=interface) was browsed visually. Pair its concept and visual-detail references with actual product screens from Mobbin and official product sites when deciding workflows.

### Selected references

| Reference | Evidence inspected | Useful pattern for Chirpberry |
| --- | --- | --- |
| [Ando desktop concept on Recent](https://recent.design/i/i7wow0d-ando) | Rendered desktop chat concept with a narrow icon rail, subdued navigation, thin separators, and a thread pane. It is a concept, not a tested app flow. | A quieter window frame and less emphasis on navigation. Borrow restraint and spacing; the extra chat/thread columns do not belong in Chirpberry's default writing view. |
| [Bear](https://bear.app/) | Official Mac product screenshot: navigation, note list, large editor, small utility actions, and a formatting strip. | Let the title and notes dominate. Keep note actions small and put less frequent actions in an overflow menu. The three-column library is optional inspiration, not a requirement. |
| [Raycast Notes](https://www.raycast.com/core-features/notes) | Official floating meeting-note screenshot and note-switcher screenshot; [manual](https://manual.raycast.com/notes) documents hotkey access, one note at a time, Browse Notes, and optional formatting controls. | A focused scratchpad, immediate writing, and a compact searchable note switcher. This is the closest reference for quick capture while another app is in front. |
| [Notion meeting block on Mobbin](https://mobbin.com/screens/f893ebcb-9ca5-46c1-90fd-8941a21602af) | Actual web screen showing Notes/Transcript access, recording activity, Pause, and Stop within one meeting block. | Group meeting controls near their content. Keep capture state and Stop visible, while making the transcript an explicit choice. Borrow this block's hierarchy, not Notion's broader sidebar. |

Also inspected [Craft's editor](https://mobbin.com/screens/9b912cbe-4d0b-4699-9ae6-e0b1bd34f732), [Frame](https://mobbin.com/screens/c9e7a94c-f5a4-4871-bd6e-f330af623596), and [Obvious](https://mobbin.com/screens/a65b9010-7f2d-4a52-995c-fdb9d731f9d6). Their writing surfaces are useful, but the displayed inspector, collaboration, and workspace navigation add more structure than this simplification needs. Mobbin returned Evernote and Notion for the Granola query; neither is evidence of Granola's interface.

### Recommended direction

Combine Bear's emphasis on writing with Raycast's quick-access model, retaining Chirpberry's original identity. The existing Electron screenshot and renderer styles show two stacked toolbar rows, duplicate All notes labels, a prominent brand/create area, several persistent utility actions, and a transcript pane competing with the note.

1. **Default to two areas: recent notes and the editor.** Make Transcript a labeled toggle that opens an optional pane. Preserve side-by-side source and translation within each provider segment when that pane is open.
2. **Use one compact toolbar.** Remove the permanent idle sentence and consolidate the current toolbar rows. Record meeting is the primary notebook action; Dictate to clipboard remains available through the companion and a discoverable menu/shortcut.
3. **Simplify the sidebar.** Use a smaller brand mark, Search, a compact New note action, and recent notes. Present All notes, Pinned, and Notebooks through one clear filter/grouping control rather than repeating All notes above the same list.
4. **Reveal secondary tools when needed.** Put Export, Move, Pin, and Delete in a labeled accessible overflow menu and row context menu. Keep Settings reachable; put note/audio imports under a clear File/Import entry. Keep save failures visible even if successful autosave becomes a quiet indicator.
5. **Make a new note immediately writable.** Keep meeting metadata behind Details. Offer summary generation when there is useful source content, and show an existing Summary alongside My notes through a small view selector. Original notes remain separate from generated content.
6. **Give recording its own unmistakable state.** Once started explicitly, show activity, elapsed time, Pause, and Stop together. A hidden transcript must never hide recording status. Preserve actionable permission, provider, and disconnection errors.
7. **Keep the approved companion behavior.** Retain the 200px expanded width and responsive hover behavior. Use brief state text such as Listening, Processing, and Copied, based on real runtime state. Do not add decorative delay or expose all notebook-management controls in the bar.

The implementation pass covers the idle notebook, active recording, completed meeting, and clipboard states, with light/dark appearance and a narrow desktop window. This reference research itself did not measure usability or performance.

Links and shared conclusions live here; downloaded reference imagery and raw browser captures remain outside Git. Before a broader redesign, optional `$impeccable init` can formalize the missing PRODUCT.md using the existing project context.

### Installed Wispr Flow inspection

Inspected Wispr Flow 1.6.793 through its actual Mac interface on 2026-09-10. The Scratchpad hub separates recent notes from the focused scratchpad window. The focused window offers a collapsible notes area, note switching, new-note/search controls, a large editor, and compact formatting/copy actions. Chirpberry adopts the focused writing and collapsible-navigation principles, while keeping its own notebook structure, recording ownership, versioned notes, and branding. No competitor source or user note content was copied into the project; recording and account settings were not changed during reference inspection.
