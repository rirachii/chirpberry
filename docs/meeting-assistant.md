# Meeting assistant

Approved scope: calendar-linked meeting preparation and tracking, reviewed note sharing, questions about an ongoing or completed meeting, and on-demand response suggestions. This extends the simplified Electron notebook; it is not a claim of complete competitor parity.

## Interaction contract

- Upcoming reads calendars connected to macOS after an explicit connection. It refreshes while enabled, shows event times/countdowns, opens one note per event occurrence, and offers a separate Join action for HTTPS meeting links. Opening a note or joining a call never starts recording. Disconnect stops refresh/reminders. Direct Google/Microsoft OAuth and hosted sharing depend on the user's selected connection/sharing preference.
- Share opens a reviewable snapshot. Summary/action items are selected by default; personal notes and transcript are opt-in. Copy or export delivers exactly that snapshot, with no automatic attendee messaging. AI conversations are excluded.
- Ask meeting is an optional side panel. Ask, Catch me up, Suggest questions, and Help me respond use only the selected meeting's notes and persisted final speech available when requested. They work during capture. Responses stream, can be stopped independently of recording, and keep captured source excerpts available for review. Suggestions remain drafts until the user chooses to copy them.
- OpenAI is the initial cloud text provider, with a separate protected key and explicit disclosure in Settings. The model can be configured. Credentials and networking stay in main; no keys, audio, or assistant conversations enter meeting exports. The Responses API uses `store: false`; provider processing policies still apply.
- Assistant threads stay in session memory, are bounded, and clear on request or app exit. Switching notes cannot retarget an in-flight answer. Missing keys, cancelled/incomplete responses, unavailable context, denied calendars, and stale calendar refreshes are visible states.
- Keep the approved simple notebook and 200-point companion. No background screen reading or automatic response insertion is part of this workflow.

## Implementation and acceptance

1. Isolate changes on `build/meeting-assistant`, based on the verified notebook simplification.
2. Add bounded calendar/assistant/share modules with validated preload APIs and protected credentials.
3. Add Upcoming, Share preview, and optional Ask meeting surfaces.
4. Exercise context selection, citation IDs, recurrence identity, duplicate preparation, refresh/disconnect, exact share content, request cancellation, stream failures, and unchanged notes.
5. Run actual Electron E2E using deterministic calendar/audio/AI adapters, plus a local HTTP server exercising the production streaming parser. Run the repository verification script and packaged-app acceptance.
6. Separately verify real calendar authorization and live speech/AI requests when the user has connected their accounts. Never substitute synthetic success for provider or OS acceptance.

## Product demos and protocol sources

- [Granola demo meeting](https://www.granola.ai/demo-meeting), linked by its [setup guide](https://docs.granola.ai/help-center/getting-started/setting-up-granola-for-the-first-time).
- [Granola 101](https://docs.granola.ai/help-center/getting-started/granola-101): upcoming events open meeting notes, with chat scoped to the relevant notes.
- [Granola meeting chat](https://docs.granola.ai/help-center/getting-more-from-your-notes/chatting-with-your-meetings) and [sharing](https://docs.granola.ai/help-center/sharing/sharing-notes): before/during/after-meeting questions and explicit sharing; chats stay private.
- [Wispr Flow live dictation demo](https://www.youtube.com/watch?v=3zl6A-PZhfk), published by Wispr Flow; [interactive dictation demo](https://wisprflow.ai/demo).
- [Wispr Notetaker walkthrough](https://wisprflow.ai/notetaker) and [calendar/reminder documentation](https://docs.wisprflow.ai/articles/8955305188-meeting-detection-reminders-and-calendar-in-notetaker-beta): meeting preparation, live catch-up, transcript, summary, and upcoming-event navigation.
- [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses) and [Responses request contract](https://developers.openai.com/api/reference/resources/responses/methods/create).
- Apple [Calendar access](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui) and [Calendar entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.personal-information.calendars): the packaged main app declares the purpose string, and both the app and capture helper declare Calendar access under hardened runtime. These declarations enable the normal permission flow; they do not grant access.

Sources were inspected on 2026-09-10. Marketing accuracy and speed claims are not adopted as measured facts. Reference content informs interaction patterns only; original branding, source, and composition remain Chirpberry's.
