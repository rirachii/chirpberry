import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetingDetection } from '../src/main/meeting-detection';
import { settingsSchema } from '../src/shared/capture';
import type { MeetingPrompt } from '../src/shared/meeting-detection';

function fixture() {
  let time = 0, capture = false, value: unknown = [], probes = 0;
  const notifications: MeetingPrompt[] = [];
  const detector = new MeetingDetection({ probe: async () => { probes++; if (value instanceof Error) throw value; return value; },
    captureActive: () => capture, now: () => time, autoPoll: false, changed: () => {}, notify: prompt => notifications.push(prompt) });
  return { detector, notifications, probes: () => probes, value: (next: unknown) => value = next,
    capture: (active: boolean) => { capture = active; detector.captureChanged(); },
    tick: async (ms = 5000) => { time += ms; await detector.poll(); } };
}
test('detection defaults off and requires two sustained input samples; idle audio creates no prompt', async () => {
  const f = fixture(); assert.equal(settingsSchema.parse({}).meetingDetectionEnabled, false);
  await f.tick(); assert.equal(f.probes(), 0);
  f.detector.setEnabled(true); await f.tick(); await f.tick(); assert.equal(f.notifications.length, 0);
  f.value(['zoom']); await f.tick(); assert.equal(f.notifications.length, 0);
  f.value([]); await f.tick(); f.value(['zoom']); await f.tick(); assert.equal(f.notifications.length, 0);
  await f.tick(); assert.equal(f.notifications.length, 1); assert.equal(f.detector.snapshot().prompt?.source, 'zoom');
  f.detector.shutdown();
});
test('one suggestion per call, dismissal survives brief gaps, and a minute without input rearms', async () => {
  const f = fixture(); f.detector.setEnabled(true); f.value(['chrome', 'teams']); await f.tick(); await f.tick();
  const id = f.detector.snapshot().prompt!.id; assert.equal(f.detector.snapshot().prompt!.source, 'teams');
  f.detector.dismiss('not-current'); assert.equal(f.detector.current(id), true);
  f.detector.dismiss(id); await f.tick(); assert.equal(f.notifications.length, 1);
  f.value([]); await f.tick(); f.value(['teams']); await f.tick(); await f.tick(); assert.equal(f.notifications.length, 1);
  f.value([]); await f.tick(60000); f.value(['teams']); await f.tick(); await f.tick(); assert.equal(f.notifications.length, 2);
  f.detector.shutdown();
});
test('expired, disappeared and consumed suggestions cannot start, even with delayed polling', async () => {
  const f = fixture(); f.detector.setEnabled(true); f.value(['chrome']); await f.tick(); await f.tick();
  const first = f.detector.snapshot().prompt!.id;
  f.value([]); await f.tick(); assert.throws(() => f.detector.consume(first), /expired/);
  await f.tick(60000); f.value(['chrome']); await f.tick(); await f.tick();
  const second = f.detector.snapshot().prompt!.id; f.detector.consume(second); assert.throws(() => f.detector.consume(second), /expired/);
  f.value([]); await f.tick(60000); f.value(['chrome']); await f.tick(); await f.tick();
  const third = f.detector.snapshot().prompt!.id;
  // Continuous call lasts beyond the two-minute suggestion lifetime.
  for (let i = 0; i < 24; i++) await f.tick();
  assert.throws(() => f.detector.consume(third), /expired/); assert.equal(f.notifications.length, 3);
  f.detector.shutdown();
});
test('recording suppresses and clears suggestions, including calls observed while capturing', async () => {
  const f = fixture(); f.detector.setEnabled(true); f.value(['zoom']); await f.tick(); await f.tick();
  const id = f.detector.snapshot().prompt!.id; f.capture(true); assert.equal(f.detector.snapshot().prompt, undefined);
  assert.throws(() => f.detector.consume(id), /expired/);
  f.value(['zoom', 'chrome']); await f.tick(); f.capture(false); await f.tick(); await f.tick();
  assert.equal(f.notifications.length, 1); f.detector.shutdown();
});
test('malformed metadata and probe failures clear suggestions, keep errors generic, and recover', async () => {
  const f = fixture(); f.detector.setEnabled(true); f.value(['zoom']); await f.tick(); await f.tick();
  f.value(new Error('/private/user-data')); await f.tick();
  assert.equal(f.detector.snapshot().prompt, undefined); assert.doesNotMatch(f.detector.snapshot().error!, /private/);
  f.value(['unrelated-app']); await f.tick(); assert.ok(f.detector.snapshot().error);
  f.value([]); await f.tick(); assert.equal(f.detector.snapshot().error, undefined);
  f.detector.setEnabled(false); assert.equal(f.detector.snapshot().enabled, false); assert.equal(f.detector.snapshot().error, undefined);
  f.detector.shutdown();
});
test('pending probes coalesce; disable, re-enable and shutdown discard late activity without notifications', async () => {
  let release!: (value: unknown) => void, probes = 0, notifications = 0;
  const detector = new MeetingDetection({ probe: () => { probes++; return new Promise(resolve => release = resolve); },
    captureActive: () => false, autoPoll: false, changed: () => {}, notify: () => notifications++ });
  detector.setEnabled(true); const first = detector.poll(); assert.equal(detector.poll(), first); assert.equal(probes, 1);
  detector.setEnabled(false); detector.setEnabled(true); assert.equal(detector.poll(), first);
  release(['zoom']); await first; assert.equal(detector.snapshot().prompt, undefined);
  const second = detector.poll(); detector.shutdown(); release(['zoom']); await second;
  await detector.poll(); assert.equal(probes, 2); assert.equal(notifications, 0);
});
test('interactive native requests defer detection and clear suggestions without a background timeout', async () => {
  let busy = false, time = 0, probes = 0;
  const detector = new MeetingDetection({ canProbe: () => !busy, probe: async () => { probes++; return ['zoom']; },
    captureActive: () => false, now: () => time, autoPoll: false, changed: () => {}, notify: () => {} });
  detector.setEnabled(true); await detector.poll(); time = 5000; await detector.poll();
  assert.ok(detector.snapshot().prompt); busy = true; time = 10000; await detector.poll();
  assert.equal(probes, 2); assert.equal(detector.snapshot().prompt, undefined); assert.equal(detector.snapshot().error, undefined);
  busy = false; time = 15000; await detector.poll(); assert.equal(probes, 3); assert.equal(detector.snapshot().prompt, undefined);
  detector.shutdown();
});
