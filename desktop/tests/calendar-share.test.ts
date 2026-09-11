import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CalendarTracker } from '../src/main/calendar';
import { meetingURL } from '../src/shared/calendar';
import { newMeeting } from '../src/shared/meeting';
import { shareContent } from '../src/shared/share';

const now = Date.parse('2026-09-10T15:00:00Z');
const event = (id = 'series:2026-09-10') => ({ id, title: 'Weekly sync', start: new Date(now + 60000).toISOString(), end: new Date(now + 3600000).toISOString(), location: '', calendar: 'Work' });
test('calendar refresh preserves occurrence identity, coalesces requests and reminds only once', async () => {
  let calls = 0, reminders = 0;
  const tracker = new CalendarTracker({ now: () => now, load: async permission => { calls++; assert.equal(permission, calls === 1); return [event(), event(), { ...event('series:2026-09-11'), start: new Date(now + 86400000).toISOString(), end: new Date(now + 90000000).toISOString() }]; }, changed: () => {}, remind: () => reminders++ });
  await Promise.all([tracker.refresh(true), tracker.refresh(true)]);
  assert.equal(calls, 1); assert.equal(tracker.snapshot().events.length, 2); assert.equal(reminders, 1);
  await tracker.refresh(); assert.equal(reminders, 1); tracker.shutdown();
});
test('disconnect wins over pending calendar permissions or refresh and no timer reconnects it', async () => {
  let release!: (value: unknown) => void;
  const tracker = new CalendarTracker({ load: () => new Promise(resolve => release = resolve), changed: () => {}, remind: () => {}, now: () => now });
  const pending = tracker.refresh(true); tracker.activate(false); release([event()]); await pending;
  assert.deepEqual(tracker.snapshot(), { connected: false, refreshing: false, events: [] }); assert.equal(tracker.event(event().id), undefined);
  tracker.shutdown();
});
test('denied calendar stays disconnected and background errors retain a clearly stale schedule', async () => {
  let fail = true;
  const tracker = new CalendarTracker({ load: async () => { if (fail) throw new Error('Calendar access denied.'); return [event(), { ...event('old'), end: new Date(now - 1).toISOString() }]; }, changed: () => {}, remind: () => {}, now: () => now });
  await tracker.refresh(true); assert.equal(tracker.snapshot().connected, false); assert.match(tracker.snapshot().error!, /denied/);
  fail = false; await tracker.refresh(true); assert.equal(tracker.snapshot().events.length, 1);
  fail = true; await tracker.refresh(); assert.equal(tracker.snapshot().events.length, 1); assert.match(tracker.snapshot().error!, /denied/); tracker.shutdown();
});
test('meeting links allow HTTPS only and cannot open local files, executable schemes or URL credentials', () => {
  for (const url of ['file:///private/notes', 'javascript:alert(1)', 'https://user:password@host.test/', 'zoommtg://zoom.us/join', 'http://meet.google.com/code']) assert.equal(meetingURL(url), undefined);
  assert.equal(meetingURL('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
});
test('share preview defaults exclude private notes and transcript and never mutates the source', () => {
  const meeting = newMeeting(randomUUID()); meeting.title = 'Planning'; meeting.notes = 'Private preparation'; meeting.enhancedNotes = 'Approved summary';
  meeting.segments = [{ id: randomUUID(), timestamp: 0, channel: 'Microphone', original: 'Private speech', utterances: [] }];
  const original = JSON.stringify(meeting);
  const content = shareContent(meeting, { summary: true, actions: true, notes: false, transcript: false });
  assert.match(content, /Approved summary/); assert.doesNotMatch(content, /Private/);
  const full = shareContent(meeting, { summary: false, actions: false, notes: true, transcript: true });
  assert.match(full, /Private preparation/); assert.match(full, /Private speech/); assert.doesNotMatch(full, /Approved summary/);
  assert.equal(JSON.stringify(meeting), original); assert.equal(shareContent(meeting, { summary: false, actions: false, notes: false, transcript: false }), '');
});
