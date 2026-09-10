import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, MeetingStore } from '../src/main/store';
import { decodeMeeting, markdown, newMeeting, searchableText, transcriptText } from '../src/shared/meeting';

async function directory(t: TestContext) {
  const location = await mkdtemp(path.join(tmpdir(), 'chirpberry-test-'));
  t.after(() => rm(location, { recursive: true, force: true }));
  return location;
}

test('save, restart, pin, trash and restore retain original notes and separate summaries', async t => {
  const location = await directory(t);
  const store = new MeetingStore(location);
  await store.load();
  const meeting = await store.create('scratchpad');
  store.update(meeting.id, { notes: 'Original notes: 你好', enhancedNotes: 'A separate summary', isPinned: true, isTrashed: true });
  await store.flush();
  const restarted = new MeetingStore(location);
  const snapshot = await restarted.load();
  assert.equal(snapshot.meetings.length, 1);
  assert.equal(restarted.get(meeting.id).notes, 'Original notes: 你好');
  assert.equal(restarted.get(meeting.id).enhancedNotes, 'A separate summary');
  assert.equal(restarted.get(meeting.id).entryKind, 'scratchpad');
  assert.equal(restarted.get(meeting.id).isPinned, true);
  restarted.update(meeting.id, { isTrashed: false });
  await restarted.flush();
  assert.equal(decodeMeeting(await readFile(path.join(location, `${meeting.id}.json`), 'utf8')).isTrashed, false);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(location, `${meeting.id}.json`))).mode & 0o777, 0o600);
});

test('corrupt, mismatched and future documents remain untouched and are reported', async t => {
  const location = await directory(t);
  const future = { ...newMeeting(randomUUID()), schemaVersion: 2 };
  const mismatched = newMeeting(randomUUID());
  const files = { 'broken.json': '{', [`${future.id}.json`]: JSON.stringify(future), 'wrong-id.json': JSON.stringify(mismatched) };
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(location, name), contents);
  const store = new MeetingStore(location);
  const snapshot = await store.load();
  assert.equal(snapshot.meetings.length, 0);
  assert.equal(snapshot.unreadable.length, 3);
  await store.create('meeting');
  for (const [name, contents] of Object.entries(files)) assert.equal(await readFile(path.join(location, name), 'utf8'), contents);
});

test('failed writes retain the previous disk document and unsaved edits for export and retry', async t => {
  const location = await directory(t);
  let failure = false;
  const store = new MeetingStore(location, () => {}, async (destination, contents) => {
    if (failure) throw new Error('Simulated full disk');
    await atomicWrite(destination, contents);
  });
  await store.load();
  const meeting = await store.create('meeting');
  store.update(meeting.id, { notes: 'Saved original' });
  await store.flush();
  failure = true;
  store.update(meeting.id, { notes: 'Edits still in memory' });
  await assert.rejects(store.flush(), /could not be saved/);
  assert.equal(decodeMeeting(await readFile(path.join(location, `${meeting.id}.json`), 'utf8')).notes, 'Saved original');
  assert.match(markdown(store.get(meeting.id)), /Edits still in memory/);
  failure = false;
  await store.flush();
  assert.equal(decodeMeeting(await readFile(path.join(location, `${meeting.id}.json`), 'utf8')).notes, 'Edits still in memory');
  assert.ok((await readdir(location)).every(name => !name.endsWith('.tmp')));
});

test('an edit arriving during a write is persisted after that write completes', async t => {
  const location = await directory(t);
  let block = false;
  let release!: () => void;
  let entered!: () => void;
  const enteredWrite = new Promise<void>(resolve => { entered = resolve; });
  const store = new MeetingStore(location, () => {}, async (destination, contents) => {
    if (block) { block = false; entered(); await new Promise<void>(resolve => { release = resolve; }); }
    await atomicWrite(destination, contents);
  });
  await store.load();
  const meeting = await store.create('meeting');
  block = true;
  store.update(meeting.id, { notes: 'First change' });
  const flush = store.flush();
  await enteredWrite;
  store.update(meeting.id, { notes: 'Latest change' });
  release();
  await flush;
  assert.equal(decodeMeeting(await readFile(path.join(location, `${meeting.id}.json`), 'utf8')).notes, 'Latest change');
});

