import { app, BrowserWindow, clipboard, dialog, globalShortcut, Notification, shell } from 'electron';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CalendarEvent, RuntimeSnapshot } from '../shared/api';
import type { Capabilities } from '../shared/capture';
import { newMeeting, uuid, type Meeting } from '../shared/meeting';
import { atomicWrite, MeetingStore } from './store';
import { Credentials, SettingsStore } from './settings';
import { MacAudioInput, NativeBridge } from './native';
import { BrowserAudioInput } from './browser-audio';
import { RecordingController, type AudioInput } from './recording';
import { RealtimeSession, type RealtimeOptions, type SpeechStream } from './realtime';
import { ValseaREST } from './rest';
import { Companion } from './companion';
import { CalendarTracker } from './calendar';
import { meetingURL } from '../shared/calendar';
import { MeetingAssistant, OpenAIMeetingService, type AssistantService } from './assistant-service';
import { shareContent, shareOptionsSchema, type SharePreview } from '../shared/share';

type Handler = (name: string, callback: (...args: any[]) => unknown) => void;
export type RuntimeAdapters = { native?: NativeBridge; credentials: Pick<Credentials, 'available' | 'read' | 'save' | 'status'>;
  createAudio(): AudioInput; createStream(options: RealtimeOptions): SpeechStream;
  service(key: string): Pick<ValseaREST, 'format' | 'transcribe'>;
  calendar?(requestPermission: boolean): Promise<unknown>;
  assistantCredentials?: Pick<Credentials, 'available' | 'read' | 'save' | 'status'>;
  assistant?(key: string): AssistantService };
