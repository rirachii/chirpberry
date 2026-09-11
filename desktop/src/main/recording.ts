import { randomUUID } from 'node:crypto';
import { captureOptionsSchema, type CaptureOptions, type CaptureSnapshot } from '../shared/capture';
import type { Meeting } from '../shared/meeting';
import { MeetingStore } from './store';
import { TranscriptReducer, type RealtimeOptions, type SpeechStream, type TranscriptEvent } from './realtime';

export interface AudioInput {
  start(systemAudio: boolean, pcm: (channel: string, audio: Buffer, level: number) => void,
    failure: (message: string) => void, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}
type Job = { options: CaptureOptions; phase: string; abort: AbortController; streams: Map<string, SpeechStream>;
  audio?: AudioInput; reducer: TranscriptReducer; finals: Promise<void>; queuedFinals: number; text: string;
  elapsed: number; phaseOffset: number; startedAt?: number; deliveryAllowed: boolean; draining: boolean; pauseAfterStop: boolean; failure?: string; stopping?: Promise<void> };
type Dependencies = { store: MeetingStore; getKey(): Promise<string>; createAudio(): AudioInput;
  createStream(options: RealtimeOptions): SpeechStream; copy(text: string): void | Promise<void>;
  changed(snapshot: CaptureSnapshot): void; meetingChanged?(meeting: Meeting, fields: (keyof Meeting)[]): void };

/** One capture owner for the notebook, companion, shortcuts, and application lifecycle. */
export class RecordingController {
  private job?: Job;
  private timer?: NodeJS.Timeout;
  private value: CaptureSnapshot = { state: 'idle', elapsed: 0, partials: {}, levels: {} };
  constructor(private dependencies: Dependencies) {}
  snapshot(): CaptureSnapshot { return structuredClone(this.value); }
  get active() { return this.value.state !== 'idle'; }

