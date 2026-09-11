import { z } from 'zod';

export const calendarEventSchema = z.object({ id: z.string().min(1).max(4096), title: z.string().max(1000),
  start: z.iso.datetime(), end: z.iso.datetime(), location: z.string().max(4000).default(''),
  calendar: z.string().max(1000).default(''), joinURL: z.string().max(8192).optional() });
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarSnapshot = { connected: boolean; refreshing: boolean; events: CalendarEvent[]; refreshedAt?: string; error?: string };
export function meetingURL(value: string | undefined): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch { /* unavailable */ }
}
export function eventTiming(event: CalendarEvent, now = Date.now()) {
  const start = Date.parse(event.start), end = Date.parse(event.end);
  if (now >= end) return 'Ended';
  if (now >= start) return 'In progress';
  const minutes = Math.ceil((start - now) / 60000);
  if (minutes < 60) return `In ${minutes} min`;
  if (minutes < 120) return `In 1 hr ${minutes - 60} min`;
  return new Date(start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
