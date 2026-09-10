import React, { useState } from 'react';
import { CalendarDays, Folder, KeyRound } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/api';
import type { AppSettings } from '../shared/capture';
import type { Meeting } from '../shared/meeting';
import { targets } from '../shared/meeting';

export function SettingsPanel({ runtime, onChange, onCreated, onUpcoming }: { runtime: RuntimeSnapshot; onChange(value: RuntimeSnapshot): void; onCreated(meeting: Meeting): void; onUpcoming(): void }) {
  const [form, setForm] = useState(runtime.settings);
  const [key, setKey] = useState('');
  const [assistantKey, setAssistantKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const edit = (patch: Partial<AppSettings>) => setForm(previous => ({ ...previous, ...patch }));
  async function perform(action: () => Promise<unknown>, success = '') {
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'This setting could not be saved.'); }
    finally { setBusy(false); }
  }
  return <div className="settings-panel">
    <p>Notes stay on this device. Use Import to copy documents from the original Mac app into this notebook.</p>
    {runtime.capabilities.problem && <p className="settings-warning" role="status">{runtime.capabilities.problem}</p>}
    <h3><KeyRound size={15} />Valsea account</h3>
    <p className="small">{runtime.keySaved ? 'An API key is saved in protected storage.' : 'Add your own Valsea API key to enable speech and summaries.'} Valsea is a hosted service with its own account and usage costs.</p>
    <form onSubmit={event => { event.preventDefault(); void perform(async () => { const saved = await window.chirpberry.saveKey(key); setKey(''); onChange({ ...runtime, keySaved: saved }); }, 'API key saved in protected storage.'); }}>
      <label>Valsea API key<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} maxLength={4096} placeholder={runtime.keySaved ? 'Enter a replacement key' : 'Your API key'} /></label>
      <div className="settings-actions"><button className="secondary" type="submit" disabled={busy || !key.trim() || !runtime.capabilities.protectedCredentials}>Save API key</button>
        {runtime.keySaved && <button type="button" className="text-button" disabled={busy} onClick={() => void perform(async () => { await window.chirpberry.saveKey(''); onChange({ ...runtime, keySaved: false }); }, 'API key removed.')}>Remove key</button>}</div>
    </form>
    <h3><KeyRound size={15} />Ask meeting · OpenAI</h3>
    <p className="small">A separate OpenAI API key powers questions and response suggestions. Your ChatGPT subscription does not include API usage.</p>
    <form onSubmit={event => { event.preventDefault(); void perform(async () => { const saved = await window.chirpberry.saveAssistantKey(assistantKey); setAssistantKey(''); onChange({ ...runtime, assistantKeySaved: saved }); }, 'OpenAI key saved in protected storage.'); }}>
      <label>OpenAI API key<input type="password" autoComplete="off" spellCheck={false} value={assistantKey} maxLength={4096} onChange={event => setAssistantKey(event.target.value)} placeholder={runtime.assistantKeySaved ? 'Enter a replacement key' : 'Your OpenAI API key'} /></label>
      <div className="settings-actions"><button className="secondary" type="submit" disabled={busy || !assistantKey.trim() || !runtime.capabilities.protectedCredentials}>Save OpenAI key</button>
        {runtime.assistantKeySaved && <button type="button" className="text-button" disabled={busy} onClick={() => void perform(async () => { await window.chirpberry.saveAssistantKey(''); onChange({ ...runtime, assistantKeySaved: false }); }, 'OpenAI key removed.')}>Remove OpenAI key</button>}</div>
    </form>
    <form onSubmit={event => { event.preventDefault(); void perform(async () => { const result = await window.chirpberry.saveSettings(form); onChange(result); setForm(result.settings); }, 'Settings saved.'); }}>
      <h3>Recording and cloud processing</h3>
      <div className="disclosure"><p>When you start a recording, microphone audio—and system audio if selected—is streamed to Valsea for transcription. Generating a summary sends that note and transcript to Valsea. Importing audio sends the selected file.</p>
        <p>Make sure participants know you are recording. Live audio is not saved by Chirpberry; final transcripts are saved locally. Partial text is temporary. Stop, app close, or a capture failure ends recording. System audio uses a separate transcription stream and may add usage costs.</p>
        <label className="check-label"><input type="checkbox" checked={form.disclosureAccepted} onChange={event => edit({ disclosureAccepted: event.target.checked })} />I understand and agree to this cloud processing when I start these actions.</label>
      </div>
      <div className="settings-grid">
        <label>Spoken language<select value={form.language} onChange={event => edit({ language: event.target.value })}><option value="auto">Detect automatically</option><option value="english">English</option><option value="chinese">Chinese</option><option value="japanese">Japanese</option><option value="korean">Korean</option><option value="spanish">Spanish</option><option value="french">French</option><option value="german">German</option><option value="vietnamese">Vietnamese</option><option value="thai">Thai</option><option value="indonesian">Indonesian</option><option value="malay">Malay</option></select></label>
        <label>Translation language<select value={form.targetLanguage} onChange={event => edit({ targetLanguage: event.target.value })}>{targets.map(target => <option key={target} value={target}>{target[0].toUpperCase() + target.slice(1)}</option>)}</select></label>
      </div>
      <label className="check-label"><input type="checkbox" checked={form.translate} onChange={event => edit({ translate: event.target.checked })} />Translate live meetings</label>
      <label className="check-label"><input type="checkbox" checked={form.includeSystemAudio} disabled={!runtime.capabilities.systemAudio} onChange={event => edit({ includeSystemAudio: event.target.checked })} />Include system audio in meetings{!runtime.capabilities.systemAudio && ' (unavailable here)'}</label>
      <label className="check-label"><input type="checkbox" checked={form.diarize} onChange={event => edit({ diarize: event.target.checked })} />Separate speakers when Valsea identifies them (additional provider cost)</label>
      <p className="small muted">Clipboard dictation always uses microphone audio in the original language.</p>
      <label>Language hints<input value={form.hints} maxLength={100} onChange={event => edit({ hints: event.target.value })} placeholder="For example: en, zh" pattern="[a-zA-Z ,]*" /></label>
      <label>Names and vocabulary<textarea value={form.vocabulary} rows={2} maxLength={4000} onChange={event => edit({ vocabulary: event.target.value })} /></label>
      <h3>Floating capture bar</h3>
      <label className="check-label"><input type="checkbox" checked={form.barVisible} disabled={runtime.capture.state !== 'idle'} onChange={event => edit({ barVisible: event.target.checked })} />Show the floating bar</label>
      <label>Position<select value={form.dock} onChange={event => edit({ dock: event.target.value as AppSettings['dock'] })}>{['bottom', 'top', 'left', 'right'].map(dock => <option key={dock} value={dock}>{dock[0].toUpperCase() + dock.slice(1)}</option>)}</select></label>
      <h3>Dictation shortcut</h3>
      <label className="check-label"><input type="checkbox" checked={form.shortcutsEnabled} disabled={!runtime.capabilities.microphone} onChange={event => edit({ shortcutsEnabled: event.target.checked })} />Enable global capture shortcuts</label>
      <p className="small">{runtime.capabilities.platform === 'darwin' ? 'Press Fn / Globe once to start dictating and again to finish and copy. Accessibility access is required. Control–Option–D is the fallback.' : 'Press Ctrl+Alt+D to start dictating and again to finish and copy. Fn is controlled by keyboard firmware on many PCs.'} Meeting: {runtime.capabilities.platform === 'darwin' ? '⌃⌥M' : 'Ctrl+Alt+M'}. Scratchpad: {runtime.capabilities.platform === 'darwin' ? '⌃⌥S' : 'Ctrl+Alt+S'}.</p>
      {runtime.capabilities.shortcut && <p className="small">Current shortcut: {runtime.capabilities.shortcut}</p>}
      {runtime.capabilities.platform === 'darwin' && <button className="secondary" type="button" disabled={busy} onClick={() => void perform(async () => onChange(await window.chirpberry.requestAccessibility()), 'After allowing Chirpberry Capture, save settings again to reconnect Fn.')}>Enable Fn Accessibility access</button>}
      <h3>Meeting questions and suggestions</h3>
      <div className="disclosure"><p>When you ask, excerpts of this meeting's notes, saved transcript, and recent questions are sent to OpenAI. Responses stream into Chirpberry. OpenAI's usage costs and data policies apply; Chirpberry requests no stored API response. Questions stay out of shared notes.</p>
        <label className="check-label"><input type="checkbox" checked={form.assistantDisclosureAccepted} onChange={event => edit({ assistantDisclosureAccepted: event.target.checked })} />Allow OpenAI processing when I ask about a meeting.</label>
      </div>
      <label>OpenAI model<input value={form.assistantModel} maxLength={100} onChange={event => edit({ assistantModel: event.target.value })} /></label>
      <label className="check-label"><input type="checkbox" checked={form.calendarReminders} onChange={event => edit({ calendarReminders: event.target.checked })} />Remind me two minutes before connected calendar meetings.</label>
      <div className="settings-actions"><button className="primary" type="submit" disabled={busy}>Save settings</button></div>
    </form>
    <hr /><h3><CalendarDays size={15} />Upcoming meetings</h3>
    <p className="small">Upcoming shows the next seven days from calendars connected to this Mac, including Google, iCloud, or Exchange accounts added to macOS Calendar. Calendar access begins when you choose Connect calendars.</p>
    <button className="secondary" onClick={onUpcoming}>Open Upcoming</button>
    <hr /><button className="secondary" onClick={() => void perform(() => window.chirpberry.showStorage())}><Folder size={16} />Open notebook folder</button>
    <p className="small muted settings-footnote">Electron release candidate · macOS builds are currently unnotarized. The original Mac app keeps its own documents. Close the notebook to stop capture and quit.</p>
    {message && <div className="settings-result" role="status">{message}</div>}
  </div>;
}
