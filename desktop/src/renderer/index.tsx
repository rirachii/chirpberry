import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Check, ChevronDown, Copy, Download, FileText, Folder, Import, Languages, Mic, Pause, Play, Square, Upload, Sparkles, PanelRightClose, PanelRightOpen, Pin, Plus, Search, Settings, StickyNote, Trash2, Undo2, X } from 'lucide-react';
import type { Meeting, MeetingPatch } from '../shared/meeting';
import { meetingSchema, serializeMeeting, searchableText, speakerKey, speakerName, timeLabel, timestamp } from '../shared/meeting';
import type { RuntimeSnapshot, SaveStatus } from '../shared/api';
import type { CaptureSnapshot } from '../shared/capture';
import { SettingsPanel } from './settings';
import './style.css';

type Filter = { kind: 'all' | 'pinned' | 'trash' | 'notebook'; name?: string };
const api = window.chirpberry;
function describeError(error: unknown) { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'That action could not be completed.'; }

function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedID, select] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'notes' | 'summary'>('notes');
  const [inspector, setInspector] = useState(true);
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState('');
  const [save, setSave] = useState<SaveStatus>({ state: 'saved' });
  const [runtime, setRuntime] = useState<RuntimeSnapshot>();
  const [capture, setCapture] = useState<CaptureSnapshot>({ state: 'idle', elapsed: 0, partials: {}, levels: {} });
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = meetings.find(meeting => meeting.id === selectedID);
  const notebooks = useMemo(() => [...new Set(meetings.filter(meeting => !meeting.isTrashed).map(meeting => meeting.notebook))].sort(), [meetings]);
  const visible = useMemo(() => meetings.filter(meeting => {
    const matches = filter.kind === 'trash' ? meeting.isTrashed : !meeting.isTrashed &&
      (filter.kind === 'all' || (filter.kind === 'pinned' ? meeting.isPinned : meeting.notebook === filter.name));
    return matches && (!query.trim() || searchableText(meeting).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }).sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt)), [meetings, filter, query]);

  useEffect(() => {
    const unsubscribe = api.onSaveStatus(status => { setSave(status); if (status.message) setMessage(status.message); });
    api.load().then(snapshot => {
      setMeetings(snapshot.meetings);
      select(snapshot.meetings.find(meeting => !meeting.isTrashed)?.id);
      if (snapshot.unreadable.length) setMessage(`${snapshot.unreadable.length} document(s) could not be opened. Their original files are preserved in your notebook folder.`);
      setLoaded(true);
    }).catch(error => setMessage(describeError(error)));
    return unsubscribe;
  }, []);
  useEffect(() => {
    const updateCapture = (snapshot: CaptureSnapshot) => { setCapture(snapshot); if (snapshot.message) setMessage(snapshot.message); };
    const off = [api.onCapture(updateCapture), api.onRuntime(setRuntime), api.onSelect(id => { select(id); setFilter({ kind: 'all' }); setQuery(''); }),
      api.onMeeting((incoming, fields) => setMeetings(previous => previous.some(meeting => meeting.id === incoming.id) ? previous.map(meeting => meeting.id === incoming.id ?
        { ...meeting, ...Object.fromEntries(fields.map(field => [field, incoming[field]])), updatedAt: incoming.updatedAt } : meeting) : [incoming, ...previous]))];
    void api.runtime().then(value => { setRuntime(value); updateCapture(value.capture); }).catch(error => setMessage(describeError(error)));
    return () => { off.forEach(unsubscribe => unsubscribe()); };
  }, []);
  useEffect(() => { if (settings) dialog.current?.showModal(); else dialog.current?.close(); }, [settings]);
  const receive = useCallback((meeting: Meeting | null) => {
    if (!meeting) return;
    setMeetings(previous => [meeting, ...previous.filter(value => value.id !== meeting.id)]); select(meeting.id);
    setFilter({ kind: 'all' }); setQuery(''); setTab('notes'); setMessage('');
  }, []);
  const create = useCallback(async (kind: 'meeting' | 'scratchpad' = 'meeting') => {
    try { receive(await api.create(kind)); } catch (error) { setMessage(describeError(error)); }
  }, [receive]);
  const importDocument = useCallback(async () => {
    try { receive(await api.import()); } catch (error) { setMessage(describeError(error)); }
  }, [receive]);
  useEffect(() => api.onCommand(command => {
    if (command === 'new') void create();
    if (command === 'import') void importDocument();
    if (command === 'search') search.current?.focus();
  }), [create, importDocument]);
  function chooseFilter(next: Filter) { setFilter(next); select(undefined); }
  function edit(patch: MeetingPatch) {
    if (!current) return;
    const updated = { ...current, ...patch, updatedAt: timestamp() };
    try { meetingSchema.parse(updated); serializeMeeting(updated); } catch {
      setMessage('This edit exceeds the document limit. Export a copy and continue in a new note.'); return;
    }
    const id = current.id;
    setMeetings(previous => previous.map(meeting => meeting.id === id ? { ...meeting, ...patch, updatedAt: updated.updatedAt } : meeting));
    setSave({ state: 'saving' });
    void api.update(id, patch).catch(error => { setMessage(describeError(error)); setSave({ state: 'error' }); });
  }
  async function perform(action: () => Promise<unknown>, success?: string) {
    try { const result = await action(); if (success && result !== false) setMessage(success); }
    catch (error) { setMessage(describeError(error)); }
  }
  async function cloud(action: () => Promise<unknown>) {
    if (!runtime?.settings.disclosureAccepted || !runtime.keySaved) { setSettings(true); setMessage('Save your Valsea key and review cloud processing in Settings, then start this action again.'); return; }
    setBusy(true); try { await action(); } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }
  const capturing = capture.state !== 'idle';
  const filterTitle = filter.kind === 'all' ? 'All notes' : filter.kind === 'pinned' ? 'Pinned' : filter.kind === 'trash' ? 'Trash' : filter.name;
  const activeCount = meetings.filter(meeting => !meeting.isTrashed).length;

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Notebook navigation">
      <div className="brand"><img src="./chirpberry.png" alt="" /><span>Chirpberry</span></div>
      <div className="create-row"><button className="primary" onClick={() => void create()} disabled={!loaded}><Plus size={17} />New meeting</button>
        <button className="icon-button" title="New scratchpad" aria-label="New scratchpad" onClick={() => void create('scratchpad')} disabled={!loaded}><StickyNote size={18} /></button></div>
      <label className="search"><Search size={16} /><input ref={search} aria-label="Search notes" placeholder="Search notes…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      <nav aria-label="Collections">
        <button className={filter.kind === 'all' ? 'nav-item selected' : 'nav-item'} onClick={() => chooseFilter({ kind: 'all' })}><BookOpen size={17} />All notes<span className="count">{activeCount}</span></button>
        <button className={filter.kind === 'pinned' ? 'nav-item selected' : 'nav-item'} onClick={() => chooseFilter({ kind: 'pinned' })}><Pin size={17} />Pinned</button>
        <details className="notebooks"><summary><span>Notebooks</span><ChevronDown size={14} /></summary>
          {notebooks.map(name => <button key={name} className={filter.kind === 'notebook' && filter.name === name ? 'nav-item selected' : 'nav-item'} onClick={() => chooseFilter({ kind: 'notebook', name })}><Folder size={16} /><span className="truncate">{name || 'Untitled notebook'}</span></button>)}
          {!notebooks.length && <p className="small muted notebook-hint">Organize notes from Meeting details.</p>}
        </details>
      </nav>
      <div className="list-heading"><span>{query ? 'Search results' : filterTitle}</span><span>{visible.length}</span></div>
      <div className="meeting-list" aria-label="Notes">
        {visible.map(meeting => <button key={meeting.id} aria-pressed={meeting.id === selectedID} className={`meeting-row ${meeting.id === selectedID ? 'selected' : ''}`} onClick={() => { select(meeting.id); setTab('notes'); }}>
          <span className="meeting-title">{meeting.isPinned && <Pin size={12} />}<span className="truncate">{meeting.title || 'Untitled meeting'}</span></span>
          <span className="meeting-preview truncate">{meeting.notes.trim().split('\n').find(Boolean) || (meeting.segments.length ? `${meeting.segments.length} transcript segments` : 'No notes yet')}</span>
          <span className="meeting-date">{new Date(meeting.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {meeting.notebook || 'Inbox'}</span>
        </button>)}
        {loaded && !visible.length && <p className="list-empty">{query ? 'No matching notes.' : filter.kind === 'trash' ? 'Trash is empty.' : 'Your notes will appear here.'}</p>}
      </div>
      <div className="sidebar-footer">
        <button className="nav-item" onClick={() => void importDocument()}><Import size={17} />Import</button>
        <button className={filter.kind === 'trash' ? 'nav-item selected' : 'nav-item'} onClick={() => chooseFilter({ kind: 'trash' })}><Trash2 size={17} />Trash</button>
        <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}><Settings size={18} /></button>
      </div>
      <button className="nav-item audio-import" disabled={busy} onClick={() => void cloud(async () => receive(await api.importAudio()))}><Upload size={16} />Transcribe audio file</button>
    </aside>
    <main className="workspace">
      {message && <div className="notice" role={save.state === 'error' ? 'alert' : 'status'}><span>{message}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={17} /></button></div>}
      {(capturing || current) && <div className={`recording-controls ${capturing ? 'is-recording' : ''}`} aria-label="Recording controls">
          {capturing ? <><span className="recording-indicator" /><span role="status">{capture.state === 'connecting' ? 'Connecting to Valsea…' : capture.state === 'finishing' ? 'Saving final speech…' : capture.state === 'paused' ? 'Paused' : capture.purpose === 'dictation' ? 'Dictating to clipboard' : 'Recording meeting'} · {timeLabel(capture.elapsed)}</span>
            {capture.meetingId !== current?.id && <button className="text-button" onClick={() => select(capture.meetingId)}>Go to recording</button>}
            <div className="capture-actions">{capture.state === 'paused' ? <button className="secondary" onClick={() => void perform(() => api.resumeCapture())}><Play size={14} />Resume</button> : capture.state === 'recording' && <button className="secondary" onClick={() => void perform(() => api.pauseCapture())}><Pause size={14} />Pause</button>}
              <button className="primary" disabled={capture.state === 'finishing'} onClick={() => void perform(() => api.stopCapture())}><Square size={13} />{capture.state === 'connecting' ? 'Cancel' : 'Stop'}</button></div>
          </> : current ? <><span className="capture-description">{current.entryKind === 'scratchpad' ? 'Speak a thought. Keep it here.' : 'Ready when the conversation starts.'}</span><div className="capture-actions">
            <button className="secondary" disabled={busy || current.isTrashed} onClick={() => void cloud(() => api.startCapture(current.id, 'dictation'))}><Mic size={14} />Dictate</button>
            <button className="primary" disabled={busy || current.isTrashed} onClick={() => void cloud(() => api.startCapture(current.id, 'meeting'))}><Mic size={14} />Record meeting</button></div></> : null}
        </div>}
      {current ? <>
        <header className="toolbar"><span className="breadcrumb"><Folder size={15} />{current.notebook || 'Inbox'}</span>
          <span className={`save-status ${save.state}`} role="status">{save.state === 'saved' ? <><Check size={13} />Saved on this device</> : save.state === 'saving' ? 'Saving…' : 'Not saved'}</span>
          <div className="toolbar-actions">
            <button className={`icon-button ${current.isPinned ? 'active' : ''}`} aria-label={current.isPinned ? 'Unpin note' : 'Pin note'} title={current.isPinned ? 'Unpin note' : 'Pin note'} onClick={() => edit({ isPinned: !current.isPinned })}><Pin size={17} /></button>
            <details className="menu"><summary aria-label="Export options" title="Export"><Download size={17} /><ChevronDown size={12} /></summary><div className="menu-items">
              <button onClick={() => void perform(() => api.export(current.id, 'markdown'), 'Markdown exported.')}><FileText size={16} />Export Markdown</button>
              <button onClick={() => void perform(() => api.export(current.id, 'json'), 'Chirpberry document exported.')}>Export Chirpberry JSON</button>
              <button onClick={() => void perform(() => api.copy(current.id), 'Copied notes and transcript.')}><Copy size={16} />Copy as Markdown</button>
            </div></details>
            <button className="icon-button" disabled={capture.meetingId === current.id} aria-label={current.isTrashed ? 'Restore note' : 'Move note to trash'} title={current.isTrashed ? 'Restore note' : 'Move to trash'} onClick={() => { edit({ isTrashed: !current.isTrashed }); setMessage(current.isTrashed ? 'Note restored.' : 'Note moved to Trash. You can restore it at any time.'); }}>
              {current.isTrashed ? <Undo2 size={17} /> : <Trash2 size={17} />}</button>
            <span className="toolbar-divider" />
            <button className="icon-button" aria-label={inspector ? 'Hide transcript' : 'Show transcript'} title={inspector ? 'Hide transcript' : 'Show transcript'} onClick={() => setInspector(value => !value)}>{inspector ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button>
          </div>
        </header>
        <div className={`document-layout ${inspector ? '' : 'without-transcript'}`}>
          <section className="document" aria-label="Meeting editor">
            {current.isTrashed && <div className="trash-notice"><Trash2 size={16} /><span>This note is in Trash.</span><button onClick={() => edit({ isTrashed: false })}>Restore</button></div>}
            <div className="document-heading"><div className="date-line">{current.entryKind === 'scratchpad' ? 'Scratchpad' : 'Meeting'}<span>·</span>{new Date(current.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
              <h1 aria-label={current.title || 'Untitled meeting'}><input className="title-input" aria-label="Meeting title" value={current.title} maxLength={300} onChange={event => edit({ title: event.target.value })} placeholder="Untitled meeting" /></h1>
              <details className="meeting-details"><summary>Meeting details<ChevronDown size={13} /></summary><div className="details-fields">
                <label>Notebook<input list="notebook-options" value={current.notebook} maxLength={100} onChange={event => edit({ notebook: event.target.value })} /></label>
                <datalist id="notebook-options">{notebooks.map(name => <option key={name} value={name} />)}</datalist>
                <label>Summary template<select value={current.template} onChange={event => edit({ template: event.target.value as Meeting['template'] })}><option value="meeting_minutes">Meeting notes</option><option value="sales_summary">Sales call</option><option value="service_log">Support conversation</option></select></label>
                <label>Vocabulary<textarea rows={2} value={current.vocabulary} maxLength={4000} onChange={event => edit({ vocabulary: event.target.value })} placeholder="Names and terms to remember" /></label>
              </div></details>
            </div>
            <div className="editor-tabs" role="tablist" aria-label="Note version" onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'notes' : event.key === 'End' ? 'summary' : tab === 'notes' ? 'summary' : 'notes';
              setTab(next); document.getElementById(`${next}-tab`)?.focus();
            }}><button id="notes-tab" role="tab" tabIndex={tab === 'notes' ? 0 : -1} aria-selected={tab === 'notes'} aria-controls="note-panel" onClick={() => setTab('notes')}>My notes</button><button id="summary-tab" role="tab" tabIndex={tab === 'summary' ? 0 : -1} aria-selected={tab === 'summary'} aria-controls="note-panel" onClick={() => setTab('summary')}>Summary</button></div>
            <div className="note-panel" id="note-panel" role="tabpanel" aria-labelledby={tab === 'notes' ? 'notes-tab' : 'summary-tab'}>
              {tab === 'summary' && <div className="summary-tools"><p className="summary-hint">Generate notes and action items with Valsea. Your original notes stay in My notes.</p><button className="secondary" disabled={busy || current.isTrashed || capture.meetingId === current.id} onClick={() => void cloud(() => api.summarize(current.id))}><Sparkles size={14} />{busy ? 'Working…' : 'Generate summary'}</button></div>}
              <textarea key={`${current.id}-${tab}`} className="note-editor" aria-label={tab === 'notes' ? 'My notes' : 'Summary'} readOnly={tab === 'notes' && capture.meetingId === current.id && capture.purpose === 'dictation'} value={tab === 'notes' ? current.notes : current.enhancedNotes} maxLength={8 * 1024 * 1024} placeholder={tab === 'notes' ? 'A thought, a question, something to remember…' : 'Write or paste a summary…'} spellCheck onChange={event => edit(tab === 'notes' ? { notes: event.target.value } : { enhancedNotes: event.target.value })} />
            </div>
            {current.actions.length > 0 && <section className="actions" aria-label="Action items"><h2>Action items</h2>{current.actions.map(action => <label className="action" key={action.id}><input type="checkbox" checked={action.completed} onChange={event => edit({ actions: current.actions.map(item => item.id === action.id ? { ...item, completed: event.target.checked } : item) })} /><span>{action.description}{(action.owner || action.deadline) && <small>{[action.owner, action.deadline].filter(Boolean).join(' · ')}</small>}</span></label>)}</section>}
          </section>
          {inspector && <aside className="transcript" aria-label="Transcript"><header><Languages size={17} /><h2>Transcript</h2><span>{current.segments.length ? `${current.segments.length} segments` : ''}</span></header>
            {current.segments.length ? <div className="transcript-segments">{current.segments.map(segment => <article className="segment" key={segment.id}>
              <div className="segment-meta"><span>{segment.channel}</span><time>{timeLabel(segment.timestamp)}</time></div>
              {segment.utterances.length ? segment.utterances.map((utterance, index) => <div key={index} className="utterance"><input className="speaker-name" aria-label={`Speaker name at ${timeLabel(segment.timestamp)}, utterance ${index + 1}`} value={speakerName(current, segment, utterance.speaker)} onChange={event => edit({ speakerNames: { ...current.speakerNames, [speakerKey(segment.channel, utterance.speaker, segment.speakerScope)]: event.target.value } })} /><p>{utterance.transcript}</p></div>) : <p>{segment.original}</p>}
              {segment.translation !== undefined && <div className="translation"><span>{segment.targetLanguage || current.targetLanguage} · translation</span><p>{segment.translation}</p></div>}
            </article>)}</div> : <div className="transcript-empty"><Languages size={26} strokeWidth={1.3} /><h3>Keep both sides of the conversation.</h3><p>Source text and translations appear together as you speak.</p><p className="availability">Choose Record meeting to begin. Audio processing uses your Valsea account.</p></div>}
            {capture.meetingId === current.id && Object.entries(capture.partials).map(([channel, text]) => <div className="partial-transcript" key={channel}><span>{channel} · live draft</span><p>{text}</p></div>)}
          </aside>}
        </div>
      </> : <div className="empty-workspace"><img src="./chirpberry.png" alt="" /><h1>{!loaded ? 'Opening your notebook…' : filter.kind === 'trash' ? 'A second chance for your notes.' : activeCount ? 'Room for your next thought.' : 'Start with what matters.'}</h1>
        <p>{filter.kind === 'trash' ? 'Select a note to read or restore it.' : activeCount ? 'Choose a note from the sidebar, or begin a new one.' : 'A quiet place for your notes and multilingual conversations.'}</p>
        {loaded && filter.kind !== 'trash' && <div className="empty-actions"><button className="primary" onClick={() => void create()}><Plus size={17} />New meeting</button><button className="text-button" onClick={() => void importDocument()}><Import size={16} />Import your notes</button></div>}
        {loaded && !activeCount && <p className="preview-note">Your notes, on this device.<br />Connect your Valsea account in Settings for speech and summaries.</p>}
      </div>}
    </main>
    <dialog className="settings-dialog" ref={dialog} aria-labelledby="settings-title" onClose={() => setSettings(false)}><div className="dialog-header"><h2 id="settings-title">Chirpberry Settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettings(false)}><X size={20} /></button></div>
      {settings && runtime ? <SettingsPanel runtime={{ ...runtime, capture }} onChange={setRuntime} onCreated={meeting => { receive(meeting); setSettings(false); }} /> : <p>Loading settings…</p>}
    </dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
