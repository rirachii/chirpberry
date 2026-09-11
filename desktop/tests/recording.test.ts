import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MeetingStore } from '../src/main/store';
import { RecordingController } from '../src/main/recording';
import type { TranscriptEvent } from '../src/main/realtime';

test('dictation saves only final source text, waits for the last final, and copies exactly once', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-recording-'));
  const store = new MeetingStore(directory); await store.load();
  const note = await store.create('scratchpad'); store.update(note.id, { notes: 'Original notes' }); await store.flush();
  const copied: string[] = []; let emit: (event: TranscriptEvent) => void = () => {};
  let audioStarts = 0, audioStops = 0;
  const controller = new RecordingController({ store, getKey: async () => 'fixture-key', copy: value => { copied.push(value); }, changed: () => {},
    createAudio: () => ({ start: async () => { audioStarts++; }, stop: async () => { audioStops++; } }),
    createStream: options => { emit = options.onEvent; return { connect: async () => {}, sendAudio: () => true, close: () => {},
      finish: async () => { emit({ type: 'transcript.final', text: 'Final words.', event_id: 'two' }); } }; } });
  try {
    await assert.rejects(controller.start({ meetingId: note.id, disclosureAccepted: false }), /disclosure|Invalid/i);
    assert.equal(audioStarts, 0);
    await controller.start({ meetingId: note.id, purpose: 'dictation', includeSystemAudio: true, language: 'auto', diarize: true, disclosureAccepted: true });
    assert.equal(controller.snapshot().state, 'recording'); assert.equal(audioStarts, 1);
    emit({ type: 'transcript.partial', text: 'Temporary draft' });
    assert.equal(store.get(note.id).segments.length, 0); assert.equal(controller.snapshot().partials.Microphone, 'Temporary draft');
    emit({ type: 'transcript.final', text: 'First words.', event_id: 'one' });
    await controller.stop(); await controller.stop();
    assert.equal(audioStops, 1); assert.equal(controller.snapshot().state, 'idle');
    assert.deepEqual(copied, ['First words.\nFinal words.']);
    const saved = JSON.parse(await readFile(path.join(directory, `${note.id}.json`), 'utf8'));
    assert.equal(saved.notes, 'Original notes\nFirst words.\nFinal words.');
    assert.equal(saved.segments.length, 2); assert(!JSON.stringify(saved).includes('Temporary draft'));
  } finally { await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
});