export class DesktopRuntime {
  readonly companion = new Companion(() => this.closeCapture());
  readonly recording: RecordingController;
  readonly settings: SettingsStore;
  readonly calendarTracker: CalendarTracker;
  readonly assistant: MeetingAssistant;
  private native?: NativeBridge;
  private credentials: Pick<Credentials, 'available' | 'read' | 'save' | 'status'>;
  private capabilities: Capabilities;
  private keySaved = false;
  private assistantKeySaved = false;
  private assistantCredentials: Pick<Credentials, 'available' | 'read' | 'save' | 'status'>;
  private stopped = false;
  private shortcutBusy = false;
  private requests = new Set<AbortController>();
  private summaries = new Set<string>();
  private preparing = new Map<string, Promise<Meeting>>();
  private sharePreview?: SharePreview;
  private nativePath = app.isPackaged ? path.join(process.resourcesPath, 'Chirpberry Capture.app/Contents/MacOS/chirpberry-capture') : path.resolve(__dirname, '../native-build/Chirpberry Capture.app/Contents/MacOS/chirpberry-capture');
  constructor(private store: MeetingStore, profile: string, private notebook: () => BrowserWindow | undefined, private adapters?: RuntimeAdapters) {
    const disabled = process.env.CHIRPBERRY_DISABLE_OS_INTEGRATIONS === '1';
    if (adapters) this.native = adapters.native;
    else if (process.platform === 'darwin' && !disabled) this.native = new NativeBridge(this.nativePath, [], 1500, true);
    this.settings = new SettingsStore(profile);
    this.credentials = adapters?.credentials ?? new Credentials(profile, this.native, disabled);
    this.assistantCredentials = adapters?.assistantCredentials ?? new Credentials(profile, this.native, disabled, 'assistant');
    this.capabilities = { platform: process.platform, microphone: !disabled, systemAudio: !disabled && ['darwin', 'win32'].includes(process.platform),
      fn: false, calendar: !!this.native, protectedCredentials: false, ...(disabled ? { problem: 'OS integrations are disabled for this diagnostic session.' } : {}) };
    if (adapters) this.capabilities = { platform: process.platform, microphone: true, systemAudio: true, fn: false, calendar: !!adapters.calendar, protectedCredentials: true, problem: 'Synthetic test session. No real audio or provider connection.' };
    this.recording = new RecordingController({ store, getKey: () => this.credentials.read(),
      createAudio: () => adapters ? adapters.createAudio() : this.native ? new MacAudioInput(this.nativePath) : new BrowserAudioInput(), createStream: options => adapters ? adapters.createStream(options) : new RealtimeSession(options),
      copy: text => clipboard.writeText(text), changed: snapshot => { this.companion.capture(snapshot); this.broadcast('runtime:capture', snapshot); },
      meetingChanged: (meeting, fields) => this.broadcast('runtime:meeting', meeting, fields) });
    this.calendarTracker = new CalendarTracker({ load: requestPermission => {
      if (adapters?.calendar) return adapters.calendar(requestPermission);
      if (!this.native || !this.capabilities.calendar) throw new Error('Connect a calendar through macOS Calendar to use Upcoming on this Mac.');
      return this.native.request('calendar.upcoming', { requestPermission }, 120000);
    }, changed: snapshot => this.sendToNotebook('calendar:changed', snapshot), remind: event => {
      if (!this.settings.get().calendarReminders || adapters || !Notification.isSupported()) return;
      const notification = new Notification({ title: 'Meeting coming up', body: event.title.slice(0, 200), silent: true });
      notification.on('click', () => { this.notebook()?.show(); this.notebook()?.focus(); }); notification.show();
    } });
    this.assistant = new MeetingAssistant({ meeting: id => this.store.get(id), configuration: () => ({
      accepted: this.settings.get().assistantDisclosureAccepted, model: this.settings.get().assistantModel }),
      service: async () => { const key = await this.assistantCredentials.read(); return adapters?.assistant?.(key) ?? new OpenAIMeetingService(key); },
      changed: answer => this.sendToNotebook('assistant:changed', answer) });
  }
  async initialize() {
    await this.settings.load();
    if (this.native) {
      try { await access(this.native.executable); await this.native.request('ping', {}, 10000); }
      catch { this.capabilities.microphone = false; this.capabilities.systemAudio = false; this.capabilities.calendar = false;
        this.capabilities.problem = 'The Mac capture helper is unavailable. Rebuild or reinstall Chirpberry for macOS 26.'; }
      this.native.on('shortcut', event => { if (event.action === 1) void this.shortcut('dictation'); if (event.action === 2) void this.shortcut('meeting'); if (event.action === 3) void this.shortcut('scratchpad'); });
      this.native.on('failure', () => {
        this.capabilities.fn = false;
        this.capabilities.shortcut = this.settings.get().shortcutsEnabled ? 'Mac shortcuts disconnected — retry an action or save Settings to reconnect' : undefined;
        this.broadcast('runtime:changed', this.snapshot());
      });
      this.native.on('restarted', event => { if (!this.stopped && event.command !== 'shortcuts.configure') void this.configureShortcuts(); });
    }
    this.capabilities.protectedCredentials = this.credentials.available();
    try { this.keySaved = this.capabilities.protectedCredentials && await this.credentials.status(); }
    catch { this.capabilities.problem = 'The saved Valsea key could not be unlocked. Check Settings.'; }
    try { this.assistantKeySaved = this.assistantCredentials.available() && await this.assistantCredentials.status(); } catch { this.assistantKeySaved = false; }
  }
  snapshot(): RuntimeSnapshot { return { settings: this.settings.get(), capabilities: { ...this.capabilities }, keySaved: this.keySaved, assistantKeySaved: this.assistantKeySaved, capture: this.recording.snapshot() }; }
  private sendToNotebook(channel: string, value: unknown) {
    const window = this.notebook();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value);
  }
  private broadcast(channel: string, ...args: unknown[]) {
    for (const window of [this.notebook(), this.companion.window]) if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, ...args);
  }
  private async configureShortcuts() {
    if (this.stopped) return;
    const settings = this.settings.get();
    if (this.native) {
      try {
        const result = await this.native.request<{ fn: boolean; failures: string[] }>('shortcuts.configure', { enabled: settings.shortcutsEnabled });
        this.capabilities.fn = result.fn;
        this.capabilities.shortcut = settings.shortcutsEnabled ? result.fn ? 'Fn / Globe · ⌃⌥D fallback' : result.failures.includes('⌃⌥D') ? 'Shortcut unavailable — another app may be using it' : '⌃⌥D · Fn needs Accessibility access' : undefined;
      } catch { this.capabilities.fn = false; this.capabilities.shortcut = 'Mac shortcuts unavailable'; }
    } else {
      globalShortcut.unregisterAll();
      if (settings.shortcutsEnabled && this.capabilities.microphone) {
        const dictation = globalShortcut.register('Control+Alt+D', () => void this.shortcut('dictation'));
        globalShortcut.register('Control+Alt+M', () => void this.shortcut('meeting')); globalShortcut.register('Control+Alt+S', () => void this.shortcut('scratchpad'));
        this.capabilities.shortcut = dictation ? 'Ctrl+Alt+D' : 'Shortcut unavailable — another app may be using it';
      } else this.capabilities.shortcut = undefined;
    }
    this.broadcast('runtime:changed', this.snapshot());
  }
  async configure() {
    await this.configureShortcuts();
    const settings = this.settings.get();
    await this.companion.configure(settings);
    this.companion.capture(this.recording.snapshot()); this.broadcast('runtime:changed', this.snapshot());
    const wasConnected = this.calendarTracker.snapshot().connected;
    this.calendarTracker.activate(settings.calendarEnabled);
    if (settings.calendarEnabled && !wasConnected) void this.calendarTracker.refresh();
  }
  private assertDisclosure() { if (!this.settings.get().disclosureAccepted) throw new Error('Review and accept the cloud processing disclosure in Settings first.'); }
  private async start(id: string, purpose: 'meeting' | 'dictation') {
    this.assertDisclosure();
    if (this.stopped || !this.capabilities.microphone) throw new Error(this.capabilities.problem ?? 'Audio capture is unavailable.');
    const settings = this.settings.get(), meeting = this.store.get(uuid.parse(id));
    if (settings.includeSystemAudio && !this.capabilities.systemAudio && purpose === 'meeting') throw new Error('Turn off system audio in Settings to use microphone capture on this platform.');
    await this.recording.start({ meetingId: meeting.id, purpose, includeSystemAudio: settings.includeSystemAudio, language: settings.language,
      ...(settings.translate && purpose === 'meeting' ? { targetLanguage: settings.targetLanguage } : {}), diarize: settings.diarize,
      hints: settings.hints.split(/[ ,]+/).map(value => value.trim().toLowerCase()).filter(Boolean), vocabulary: meeting.vocabulary || settings.vocabulary, disclosureAccepted: true });
  }
  private select(meeting: Meeting, show = false) {
    this.broadcast('runtime:meeting', meeting, []); this.broadcast('runtime:select', meeting.id);
    if (show) { this.notebook()?.show(); this.notebook()?.focus(); }
  }
  private async scratchpad() {
    return this.store.snapshot().meetings.find(meeting => meeting.entryKind === 'scratchpad' && !meeting.isTrashed) ?? await this.store.create('scratchpad');
  }
  async action(value: unknown) {
    const action = z.enum(['dictation', 'meeting', 'scratchpad', 'notebook', 'hover', 'leave']).parse(value);
    if (action === 'hover') { this.companion.hover(); return; }
    if (action === 'leave') { this.companion.leave(); return; }
    if (action === 'notebook') { this.notebook()?.show(); this.notebook()?.focus(); return; }
    if (action === 'scratchpad') { this.select(await this.scratchpad(), true); return; }
    if (this.recording.active) { await this.recording.stop(); return; }
    this.assertDisclosure();
    const meeting = action === 'dictation' ? await this.scratchpad() : await this.store.create('meeting');
    this.select(meeting, action === 'meeting'); await this.start(meeting.id, action);
  }
  private async shortcut(action: 'dictation' | 'meeting' | 'scratchpad') {
    if (this.stopped) return;
    if (action !== 'scratchpad' && this.recording.active) { await this.recording.stop(); return; }
    if (this.shortcutBusy) return;
    this.shortcutBusy = true;
    try { await this.action(action); }
    catch (error) { this.notebook()?.show(); this.broadcast('runtime:capture', { ...this.recording.snapshot(), message: error instanceof Error ? error.message : 'Open Settings to finish setup.' }); }
    finally { this.shortcutBusy = false; }
  }
  register(handle: Handler) {
    handle('runtime:load', () => this.snapshot());
    handle('runtime:settings', async input => {
      await this.settings.save(input);
      if (!this.settings.get().disclosureAccepted) await this.recording.stop({ deliver: false });
      if (!this.settings.get().assistantDisclosureAccepted) this.assistant.cancel();
      await this.configure(); return this.snapshot();
    });
    handle('runtime:key', async key => { this.keySaved = await this.credentials.save(key); this.broadcast('runtime:changed', this.snapshot()); return this.keySaved; });
    handle('assistant:key', async key => { this.assistant.cancel(); this.assistantKeySaved = await this.assistantCredentials.save(key); this.broadcast('runtime:changed', this.snapshot()); return this.assistantKeySaved; });
    handle('assistant:ask', input => this.assistant.ask(input));
    handle('assistant:thread', id => { this.store.get(uuid.parse(id)); return this.assistant.thread(uuid.parse(id)); });
    handle('assistant:stop', id => this.assistant.cancel(uuid.parse(id)));
    handle('assistant:clear', id => this.assistant.clear(uuid.parse(id)));
    handle('assistant:copy', async (id, requestId, draft) => {
      const identifier = uuid.parse(id); if (this.store.get(identifier).isTrashed) throw new Error('Restore the note first.');
      const answer = this.assistant.thread(identifier).find(answer => answer.requestId === uuid.parse(requestId));
      if (!answer || answer.state !== 'complete') throw new Error('Only a completed answer can be copied.');
      const text = draft === undefined ? answer.text : z.string().trim().min(1).max(16000).parse(draft);
      await clipboard.writeText(text);
    });
    handle('share:preview', (id, options) => {
      const meeting = this.store.get(uuid.parse(id)); if (meeting.isTrashed) throw new Error('Restore this note before sharing.');
      const content = shareContent(meeting, shareOptionsSchema.parse(options));
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('This share is too large to preview. Select fewer sections, or use Export from Note actions.');
      this.sharePreview = { token: randomUUID().toUpperCase(), meetingId: meeting.id, title: meeting.title, content, createdAt: new Date().toISOString() };
      return this.sharePreview;
    });
    handle('share:deliver', async (token, method) => {
      const preview = this.sharePreview;
      if (!preview || preview.token !== uuid.parse(token) || !preview.content || Date.now() - Date.parse(preview.createdAt) > 600000) throw new Error('Refresh the share preview before sending it.');
      if (this.store.get(preview.meetingId).isTrashed) throw new Error('Restore this note before sharing.');
      if (z.enum(['copy', 'export']).parse(method) === 'copy') { await clipboard.writeText(preview.content); return true; }
      const title = preview.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100).replace(/[. ]+$/, '') || 'Meeting';
      const choice = await dialog.showSaveDialog(this.notebook()!, { title: 'Export reviewed notes', defaultPath: `${title}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (choice.canceled || !choice.filePath) return false;
      await atomicWrite(choice.filePath, preview.content); return true;
    });
    handle('runtime:accessibility', async () => { if (this.native) await this.native.request('accessibility.request'); await this.configure(); return this.snapshot(); });
    handle('runtime:start', (id, purpose) => this.start(uuid.parse(id), z.enum(['meeting', 'dictation']).parse(purpose)));
    handle('runtime:stop', () => this.recording.stop()); handle('runtime:pause', () => this.recording.stop({ pause: true })); handle('runtime:resume', () => this.recording.resume());
    handle('runtime:summarize', id => this.summarize(uuid.parse(id)));
    handle('runtime:import-audio', () => this.importAudio());
    handle('runtime:calendar', async () => (await this.connectCalendar()).events);
    handle('calendar:load', () => this.calendarTracker.snapshot());
    handle('calendar:connect', () => this.connectCalendar());
    handle('calendar:refresh', () => this.calendarTracker.refresh());
    handle('calendar:disconnect', async () => { this.calendarTracker.activate(false); await this.settings.save({ ...this.settings.get(), calendarEnabled: false }); this.broadcast('runtime:changed', this.snapshot()); });
    handle('calendar:join', async id => {
      const event = this.calendarTracker.event(z.string().max(4096).parse(id)), url = meetingURL(event?.joinURL);
      if (!url) throw new Error('This event has no available meeting link. Refresh Upcoming.');
      await shell.openExternal(url);
    });
    handle('runtime:prepare-event', input => this.prepareEvent(z.object({ id: z.string().max(4096) }).parse(input).id));
  }
  private async connectCalendar() {
    const snapshot = await this.calendarTracker.refresh(true);
    if (snapshot.connected && !snapshot.error) { await this.settings.save({ ...this.settings.get(), calendarEnabled: true }); this.broadcast('runtime:changed', this.snapshot()); }
    return snapshot;
  }
  private prepareEvent(id: string): Promise<Meeting> {
    const event = this.calendarTracker.event(id); if (!event) throw new Error('Refresh the calendar and select an upcoming event.');
    if (this.preparing.has(id)) return this.preparing.get(id)!;
    const existing = this.store.snapshot().meetings.find(meeting => meeting.calendarID === id && !meeting.isTrashed);
    if (existing) return Promise.resolve(existing);
    const meeting = { ...newMeeting(randomUUID()), title: event.title, calendarID: event.id,
      notes: `Scheduled: ${new Date(event.start).toLocaleString()}${event.location ? `\nLocation: ${event.location}` : ''}\n\n` };
    const pending = this.store.importJSON(JSON.stringify(meeting)).finally(() => this.preparing.delete(id)); this.preparing.set(id, pending); return pending;
  }
  private async summarize(id: string) {
    this.assertDisclosure(); if (this.summaries.has(id)) throw new Error('This summary is already being generated.');
    if (this.recording.snapshot().meetingId === id) throw new Error('Finish recording before generating the summary.');
    const meeting = structuredClone(this.store.get(id)); if (meeting.isTrashed) throw new Error('Restore this note first.');
    if (meeting.enhancedNotes || meeting.actions.length) {
      const result = await dialog.showMessageBox(this.notebook()!, { type: 'question', message: 'Replace the current summary and action items?', detail: 'Your original notes and transcript will be preserved.', buttons: ['Keep current', 'Generate new summary'], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return;
    }
    const abort = new AbortController(); this.requests.add(abort); this.summaries.add(id);
    try {
      const key = await this.credentials.read();
      const result = await (this.adapters?.service(key) ?? new ValseaREST(key)).format(meeting, abort.signal);
      const current = this.store.get(id);
      if (abort.signal.aborted) return;
      if (current.isTrashed || current.enhancedNotes !== meeting.enhancedNotes || JSON.stringify(current.actions) !== JSON.stringify(meeting.actions)) throw new Error('The summary changed while Valsea was working. Your edits were preserved; try again when you finish editing.');
      this.store.update(id, { enhancedNotes: result.markdown, actions: result.actions }); await this.store.flush();
      this.broadcast('runtime:meeting', this.store.get(id), ['enhancedNotes', 'actions']);
    } finally { this.requests.delete(abort); this.summaries.delete(id); }
  }
  private async importAudio() {
    this.assertDisclosure(); const key = await this.credentials.read(); if (!key) throw new Error('Add your Valsea API key in Settings.');
    const choice = await dialog.showOpenDialog(this.notebook()!, { title: 'Transcribe audio with Valsea (up to 10 MB)', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const filename = choice.filePaths[0], extension = path.extname(filename).slice(1).toLowerCase();
    const info = await stat(filename); if (!info.isFile() || info.size > 10_000_000) throw new Error('Choose an audio file up to 10 MB.');
    const abort = new AbortController(); this.requests.add(abort);
    try {
      const text = await (this.adapters?.service(key) ?? new ValseaREST(key)).transcribe(await readFile(filename), extension, abort.signal);
      if (abort.signal.aborted) return null;
      const meeting = newMeeting(randomUUID()); meeting.title = path.basename(filename, path.extname(filename));
      meeting.segments = [{ id: randomUUID().toUpperCase(), channel: 'Imported audio', timestamp: 0, original: text, utterances: [] }];
      return await this.store.importJSON(JSON.stringify(meeting));
    } finally { this.requests.delete(abort); }
  }
  protectEdit(id: string, patch: Record<string, unknown>) {
    const capture = this.recording.snapshot();
    if (capture.meetingId === id && (patch.isTrashed === true || capture.purpose === 'dictation' && 'notes' in patch)) throw new Error('Finish recording before changing or moving this note.');
    if (patch.isTrashed === true) this.assistant.clear(id);
  }
  async closeCapture() { this.assistant.cancel(); for (const request of this.requests) request.abort(); await this.recording.stop({ deliver: false }); }
  async shutdown() { this.stopped = true; this.calendarTracker.shutdown(); this.assistant.shutdown(); this.sharePreview = undefined; await this.closeCapture(); globalShortcut.unregisterAll(); this.companion.destroy(); this.native?.removeAllListeners(); await this.native?.destroy(); }
}
