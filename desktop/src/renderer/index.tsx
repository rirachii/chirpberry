import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, CalendarDays, Check, ChevronDown, Copy, Download, FileText, Folder, Import, Languages, MessageCircle, Mic, Pause, Play, Share2, Square, Upload, Sparkles, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Pin, Plus, Search, Settings, StickyNote, Trash2, Undo2, X } from 'lucide-react';
import type { Meeting, MeetingPatch } from '../shared/meeting';
import { meetingSchema, serializeMeeting, searchableText, speakerKey, speakerName, timeLabel, timestamp } from '../shared/meeting';
import type { RuntimeSnapshot, SaveStatus } from '../shared/api';
import { MeetingSuggestion } from './meeting-detection';
import type { CaptureSnapshot } from '../shared/capture';
import { SettingsPanel } from './settings';
import { ActionMenu, type MenuAction, type MenuPoint } from './action-menu';
import { AssistantPanel } from './assistant';
import { Upcoming } from './upcoming';
import { ShareDialog } from './share';
import './style.css';
import './meeting-tools.css';

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
  const [inspector, setInspector] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [upcoming, setUpcoming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [searchRequest, setSearchRequest] = useState(0);
  const [contextMenu, setContextMenu] = useState<MenuPoint>();
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState('');
  const [save, setSave] = useState<SaveStatus>({ state: 'saved' });
  const [runtime, setRuntime] = useState<RuntimeSnapshot>();
  const [capture, setCapture] = useState<CaptureSnapshot>({ state: 'idle', elapsed: 0, partials: {}, levels: {} });
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const focusNewNote = useRef(false);
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
    const off = [api.onCapture(updateCapture), api.onRuntime(setRuntime), api.onSelect(id => { select(id); setUpcoming(false); setSharing(false); setFilter({ kind: 'all' }); setQuery(''); }),
      api.onMeeting((incoming, fields) => setMeetings(previous => previous.some(meeting => meeting.id === incoming.id) ? previous.map(meeting => meeting.id === incoming.id ?
        { ...meeting, ...Object.fromEntries(fields.map(field => [field, incoming[field]])), updatedAt: incoming.updatedAt } : meeting) : [incoming, ...previous]))];
    void api.runtime().then(value => { setRuntime(value); updateCapture(value.capture); }).catch(error => setMessage(describeError(error)));
    return () => { off.forEach(unsubscribe => unsubscribe()); };
  }, []);
  useEffect(() => { if (settings) dialog.current?.showModal(); else dialog.current?.close(); }, [settings]);
  const receive = useCallback((meeting: Meeting | null) => {
    if (!meeting) return;
    setMeetings(previous => [meeting, ...previous.filter(value => value.id !== meeting.id)]); select(meeting.id);
    setFilter({ kind: 'all' }); setQuery(''); setTab('notes'); setMessage(''); setUpcoming(false); setSharing(false);
  }, []);
  const create = useCallback(async (kind: 'meeting' | 'scratchpad' = 'meeting') => {
    try { const meeting = await api.create(kind); focusNewNote.current = true; receive(meeting); } catch (error) { setMessage(describeError(error)); }
  }, [receive]);
  const importDocument = useCallback(async () => {
    try { receive(await api.import()); } catch (error) { setMessage(describeError(error)); }
  }, [receive]);
  useEffect(() => api.onCommand(command => {
    if (command === 'new') void create();
    if (command === 'import') void importDocument();
    if (command === 'search') { setSidebar(true); setSearchRequest(value => value + 1); }
  }), [create, importDocument]);
  useEffect(() => { if (searchRequest && loaded) search.current?.focus(); }, [searchRequest, loaded]);
  function chooseFilter(next: Filter) { setFilter(next); select(undefined); setContextMenu(undefined); setUpcoming(false); }
  useEffect(() => { if (focusNewNote.current && current) { editor.current?.focus(); focusNewNote.current = false; } }, [selectedID]);
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
    setMessage(''); setBusy(true); try { await action(); } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }
  const capturing = capture.state !== 'idle';
  const activeCount = meetings.filter(meeting => !meeting.isTrashed).length;

  function showDetails() {
    if (details.current) { details.current.open = true; details.current.querySelector('input')?.focus(); }
  }
  const noteActions: MenuAction[] = current ? [
    { label: 'Dictate to clipboard', icon: <Mic size={16} />, disabled: busy || capturing || current.isTrashed, action: () => void cloud(() => api.startCapture(current.id, 'dictation')) },
    { label: current.isPinned ? 'Unpin note' : 'Pin note', icon: <Pin size={16} />, divider: true, action: () => edit({ isPinned: !current.isPinned }) },
    { label: 'Move to notebook…', icon: <Folder size={16} />, action: showDetails },
    { label: 'Export Markdown', icon: <Download size={16} />, divider: true, action: () => void perform(() => api.export(current.id, 'markdown'), 'Markdown exported.') },
    { label: 'Export Chirpberry JSON', icon: <FileText size={16} />, action: () => void perform(() => api.export(current.id, 'json'), 'Chirpberry document exported.') },
    { label: 'Copy as Markdown', icon: <Copy size={16} />, action: () => void perform(() => api.copy(current.id), 'Copied notes and transcript.') },
    { label: current.isTrashed ? 'Restore note' : 'Move note to trash', icon: current.isTrashed ? <Undo2 size={16} /> : <Trash2 size={16} />, divider: true,
      disabled: capture.meetingId === current.id, danger: !current.isTrashed, action: () => {
        edit({ isTrashed: !current.isTrashed }); setMessage(current.isTrashed ? 'Note restored.' : 'Note moved to Trash. You can restore it at any time.');
      } }
  ] : [];
  const libraryActions: MenuAction[] = [
    { label: 'New scratchpad', icon: <StickyNote size={16} />, disabled: !loaded, action: () => void create('scratchpad') },
    { label: 'Import notes…', icon: <Import size={16} />, divider: true, action: () => void importDocument() },
    { label: 'Transcribe audio file', icon: <Upload size={16} />, disabled: busy, action: () => void cloud(async () => receive(await api.importAudio())) }
  ];

  return <div className={`app-shell ${sidebar ? '' : 'sidebar-hidden'}`}>
    <aside className="sidebar" aria-label="Notebook navigation" hidden={!sidebar}>
      <div className="brand"><img src="./chirpberry.png" alt="" /><span>Chirpberry</span></div>
      <button className={`upcoming-nav ${upcoming ? 'selected' : ''}`} aria-pressed={upcoming} onClick={() => { setUpcoming(true); setContextMenu(undefined); }}><CalendarDays size={15} />Upcoming</button>
      <label className="search"><Search size={15} /><input ref={search} aria-label="Search notes" placeholder="Search notes" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      <div className="list-heading">
        <div className="collection-select"><select aria-label="Filter notes" value={filter.kind === 'notebook' ? `notebook:${filter.name}` : filter.kind} onChange={event => {
          const value = event.target.value;
          chooseFilter(value.startsWith('notebook:') ? { kind: 'notebook', name: value.slice(9) } : { kind: value as 'all' | 'pinned' | 'trash' });
        }}><option value="all">All notes</option><option value="pinned">Pinned</option>
          {notebooks.length > 0 && <optgroup label="Notebooks">{notebooks.map(name => <option key={name} value={`notebook:${name}`}>{name || 'Untitled notebook'}</option>)}</optgroup>}
          <option value="trash">Trash</option></select><ChevronDown size={13} aria-hidden="true" /></div>
        <button className="icon-button" aria-label="New note" title="New note" onClick={() => void create()} disabled={!loaded}><Plus size={18} /></button>
      </div>
      <div className="meeting-list" aria-label="Notes">
        {query && <p className="search-count" role="status">{visible.length} {visible.length === 1 ? 'result' : 'results'}</p>}
        {visible.map(meeting => <button key={meeting.id} aria-pressed={!upcoming && meeting.id === selectedID} className={`meeting-row ${!upcoming && meeting.id === selectedID ? 'selected' : ''}`}
          onClick={() => { select(meeting.id); setTab('notes'); setContextMenu(undefined); setUpcoming(false); }} onContextMenu={event => {
            event.preventDefault(); select(meeting.id); setTab('notes'); setUpcoming(false); setContextMenu({ x: event.clientX, y: event.clientY, target: event.currentTarget });
          }}>
          <span className="meeting-title">{meeting.isPinned && <Pin size={12} />}<span className="truncate">{meeting.title || 'Untitled note'}</span></span>
          <span className="meeting-preview truncate">{meeting.notes.trim().split('\n').find(Boolean) || (meeting.segments.length ? `${meeting.segments.length} transcript segment${meeting.segments.length === 1 ? '' : 's'}` : 'No notes yet')}</span>
          <span className="meeting-date">{new Date(meeting.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </button>)}
        {loaded && !visible.length && <p className="list-empty">{query ? 'No matching notes.' : filter.kind === 'trash' ? 'Trash is empty.' : filter.kind === 'pinned' ? 'Pin a note from its menu to find it here.' : 'Your notes will appear here.'}</p>}
      </div>
      <div className="sidebar-footer">
        <ActionMenu label="Library options" className="text-button library-button" items={libraryActions}><BookOpen size={16} /><span>Library</span><ChevronDown size={12} /></ActionMenu>
        <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}><Settings size={17} /></button>
      </div>
    </aside>
    <main className="workspace">
      <header className={`toolbar ${capturing ? 'is-recording' : ''}`}>
        <button className="icon-button sidebar-toggle" aria-label={sidebar ? 'Hide sidebar' : 'Show sidebar'} title={sidebar ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setSidebar(value => !value)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
        {capturing && <div className="recording-controls" aria-label="Recording controls">
          <span className={`recording-indicator ${capture.state}`} /><span className="recording-state" role="status">{capture.state === 'connecting' ? 'Connecting to Valsea…' : capture.state === 'finishing' ? 'Saving final speech…' : capture.state === 'paused' ? 'Paused' : capture.purpose === 'dictation' ? 'Dictating to clipboard' : 'Recording meeting'}<time>{timeLabel(capture.elapsed)}</time></span>
          {(capture.meetingId !== current?.id || upcoming) && <button className="text-button recording-link" onClick={() => { select(capture.meetingId); setUpcoming(false); setFilter({ kind: 'all' }); setQuery(''); setTab('notes'); }}>Go to recording</button>}
          <div className="capture-actions">{capture.state === 'paused' ? <button className="secondary" onClick={() => void perform(() => api.resumeCapture())}><Play size={14} />Resume</button> : capture.state === 'recording' && <button className="secondary" onClick={() => void perform(() => api.pauseCapture())}><Pause size={14} />Pause</button>}
            <button className="primary" disabled={capture.state === 'finishing'} onClick={() => void perform(() => api.stopCapture())}><Square size={12} />{capture.state === 'connecting' ? 'Cancel' : 'Stop'}</button></div>
        </div>}
        <div className="toolbar-actions">
          {!sidebar && <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}><Settings size={17} /></button>}
          {current && !upcoming && <>
            <button className={`text-button assistant-toggle ${assistantOpen ? 'active' : ''}`} aria-label={assistantOpen ? 'Hide meeting assistant' : 'Ask meeting'} aria-pressed={assistantOpen} onClick={() => { setAssistantOpen(value => !value); setInspector(false); }}><MessageCircle size={16} /><span>Ask</span></button>
            <button className={`text-button transcript-toggle ${inspector ? 'active' : ''}`} aria-label={inspector ? 'Hide transcript' : 'Show transcript'} aria-pressed={inspector} onClick={() => { setInspector(value => !value); setAssistantOpen(false); }}><Languages size={16} /><span>Transcript</span>{current.segments.length > 0 && <span className="transcript-count">{current.segments.length}</span>}</button>
            {!current.isTrashed && <button className="icon-button" title="Share notes" aria-label="Share notes" onClick={() => setSharing(true)}><Share2 size={17} /></button>}
            <ActionMenu key={current.id} label="Note actions" items={noteActions} point={contextMenu} onOpen={() => setContextMenu(undefined)}><MoreHorizontal size={20} /></ActionMenu>
            {!capturing && !current.isTrashed && <button className="primary record-button" disabled={busy} onClick={() => void cloud(() => api.startCapture(current.id, 'meeting'))}><Mic size={15} />Record meeting</button>}
          </>}
        </div>
      </header>
      {message && <div className="notice" role={save.state === 'error' ? 'alert' : 'status'}><span>{message}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={17} /></button></div>}
      <MeetingSuggestion runtime={runtime} capturing={capturing} onSettings={() => setSettings(true)} onError={setMessage} />
      {upcoming ? <Upcoming runtime={runtime} onOpen={receive} onSkip={() => setUpcoming(false)} /> : current ? <>
        <div className={`document-layout ${inspector || assistantOpen ? '' : 'without-transcript'}`}>
          <section className="document" aria-label="Meeting editor">
            {current.isTrashed && <div className="trash-notice"><Trash2 size={16} /><span>This note is in Trash.</span><button onClick={() => edit({ isTrashed: false })}>Restore</button></div>}
            <div className="document-heading"><div className="date-line">{current.entryKind === 'scratchpad' ? 'Scratchpad' : 'Meeting'}<span>·</span>{new Date(current.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}<span className={`save-status ${save.state}`} role="status" title={save.state === 'saved' ? 'Saved on this device' : undefined}>{save.state === 'saved' ? <><Check size={12} />Saved</> : save.state === 'saving' ? 'Saving…' : 'Not saved'}</span></div>
              <h1 aria-label={current.title || 'Untitled meeting'}><input className="title-input" aria-label="Note title" value={current.title} maxLength={300} onChange={event => edit({ title: event.target.value })} placeholder="Untitled meeting" /></h1>
              <details ref={details} className="meeting-details"><summary>Details<ChevronDown size={13} /></summary><div className="details-fields">
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
              {tab === 'summary' && <div className="summary-tools"><p className="summary-hint">{current.notes.trim() || current.segments.length ? 'Summarize with Valsea. Your original notes stay separate.' : 'Add notes or record a meeting to create a summary.'}</p><button className="secondary" disabled={busy || current.isTrashed || capture.meetingId === current.id || (!current.notes.trim() && !current.segments.length)} onClick={() => void cloud(() => api.summarize(current.id))}><Sparkles size={14} />{busy ? 'Working…' : 'Generate summary'}</button></div>}
              <textarea ref={editor} key={`${current.id}-${tab}`} className="note-editor" aria-label={tab === 'notes' ? 'My notes' : 'Summary'} readOnly={tab === 'notes' && capture.meetingId === current.id && capture.purpose === 'dictation'} value={tab === 'notes' ? current.notes : current.enhancedNotes} maxLength={8 * 1024 * 1024} placeholder={tab === 'notes' ? 'What’s worth remembering?' : 'Write or paste a summary…'} spellCheck onChange={event => edit(tab === 'notes' ? { notes: event.target.value } : { enhancedNotes: event.target.value })} />
            </div>
            {current.actions.length > 0 && <section className="actions" aria-label="Action items"><h2>Action items</h2>{current.actions.map(action => <label className="action" key={action.id}><input type="checkbox" checked={action.completed} onChange={event => edit({ actions: current.actions.map(item => item.id === action.id ? { ...item, completed: event.target.checked } : item) })} /><span>{action.description}{(action.owner || action.deadline) && <small>{[action.owner, action.deadline].filter(Boolean).join(' · ')}</small>}</span></label>)}</section>}
          </section>
          {assistantOpen && <AssistantPanel key={current.id} meetingId={current.id} runtime={runtime} onSettings={() => setSettings(true)} onClose={() => setAssistantOpen(false)} />}
          {inspector && <aside className="transcript" aria-label="Transcript"><header><h2>Transcript</h2><button className="icon-button" aria-label="Close transcript" onClick={() => setInspector(false)}><X size={16} /></button></header>
            {current.segments.length ? <div className="transcript-segments">{current.segments.map(segment => <article className="segment" key={segment.id}>
              <div className="segment-meta"><span>{segment.channel}</span><time>{timeLabel(segment.timestamp)}</time></div>
              {segment.utterances.length ? segment.utterances.map((utterance, index) => <div key={index} className="utterance"><input className="speaker-name" aria-label={`Speaker name at ${timeLabel(segment.timestamp)}, utterance ${index + 1}`} value={speakerName(current, segment, utterance.speaker)} onChange={event => edit({ speakerNames: { ...current.speakerNames, [speakerKey(segment.channel, utterance.speaker, segment.speakerScope)]: event.target.value } })} /><p>{utterance.transcript}</p></div>) : <p>{segment.original}</p>}
              {segment.translation !== undefined && <div className="translation"><span>{segment.targetLanguage || current.targetLanguage} · translation</span><p>{segment.translation}</p></div>}
            </article>)}</div> : capture.meetingId === current.id && Object.values(capture.partials).some(Boolean) ? null : <div className="transcript-empty"><Languages size={26} strokeWidth={1.3} /><h3>{capture.meetingId === current.id ? 'Listening for speech…' : 'The conversation goes here.'}</h3><p>Source speech and translations appear together when you record.</p></div>}
            {capture.meetingId === current.id && Object.entries(capture.partials).map(([channel, text]) => <div className="partial-transcript" key={channel}><span>{channel} · live draft</span><p>{text}</p></div>)}
          </aside>}
        </div>
      </> : <div className="empty-workspace"><img src="./chirpberry.png" alt="" /><h1>{!loaded ? 'Opening your notebook…' : filter.kind === 'trash' ? 'A second chance for your notes.' : activeCount ? 'Room for your next thought.' : 'Start with what matters.'}</h1>
        <p>{filter.kind === 'trash' ? 'Select a note to read or restore it.' : activeCount ? 'Choose a note from the sidebar, or begin a new one.' : 'A quiet place for your notes and multilingual conversations.'}</p>
        {loaded && filter.kind !== 'trash' && <div className="empty-actions"><button className="primary" onClick={() => void create()}><Plus size={17} />New note</button><button className="text-button" onClick={() => void importDocument()}><Import size={16} />Import your notes</button></div>}
        {loaded && !activeCount && <p className="preview-note">Your notes, on this device.<br />Connect your Valsea account in Settings for speech and summaries.</p>}
      </div>}
    </main>
    <dialog className="settings-dialog" ref={dialog} aria-labelledby="settings-title" onClose={() => setSettings(false)}><div className="dialog-header"><h2 id="settings-title">Chirpberry Settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettings(false)}><X size={20} /></button></div>
      {settings && runtime ? <SettingsPanel runtime={{ ...runtime, capture }} onChange={setRuntime} onCreated={meeting => { receive(meeting); setSettings(false); }} onUpcoming={() => { setSettings(false); setUpcoming(true); }} /> : <p>Loading settings…</p>}
    </dialog>
    {sharing && current && <ShareDialog key={current.id} meetingId={current.id} onClose={() => setSharing(false)} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