test('provider failure stops the microphone and preserves the clipboard after earlier finals', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-failure-'));
  const store = new MeetingStore(directory); await store.load(); const note = await store.create('scratchpad');
  let emit!: (event: TranscriptEvent) => void, fail!: (message: string) => void, stopped = 0;
  const controller = new RecordingController({ store, getKey: async () => 'fixture', changed: () => {}, copy: () => assert.fail('Failed transcription must not copy'),
    createAudio: () => ({ start: async () => {}, stop: async () => { stopped++; } }),
    createStream: options => { emit = options.onEvent; fail = options.onFailure; return { connect: async () => {}, sendAudio: () => true, close: () => {}, finish: async () => assert.fail('Failed stream must not finalize') }; } });
  try {
    await controller.start({ meetingId: note.id, purpose: 'dictation', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
    emit({ type: 'transcript.final', text: 'Saved before disconnect.' }); fail('Network disconnected.'); await controller.stop();
    assert.equal(stopped, 1); assert.equal(controller.active, false); assert.equal(store.get(note.id).notes, 'Saved before disconnect.');
    assert.equal(controller.snapshot().message, 'Network disconnected.');
  } finally { await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
});

test('cancellation during connection never starts capture or replaces the clipboard', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-cancel-'));
  const store = new MeetingStore(directory); await store.load(); const note = await store.create('scratchpad');
  let resolveKey!: (key: string) => void; let readKey!: () => void;
  const requested = new Promise<void>(resolve => { readKey = resolve; });
  let audioStarts = 0;
  const controller = new RecordingController({ store, getKey: () => { readKey(); return new Promise(resolve => { resolveKey = resolve; }); },
    changed: () => {}, copy: () => assert.fail('Cancellation copied text'),
    createAudio: () => ({ start: async () => { audioStarts++; }, stop: async () => {} }),
    createStream: () => { throw new Error('Cancelled sessions must not connect'); } });
  try {
    const starting = controller.start({ meetingId: note.id, purpose: 'dictation', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
    await requested; await controller.stop({ deliver: false }); resolveKey('fixture'); await starting;
    assert.equal(audioStarts, 0); assert.equal(controller.active, false);
  } finally { await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
});

test('pause drains finals, resume uses a new speaker scope, and clipboard failure still releases capture', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-resume-'));
  const store = new MeetingStore(directory); await store.load(); const note = await store.create('scratchpad');
  let phase = 0, stops = 0; const failures: ((message: string) => void)[] = [];
  const controller = new RecordingController({ store, getKey: async () => 'fixture', changed: () => {}, copy: () => { throw new Error('Clipboard unavailable'); },
    createAudio: () => ({ start: async () => {}, stop: async () => { stops++; } }),
    createStream: options => { const index = ++phase; failures.push(options.onFailure); return { connect: async () => {}, close: () => {}, sendAudio: () => true,
      finish: async () => { options.onEvent({ type: 'transcript.final', text: `Phase ${index}`, event_id: 'reused-by-provider' }); } }; } });
  try {
    await controller.start({ meetingId: note.id, purpose: 'dictation', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
    await controller.stop({ pause: true }); assert.equal(controller.snapshot().state, 'paused');
    await controller.resume(); failures[0]('Delayed failure from the closed phase');
    assert.equal(controller.snapshot().state, 'recording'); await controller.stop();
    assert.equal(controller.active, false); assert.equal(stops, 2);
    assert.match(controller.snapshot().message!, /clipboard.*unavailable|could not.*clipboard/i);
    const segments = store.get(note.id).segments; assert.equal(segments.length, 2);
    assert.notEqual(segments[0].speakerScope, segments[1].speakerScope);
  } finally { await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const outcome of ['resolve', 'reject'] as const) {
  test(`Stop awaits a clipboard write that will ${outcome}, retains saved notes, and delivers at most once`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-clipboard-'));
    const store = new MeetingStore(directory); await store.load();
    const note = await store.create('scratchpad'); store.update(note.id, { notes: 'Original notes' }); await store.flush();
    const writing = gate(), delivery = gate();
    const clipboardWrite = delivery.promise.then(() => {
      if (outcome === 'reject') throw new Error('Clipboard unavailable');
    });
    // Keep a broken controller's unobserved rejection from escaping the test harness.
    void clipboardWrite.catch(() => {});
    const copies: string[] = []; let audioStops = 0;
    const controller = new RecordingController({ store, getKey: async () => 'fixture', changed: () => {},
      copy: text => { copies.push(text); writing.release(); return clipboardWrite; },
      createAudio: () => ({ start: async () => {}, stop: async () => { audioStops++; } }),
      createStream: options => ({ connect: async () => {}, sendAudio: () => true, close: () => {},
        finish: async () => { options.onEvent({ type: 'transcript.final', text: 'Final dictation.', event_id: 'final' }); } }) });
    try {
      await controller.start({ meetingId: note.id, purpose: 'dictation', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
      const stopping = controller.stop(); let completed = false;
      void stopping.then(() => { completed = true; });
      await writing.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(completed, false, 'Stop must remain pending until clipboard delivery settles');
      assert.equal(controller.snapshot().state, 'finishing');
      assert.equal(controller.snapshot().message, undefined);
      assert.equal(controller.stop(), stopping);
      assert.equal(controller.stop({ deliver: false }), stopping, 'Shutdown must await the already pending clipboard write');
      const saved = JSON.parse(await readFile(path.join(directory, `${note.id}.json`), 'utf8'));
      assert.equal(saved.notes, 'Original notes\nFinal dictation.');
      assert.equal(saved.segments.length, 1);
      delivery.release(); await stopping;
      assert.equal(controller.active, false);
      assert.equal(controller.snapshot().message, outcome === 'resolve'
        ? 'Copied to clipboard. A copy is saved in Scratchpad.'
        : 'Could not write to the clipboard. Your dictation is saved in Scratchpad.');
      await controller.stop();
      assert.deepEqual(copies, ['Final dictation.']); assert.equal(audioStops, 1);
      const reloaded = new MeetingStore(directory); await reloaded.load();
      assert.equal(reloaded.get(note.id).notes, saved.notes);
      assert.deepEqual(reloaded.get(note.id).segments, saved.segments);
    } finally { delivery.release(); await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
  });
}

for (const during of ['provider drain', 'persistence'] as const) {
  for (const outcome of ['deliver', 'cancel', 'provider failure', 'save failure'] as const) {
    test(`a full Stop during Pause ${during} finishes once with ${outcome}`, async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-stop-race-'));
      const { atomicWrite } = await import('../src/main/store');
      const writing = gate(), persist = gate(), draining = gate(), final = gate();
      let blockWrites = false;
      const store = new MeetingStore(directory, () => {}, async (file, contents) => {
        if (blockWrites) {
          writing.release(); await persist.promise;
          if (outcome === 'save failure') throw new Error('Synthetic full disk');
        }
        await atomicWrite(file, contents);
      });
      await store.load();
      const note = await store.create('scratchpad'); store.update(note.id, { notes: 'Original notes' }); await store.flush();
      const copied: string[] = []; let stops = 0, finishes = 0;
      const controller = new RecordingController({ store, getKey: async () => 'fixture', changed: () => {}, copy: text => { copied.push(text); },
        createAudio: () => ({ start: async () => {}, stop: async () => { stops++; } }),
        createStream: options => ({ connect: async () => {}, close: () => {}, sendAudio: () => true, finish: async () => {
          finishes++; draining.release(); await final.promise;
          options.onEvent({ type: 'transcript.final', text: 'Late final words.', event_id: 'final' });
          if (outcome === 'provider failure') throw new Error('Synthetic finalization failure');
        } }) });
      try {
        await controller.start({ meetingId: note.id, purpose: 'dictation', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
        blockWrites = true;
        const pause = controller.stop({ pause: true });
        await draining.promise;
        if (during === 'persistence') { final.release(); await writing.promise; }
        const finish = controller.stop();
        assert.equal(finish, pause);
        assert.equal(controller.stop({ pause: true }), finish);
        if (outcome === 'cancel') assert.equal(controller.stop({ deliver: false }), finish);
        assert.equal(controller.snapshot().state, 'finishing');
        assert.deepEqual(copied, []);
        final.release(); await writing.promise;
        assert.deepEqual(copied, []);
        persist.release(); await Promise.all([pause, finish]);
        assert.equal(controller.snapshot().state, 'idle');
        assert.equal(stops, 1); assert.equal(finishes, 1);
        assert.deepEqual(copied, outcome === 'deliver' ? ['Late final words.'] : []);
        await controller.stop(); assert.equal(copied.length, outcome === 'deliver' ? 1 : 0);
        const saved = JSON.parse(await readFile(path.join(directory, `${note.id}.json`), 'utf8'));
        assert.equal(saved.notes, outcome === 'save failure' ? 'Original notes' : 'Original notes\nLate final words.');
      } finally { final.release(); persist.release(); await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
    });
  }
}

for (const action of ['stop', 'pause', 'cancel'] as const) test(`${action} handles already captured PCM before provider finalization`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-drain-'));
  const store = new MeetingStore(directory); await store.load(); const note = await store.create('meeting');
  let pcm!: (channel: string, data: Buffer, level: number) => void;
  const events: string[] = [];
  const controller = new RecordingController({ store, getKey: async () => 'synthetic', copy: () => {}, changed: () => {},
    createAudio: () => ({ start: async (_system, callback) => { pcm = callback; }, stop: async () => { pcm('Microphone', Buffer.alloc(2), 0); } }),
    createStream: () => ({ connect: async () => {}, sendAudio: () => { events.push('pcm'); return true; }, close: () => {}, finish: async () => { events.push('finish'); } }) });
  try {
    await controller.start({ meetingId: note.id, purpose: 'meeting', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
    await controller.stop(action === 'pause' ? { pause: true } : action === 'cancel' ? { deliver: false } : {});
    assert.deepEqual(events, action === 'cancel' ? ['finish'] : ['pcm', 'finish']);
  } finally { await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
});

test('cancellation during a graceful drain rejects subsequent PCM immediately', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-drain-cancel-'));
  const store = new MeetingStore(directory); await store.load(); const note = await store.create('meeting');
  let pcm!: (channel: string, data: Buffer, level: number) => void;
  const stopping = gate(), drain = gate(); let frames = 0;
  const controller = new RecordingController({ store, getKey: async () => 'synthetic', copy: () => {}, changed: () => {},
    createAudio: () => ({ start: async (_system, callback) => { pcm = callback; }, stop: async () => { stopping.release(); await drain.promise; pcm('Microphone', Buffer.alloc(2), 0); } }),
    createStream: () => ({ connect: async () => {}, sendAudio: () => { frames++; return true; }, close: () => {}, finish: async () => {} }) });
  try {
    await controller.start({ meetingId: note.id, purpose: 'meeting', includeSystemAudio: false, language: 'auto', diarize: false, disclosureAccepted: true });
    const stopped = controller.stop(); await stopping.promise;
    pcm('Microphone', Buffer.alloc(2), 0); assert.equal(frames, 1);
    const cancelled = controller.stop({ deliver: false });
    pcm('Microphone', Buffer.alloc(2), 0); assert.equal(frames, 1);
    drain.release(); await Promise.all([stopped, cancelled]); assert.equal(frames, 1);
  } finally { drain.release(); await controller.stop({ deliver: false }); await rm(directory, { recursive: true, force: true }); }
});
