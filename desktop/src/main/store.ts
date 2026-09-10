import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { decodeMeeting, meetingSchema, newMeeting, patchSchema, timestamp, uuid, type Meeting, type MeetingPatch, type Segment } from '../shared/meeting';
import type { SaveStatus } from '../shared/api';

export async function atomicWrite(destination: string, contents: string) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(contents, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
}

export class MeetingStore {
  private meetings = new Map<string, Meeting>();
  private dirty = new Set<string>();
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;
  private unreadable: string[] = [];
  constructor(readonly directory: string, private status: (status: SaveStatus) => void = () => {},
    private write: typeof atomicWrite = atomicWrite) {}

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue;
      try {
        if (!entry.isFile()) throw new Error('Not a regular file');
        const filename = path.join(this.directory, entry.name);
        if ((await stat(filename)).size > 32 * 1024 * 1024) throw new Error('File too large');
        const meeting = decodeMeeting(await readFile(filename, 'utf8'));
        if (entry.name !== `${meeting.id}.json`) throw new Error('Meeting ID mismatch');
        this.meetings.set(meeting.id, meeting);
      } catch { this.unreadable.push(entry.name); }
    }
    return this.snapshot();
  }
  snapshot() {
    return { meetings: [...this.meetings.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), unreadable: [...this.unreadable] };
  }
  get(id: string) {
    const meeting = this.meetings.get(uuid.parse(id));
    if (!meeting) throw new Error('This meeting is no longer available.');
    return meeting;
  }
  private async insert(meeting: Meeting) {
    await this.write(path.join(this.directory, `${meeting.id}.json`), JSON.stringify(meeting, null, 2));
    this.meetings.set(meeting.id, meeting);
    return meeting;
  }
  async create(kind: 'meeting' | 'scratchpad') { return this.insert(newMeeting(randomUUID(), kind)); }
  async importJSON(contents: string) {
    const source = decodeMeeting(contents);
    return this.insert({ ...source, id: randomUUID().toUpperCase(), updatedAt: timestamp(), isTrashed: false });
  }
  async importText(contents: string, title: string) {
    if (Buffer.byteLength(contents) > 8 * 1024 * 1024) throw new Error('Text files must be smaller than 8 MB.');
    return this.insert({ ...newMeeting(randomUUID()), title, notes: contents });
  }
  update(id: string, changes: MeetingPatch) {
    this.apply(id, patchSchema.parse(changes));
  }
  appendFinal(id: string, segment: Segment, dictation: boolean) {
    const current = this.get(id);
    if (current.isTrashed) throw new Error('Restore the note before recording into it.');
    this.apply(id, { segments: [...current.segments, segment],
      ...(dictation && segment.original.trim() ? { notes: [current.notes, segment.original.trim()].filter(Boolean).join('\n') } : {}) });
  }
  setDuration(id: string, duration: number) { this.apply(id, { duration }); }
  private apply(id: string, patch: Partial<Meeting>) {
    const current = this.get(id);
    const updated = meetingSchema.parse({ ...current, ...patch, updatedAt: timestamp() });
    if (Buffer.byteLength(JSON.stringify(updated)) > 32 * 1024 * 1024) throw new Error('This meeting has reached the 32 MB document limit.');
    this.meetings.set(current.id, updated);
    this.dirty.add(current.id);
    this.status({ state: 'saving' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 250);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flushing) return this.flushing;
    this.flushing = this.persist().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  private async persist() {
    try {
      while (this.dirty.size) {
        const id = this.dirty.values().next().value!;
        const meeting = this.get(id);
        this.dirty.delete(id);
        try { await this.write(path.join(this.directory, `${id}.json`), JSON.stringify(meeting, null, 2)); }
        catch (error) { this.dirty.add(id); throw error; }
      }
      this.status({ state: 'saved' });
    } catch {
      const message = 'Your latest edits could not be saved. Keep Chirpberry open and export a copy, or try editing again after checking your disk.';
      this.status({ state: 'error', message });
      throw new Error(message);
    }
  }
}
