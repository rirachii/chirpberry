import React, { useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/api';
import { meetingSourceNames } from '../shared/meeting-detection';

export function DetectionSetting({ checked, available, disabled, error, onChange }: {
  checked: boolean; available: boolean; disabled?: boolean; error?: string; onChange(enabled: boolean): void
}) {
  return <div className="detection-setting">
    <label className="check-label"><input type="checkbox" checked={checked} disabled={disabled || !available} onChange={event => onChange(event.target.checked)} />Suggest notes when a call starts</label>
    <p className="small muted">Checks microphone activity in Zoom, Teams, and supported browsers on this Mac. It reads no audio, tabs, or meeting content. Browser activity may be something other than a call.</p>
    <p className="small muted">Suggestions never start recording. No calendar connection is needed.</p>
    {!available && <p className="small muted">Call suggestions are unavailable in this build or on this platform.</p>}
    {error && <p className="inline-error" role="status">{error}</p>}
  </div>;
}

export function MeetingSuggestion({ runtime, capturing, onSettings, onError }: { runtime?: RuntimeSnapshot; capturing: boolean; onSettings(): void; onError(message: string): void }) {
  const [busy, setBusy] = useState(false);
  const prompt = runtime?.detection.prompt;
  if (!prompt || capturing) return null;
  const ready = runtime.keySaved && runtime.settings.disclosureAccepted;
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); }
    catch (error) { onError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'This suggestion could not be opened.'); }
    finally { setBusy(false); }
  }
  return <section className="meeting-suggestion" aria-label="Call suggestion">
    <AudioLines size={19} aria-hidden="true" />
    <div className="suggestion-copy"><p role="status"><strong>Possible call in {meetingSourceNames[prompt.source]}</strong></p><p>Start a new note when you’re ready. Recording is off.</p>
    </div>
    <div className="suggestion-actions"><button className="primary" disabled={busy || !runtime.capabilities.microphone} onClick={() => ready ? void perform(() => window.chirpberry.startDetectedMeeting(prompt.id)) : onSettings()}>{ready ? 'Start notes' : 'Set up recording'}</button>
      <button className="text-button" disabled={busy} onClick={() => void perform(() => window.chirpberry.dismissMeetingPrompt(prompt.id))}>Dismiss</button></div>
  </section>;
}
