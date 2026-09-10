import type { Meeting, MeetingPatch } from './meeting';
import type { AppSettings, Capabilities, CaptureSnapshot } from './capture';

export type SaveStatus = { state: 'saved' | 'saving' | 'error'; message?: string };
export type NotebookSnapshot = { meetings: Meeting[]; unreadable: string[]; platform: string };
export type RuntimeSnapshot = { settings: AppSettings; capabilities: Capabilities; keySaved: boolean; capture: CaptureSnapshot };
export type CalendarEvent = { id: string; title: string; start: string; end: string; location: string };
export interface NotebookAPI {
  load(): Promise<NotebookSnapshot>;
  create(kind: 'meeting' | 'scratchpad'): Promise<Meeting>;
  update(id: string, patch: MeetingPatch): Promise<void>;
  import(): Promise<Meeting | null>;
  export(id: string, format: 'json' | 'markdown'): Promise<boolean>;
  copy(id: string): Promise<void>;
  showStorage(): Promise<void>;
  runtime(): Promise<RuntimeSnapshot>;
  saveSettings(settings: AppSettings): Promise<RuntimeSnapshot>;
  saveKey(key: string): Promise<boolean>;
  requestAccessibility(): Promise<RuntimeSnapshot>;
  startCapture(meetingId: string, purpose: 'meeting' | 'dictation'): Promise<void>;
  stopCapture(): Promise<void>;
  pauseCapture(): Promise<void>;
  resumeCapture(): Promise<void>;
  companion(action: 'dictation' | 'meeting' | 'scratchpad' | 'notebook' | 'hover' | 'leave'): Promise<void>;
  summarize(id: string): Promise<void>;
  importAudio(): Promise<Meeting | null>;
  calendar(): Promise<CalendarEvent[]>;
  prepareEvent(event: CalendarEvent): Promise<Meeting>;
  onCapture(callback: (snapshot: CaptureSnapshot) => void): () => void;
  onMeeting(callback: (meeting: Meeting, fields: (keyof Meeting)[]) => void): () => void;
  onRuntime(callback: (snapshot: RuntimeSnapshot) => void): () => void;
  onSelect(callback: (id: string) => void): () => void;
  onSaveStatus(callback: (status: SaveStatus) => void): () => void;
  onCommand(callback: (command: 'new' | 'import' | 'search') => void): () => void;
}
declare global { interface Window { chirpberry: NotebookAPI } }