  async start(input: unknown) {
    if (this.job) throw new Error('Finish the current recording before starting another.');
    const parsed = captureOptionsSchema.safeParse(input);
    if (!parsed.success) throw new Error('Review the recording disclosure and choose valid capture settings.');
    const options = parsed.data;
    if (options.purpose === 'dictation') { options.includeSystemAudio = false; options.diarize = false; delete options.targetLanguage; }
    const meeting = this.dependencies.store.get(options.meetingId);
    if (meeting.isTrashed) throw new Error('Restore this note before recording.');
    const job: Job = { options, phase: '', abort: new AbortController(), streams: new Map(), reducer: new TranscriptReducer(),
      finals: Promise.resolve(), queuedFinals: 0, text: '', elapsed: meeting.duration, phaseOffset: meeting.duration, deliveryAllowed: true, draining: false, pauseAfterStop: false };
    this.job = job;
    await this.run(job);
  }
  async resume() {
    if (!this.job || this.value.state !== 'paused') throw new Error('There is no paused recording to resume.');
    await this.run(this.job);
  }
  private async run(job: Job) {
    job.phase = randomUUID(); const phase = job.phase;
    job.abort = new AbortController(); job.reducer = new TranscriptReducer(); job.stopping = undefined; job.draining = false;
    job.streams = new Map(); job.phaseOffset = job.elapsed;
    this.value = { state: 'connecting', meetingId: job.options.meetingId, purpose: job.options.purpose, elapsed: job.elapsed, partials: {}, levels: {} };
    this.publish();
    const current = () => this.job === job && job.phase === phase && !job.abort.signal.aborted && this.value.state === 'connecting';
    try {
      await this.dependencies.store.flush();
      if (!current()) return;
      const key = await this.dependencies.getKey();
      if (!current()) return;
      if (!key.trim()) throw new Error('Add your Valsea API key in Settings before recording.');
      const channels = job.options.includeSystemAudio ? ['Microphone', 'System audio'] : ['Microphone'];
      for (const channel of channels) {
        job.streams.set(channel, this.dependencies.createStream({ key, language: job.options.language,
          targetLanguage: job.options.targetLanguage, diarize: job.options.diarize, hints: job.options.hints,
          vocabulary: job.options.vocabulary, onEvent: event => this.receive(job, phase, channel, event),
          onFailure: message => { if (job.phase === phase) this.fail(job, message); } }));
      }
      await Promise.all([...job.streams.values()].map(stream => stream.connect()));
      if (!current()) return;
      const audio = this.dependencies.createAudio(); job.audio = audio;
      await audio.start(job.options.includeSystemAudio, (channel, data, level) => {
        if (this.job !== job || job.phase !== phase || job.abort.signal.aborted || job.failure ||
          !(this.value.state === 'recording' || this.value.state === 'finishing' && job.draining)) return;
        const stream = job.streams.get(channel);
        if (!stream || !stream.sendAudio(data)) { this.fail(job, 'Audio could not reach the transcription service. Capture stopped.'); return; }
        this.value.levels[channel] = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
      }, message => { if (job.phase === phase) this.fail(job, message); }, job.abort.signal);
      if (!current()) { await audio.stop(); return; }
      job.startedAt = performance.now(); this.value.state = 'recording'; this.publish();
      this.timer = setInterval(() => { this.value.elapsed = this.elapsed(job); this.publish(); }, 250);
    } catch (error) {
      if (this.job === job && job.phase === phase && !job.stopping) {
        this.fail(job, error instanceof Error ? error.message : 'Recording could not start.');
        await job.stopping;
      }
    }
  }
  private receive(job: Job, phase: string, channel: string, event: TranscriptEvent) {
    if (this.job !== job || job.phase !== phase || job.failure) return;
    try {
      const segment = job.reducer.apply(event, channel, job.phaseOffset, phase);
      this.value.partials = { ...job.reducer.partials }; this.publish();
      if (!segment) return;
      if (++job.queuedFinals > 100) { this.fail(job, 'The disk could not keep up with the transcript. Recording stopped.'); return; }
      job.finals = job.finals.then(async () => {
        try {
          this.dependencies.store.appendFinal(job.options.meetingId, segment, job.options.purpose === 'dictation');
          await this.dependencies.store.flush();
          if (segment.original.trim()) job.text = [job.text, segment.original.trim()].filter(Boolean).join('\n');
          this.dependencies.meetingChanged?.(this.dependencies.store.get(job.options.meetingId), job.options.purpose === 'dictation' ? ['segments', 'notes'] : ['segments']);
        } catch { this.fail(job, 'The transcript could not be saved. Keep the app open and export your notes. The clipboard is unchanged.'); }
        finally { job.queuedFinals--; }
      });
    } catch { this.fail(job, 'A transcript event was invalid. Saved final segments are retained.'); }
  }
  private elapsed(job: Job) { return job.elapsed + (job.startedAt === undefined ? 0 : Math.max(0, (performance.now() - job.startedAt) / 1000)); }
  private fail(job: Job, message: string) {
    if (this.job !== job) return;
    job.failure ??= message; job.deliveryAllowed = false; job.draining = false; job.abort.abort();
    if (job.stopping) { for (const stream of job.streams.values()) stream.close(); return; }
    void this.stop({ deliver: false });
  }
  stop(options: { pause?: boolean; deliver?: boolean } = {}): Promise<void> {
    const job = this.job; if (!job) return Promise.resolve();
    if (options.deliver === false) { job.deliveryAllowed = false; job.draining = false; job.abort.abort(); }
    if (job.stopping) {
      if (!options.pause || options.deliver === false) job.pauseAfterStop = false;
      return job.stopping;
    }
    job.pauseAfterStop = options.pause === true && options.deliver !== false;
    const connecting = this.value.state === 'connecting';
    job.draining = this.value.state === 'recording' && !job.abort.signal.aborted && !job.failure;
    if (!job.draining) job.abort.abort();
    this.value.state = 'finishing'; clearInterval(this.timer); this.timer = undefined;
    job.elapsed = this.elapsed(job); job.startedAt = undefined; this.value.elapsed = job.elapsed;
    if (connecting) job.deliveryAllowed = false;
    job.stopping = Promise.resolve().then(async () => {
      try { await job.audio?.stop(); } catch { job.failure ??= 'Audio capture did not stop cleanly. The clipboard is unchanged.'; }
      job.draining = false; job.abort.abort(); job.audio = undefined;
      if (!connecting && !job.failure) {
        await Promise.all([...job.streams.values()].map(async stream => {
          try { await stream.finish(); } catch { job.failure ??= 'Transcription did not finish cleanly. Saved final segments are retained; the clipboard is unchanged.'; }
        }));
      }
      for (const stream of job.streams.values()) stream.close(); job.streams.clear();
      await job.finals;
      try {
        this.dependencies.store.setDuration(job.options.meetingId, job.elapsed); await this.dependencies.store.flush();
        this.dependencies.meetingChanged?.(this.dependencies.store.get(job.options.meetingId), ['duration']);
      } catch { job.failure ??= 'Your latest transcript could not be saved. Keep the app open and export a copy.'; }
      this.value.partials = {}; this.value.levels = {};
      if (job.pauseAfterStop && !job.failure && !connecting) {
        this.value.state = 'paused'; job.stopping = undefined; this.publish(); return;
      }
      let message = job.failure;
      if (job.options.purpose === 'dictation' && job.deliveryAllowed && !job.failure) {
        if (job.text.trim()) {
          const destination = this.dependencies.store.get(job.options.meetingId).entryKind === 'scratchpad' ? 'Scratchpad' : 'this note';
          try { await this.dependencies.copy(job.text); message = `Copied to clipboard. A copy is saved in ${destination}.`; }
          catch { message = `Could not write to the clipboard. Your dictation is saved in ${destination}.`; }
        }
        else message = 'No final speech received. Your clipboard is unchanged.';
      }
      if (connecting && !message) message = 'Recording cancelled.';
      this.job = undefined;
      this.value = { state: 'idle', elapsed: job.elapsed, partials: {}, levels: {}, ...(message ? { message } : {}) }; this.publish();
    });
    this.publish();
    if (connecting) { for (const stream of job.streams.values()) stream.close(); }
    return job.stopping;
  }
  private publish() { this.dependencies.changed(this.snapshot()); }
}