test('imports create new identities and reject path traversal or immutable-field changes', async t => {
  const store = new MeetingStore(await directory(t));
  await store.load();
  const source = { ...newMeeting(randomUUID()), isTrashed: true, notes: 'Keep my writing' };
  const imported = await store.importJSON(JSON.stringify(source));
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.notes, source.notes);
  assert.equal(imported.isTrashed, false);
  assert.throws(() => store.get('../credentials'));
  assert.throws(() => store.update(imported.id, { id: randomUUID() } as never));
  await assert.rejects(store.importJSON(JSON.stringify({ ...source, unknownFutureField: 'Do not discard silently' })));
});

test('export and search preserve bilingual segment boundaries and speaker scope', () => {
  const meeting = newMeeting(randomUUID());
  meeting.segments = [{ id: randomUUID(), timestamp: 12, channel: 'Mac audio', original: '你好。再见。', translation: 'Hello. Goodbye.', targetLanguage: 'english', speakerScope: 'session-one', utterances: [{ speaker: 0, transcript: '你好。' }, { speaker: 1, transcript: '再见。' }] }];
  meeting.speakerNames['Mac audio:session-one:0'] = 'Maya';
  const transcript = transcriptText(meeting);
  assert.match(transcript, /Maya: 你好/);
  assert.equal(transcript.split('Hello. Goodbye.').length - 1, 1);
  assert.match(searchableText(meeting), /你好/);
  assert.match(searchableText(meeting), /Maya/);
  assert.match(markdown(meeting), /\[00:12\]/);
  meeting.segments[0].speakerScope = 'session-two';
  assert.doesNotMatch(transcriptText(meeting), /Maya/);
});

test('the exact serialized byte limit survives restart and rejects oversized edits before replacement', async t => {
  const location = await directory(t), store = new MeetingStore(location);
  await store.load();
  const meeting = await store.create('meeting');
  const limit = 32 * 1024 * 1024;
  const overhead = Buffer.byteLength(JSON.stringify(meeting, null, 2));
  const notes = '\0'.repeat(Math.floor((limit - overhead) / 6));
  const enhancedNotes = 'a'.repeat((limit - overhead) % 6);
  store.update(meeting.id, { notes, enhancedNotes });
  await store.flush();
  const filename = path.join(location, `${meeting.id}.json`);
  const saved = await readFile(filename, 'utf8');
  assert.equal(Buffer.byteLength(saved), limit);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...store.get(meeting.id), enhancedNotes: enhancedNotes + '🌱' })) < limit);
  assert.throws(() => store.update(meeting.id, { enhancedNotes: enhancedNotes + '🌱' }), /32 MB/);
  assert.equal(store.get(meeting.id).enhancedNotes, enhancedNotes);
  assert.equal(await readFile(filename, 'utf8'), saved);
  const restarted = new MeetingStore(location);
  assert.deepEqual((await restarted.load()).unreadable, []);
  assert.equal(restarted.get(meeting.id).notes, notes);
});

test('compact JSON imports that expand beyond the reload limit leave the source and store intact', async t => {
  const location = await directory(t), store = new MeetingStore(location);
  await store.load();
  const meeting = newMeeting(randomUUID()), limit = 32 * 1024 * 1024;
  meeting.notes = '\0'.repeat(Math.floor((limit - Buffer.byteLength(JSON.stringify(meeting, null, 2))) / 6) + 1);
  const contents = JSON.stringify(meeting);
  assert.ok(Buffer.byteLength(contents) < limit);
  assert.ok(Buffer.byteLength(JSON.stringify(meeting, null, 2)) > limit);
  const source = path.join(location, 'source.json'); await writeFile(source, contents);
  await assert.rejects(store.importJSON(await readFile(source, 'utf8')), /32 MB/);
  assert.deepEqual(store.snapshot().meetings, []);
  assert.deepEqual(await readdir(location), ['source.json']);
  assert.equal(await readFile(source, 'utf8'), contents);
});
