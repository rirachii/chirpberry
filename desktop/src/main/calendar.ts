import { calendarEventSchema, meetingURL, type CalendarEvent, type CalendarSnapshot } from '../shared/calendar';

export class CalendarTracker {
  private state: CalendarSnapshot = { connected: false, refreshing: false, events: [] };
  private generation = 0;
  private pending?: Promise<CalendarSnapshot>;
  private timer?: ReturnType<typeof setInterval>;
  private reminded = new Set<string>();
  constructor(private dependencies: { load(requestPermission: boolean): Promise<unknown>; changed(snapshot: CalendarSnapshot): void;
    remind(event: CalendarEvent): void; now?: () => number }) {}
  private now() { return this.dependencies.now?.() ?? Date.now(); }
  snapshot() { return structuredClone(this.state); }
  private emit() { this.dependencies.changed(this.snapshot()); }
  activate(enabled: boolean) {
    if (!enabled) { this.generation++; clearInterval(this.timer); this.timer = undefined; this.pending = undefined;
      this.state = { connected: false, refreshing: false, events: [] }; this.reminded.clear(); this.emit(); return; }
    this.state.connected = true;
    if (!this.timer) { this.timer = setInterval(() => { void this.refresh(); }, 60000); this.timer.unref(); }
    this.emit();
  }
  refresh(requestPermission = false): Promise<CalendarSnapshot> {
    if (this.pending) return this.pending;
    if (!this.state.connected && !requestPermission) return Promise.resolve(this.snapshot());
    const generation = this.generation;
    this.state.refreshing = true; this.state.error = undefined; this.emit();
    const run = async () => {
      try {
        const raw = await this.dependencies.load(requestPermission);
        if (generation !== this.generation) return this.snapshot();
        if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Calendar returned an unexpected list. Try reconnecting.');
        const events = new Map<string, CalendarEvent>();
        for (const value of raw) {
          const parsed = calendarEventSchema.safeParse(value); if (!parsed.success) throw new Error('Calendar returned an unreadable event. Refresh or reconnect your calendars.');
          const event = parsed.data, start = Date.parse(event.start), end = Date.parse(event.end);
          if (end <= this.now() || start > this.now() + 7 * 86400000 || end < start) continue;
          events.set(event.id, { ...event, joinURL: meetingURL(event.joinURL) });
        }
        this.state = { connected: true, refreshing: false, events: [...events.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 100), refreshedAt: new Date(this.now()).toISOString() };
        this.activate(true);
        for (const event of this.state.events) {
          const until = Date.parse(event.start) - this.now(), key = `${event.id}:${event.start}`;
          if (until <= 2 * 60000 && until >= -60000 && !this.reminded.has(key)) { this.reminded.add(key); this.dependencies.remind(event); }
        }
        if (this.reminded.size > 500) this.reminded = new Set([...this.reminded].slice(-200));
      } catch (error) {
        if (generation !== this.generation) return this.snapshot();
        this.state.refreshing = false; this.state.error = error instanceof Error ? error.message.slice(0, 500) : 'Calendar could not refresh. Try reconnecting.';
        this.emit();
      }
      return this.snapshot();
    };
    const pending = run().finally(() => { if (this.pending === pending) this.pending = undefined; }); this.pending = pending; return pending;
  }
  event(id: string) { return this.state.connected ? this.state.events.find(event => event.id === id && Date.parse(event.end) > this.now()) : undefined; }
  shutdown() { this.activate(false); }
}
