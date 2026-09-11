import { randomUUID } from 'node:crypto';
import { meetingActivitySchema, meetingSources, type DetectionSnapshot, type MeetingPrompt, type MeetingSource } from '../shared/meeting-detection';

type Activity = { firstSeen: number; lastSeen: number; handled: boolean; present: boolean };
type Dependencies = {
  probe(): Promise<unknown>; captureActive(): boolean;
  canProbe?(): boolean;
  changed(snapshot: DetectionSnapshot): void; notify(prompt: MeetingPrompt): void;
  now?(): number; intervalMs?: number; autoPoll?: boolean;
};

// Metadata only. A prompt is an expiring suggestion, never permission to record.
export class MeetingDetection {
  private enabled = false;
  private stopped = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private activities = new Map<MeetingSource, Activity>();
  private prompt?: MeetingPrompt;
  private error?: string;
  private now: () => number;
  private interval: number;
  constructor(private dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
    this.interval = dependencies.intervalMs ?? 5000;
  }
  snapshot(): DetectionSnapshot { return { enabled: this.enabled, ...(this.prompt ? { prompt: { ...this.prompt } } : {}), ...(this.error ? { error: this.error } : {}) }; }
  private emit() { this.dependencies.changed(this.snapshot()); }
  setEnabled(enabled: boolean) {
    if (this.stopped || this.enabled === enabled) return;
    this.enabled = enabled; this.generation++;
    clearTimeout(this.timer); this.activities.clear(); this.prompt = undefined; this.error = undefined; this.emit();
    if (enabled && this.dependencies.autoPoll !== false) void this.poll();
  }
  captureChanged() {
    if (!this.dependencies.captureActive()) return;
    for (const activity of this.activities.values()) activity.handled = true;
    if (this.prompt) { this.prompt = undefined; this.emit(); }
  }
  current(id: string): boolean {
    const activity = this.prompt && this.activities.get(this.prompt.source), now = this.now();
    return this.enabled && !this.stopped && !this.dependencies.captureActive() && this.prompt?.id === id &&
      now - this.prompt.createdAt < 120000 && !!activity?.present && now - activity.lastSeen < 15000;
  }
  dismiss(id: string) {
    if (this.prompt?.id !== id) return;
    this.prompt = undefined; this.emit();
  }
  consume(id: string) {
    if (!this.current(id)) throw new Error('This call suggestion has expired. Use Record meeting to start notes.');
    this.dismiss(id);
  }
  poll(): Promise<void> {
    if (!this.enabled || this.stopped) return Promise.resolve();
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.pending = this.sample(generation).finally(() => {
      this.pending = undefined;
      if (this.enabled && !this.stopped && this.dependencies.autoPoll !== false) {
        this.timer = setTimeout(() => void this.poll(), this.error ? 30000 : this.interval); this.timer.unref();
      }
    });
    return this.pending;
  }
  private async sample(generation: number) {
    try {
      // A background timeout must not interrupt a pending Keychain/Calendar prompt.
      if (this.dependencies.canProbe?.() === false) {
        for (const activity of this.activities.values()) activity.present = false;
        if (this.prompt) { this.prompt = undefined; this.emit(); }
        return;
      }
      const result = await this.dependencies.probe();
      if (generation !== this.generation || !this.enabled || this.stopped) return;
      const sources = new Set(meetingActivitySchema.parse(result)), now = this.now();
      const before = JSON.stringify(this.snapshot());
      this.error = undefined;
      for (const [source, activity] of this.activities) {
        if (now - activity.lastSeen >= 60000) this.activities.delete(source);
        else if (!sources.has(source)) activity.present = false;
      }
      for (const source of sources) {
        const activity = this.activities.get(source);
        this.activities.set(source, { firstSeen: activity?.present ? activity.firstSeen : now,
          lastSeen: now, handled: activity?.handled ?? false, present: true });
      }
      if (this.prompt && !this.current(this.prompt.id)) this.prompt = undefined;
      if (this.dependencies.captureActive()) {
        for (const activity of this.activities.values()) activity.handled = true;
      } else if (this.prompt) {
        for (const activity of this.activities.values()) if (activity.present) activity.handled = true;
      } else if (!this.prompt) {
        const source = meetingSources.find(source => {
          const activity = this.activities.get(source);
          return activity?.present && !activity.handled && now - activity.firstSeen >= this.interval;
        });
        if (source) {
          this.prompt = { id: randomUUID(), source, createdAt: now };
          // One suggestion for concurrent browser/helper audio activity in this call.
          for (const activity of this.activities.values()) if (activity.present) activity.handled = true;
          this.dependencies.notify({ ...this.prompt });
        }
      }
      if (JSON.stringify(this.snapshot()) !== before) this.emit();
    } catch {
      if (generation !== this.generation || !this.enabled || this.stopped) return;
      this.prompt = undefined;
      for (const activity of this.activities.values()) { activity.handled = true; activity.present = false; }
      this.error = 'Call activity is unavailable. Chirpberry will retry; you can still start notes manually.';
      this.emit();
    }
  }
  shutdown() {
    this.stopped = true; this.enabled = false; this.generation++;
    clearTimeout(this.timer); this.activities.clear(); this.prompt = undefined;
  }
}
