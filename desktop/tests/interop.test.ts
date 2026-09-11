import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeMeeting } from '../src/shared/meeting';
import { MeetingStore } from '../src/main/store';

const run = promisify(execFile);
test('real Swift model encodes a fixture and decodes the Electron round trip', { skip: process.platform !== 'darwin', timeout: 60000 }, async t => {
  const location = await mkdtemp(path.join(tmpdir(), 'chirpberry-interop-'));
  t.after(() => rm(location, { recursive: true, force: true }));
  const swift = `import Foundation
if CommandLine.arguments.count > 1 {
  let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
  let meeting = try decoder.decode(Meeting.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
  precondition(meeting.notes == "Edited in Electron")
  precondition(meeting.enhancedNotes == "Keep the original summary")
  precondition(meeting.segments[0].original == "你好")
  precondition(meeting.segments[0].translation == "Hello")
  precondition(meeting.isScratchpad)
  print("Swift round trip passed")
} else {
  var meeting = Meeting(title: "Synthetic interoperability fixture")
  meeting.notes = "Written in Swift"; meeting.enhancedNotes = "Keep the original summary"
  meeting.entryKind = "scratchpad"
  meeting.segments = [.init(timestamp: 1, channel: "Fixture", original: "你好", translation: "Hello", utterances: [.init(speaker: nil, transcript: "你好")])]
  let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
  print(String(decoding: try encoder.encode(meeting), as: UTF8.self))
}`;
  await writeFile(path.join(location, 'main.swift'), swift);
  const executable = path.join(location, 'interop');
  await run('swiftc', [path.resolve('../macOS/Sources/ChirpberryCore/Meeting.swift'), path.join(location, 'main.swift'), '-o', executable]);
  const { stdout } = await run(executable);
  assert.equal(decodeMeeting(stdout).notes, 'Written in Swift');
  const store = new MeetingStore(path.join(location, 'documents'));
  await store.load();
  const meeting = await store.importJSON(stdout);
  store.update(meeting.id, { notes: 'Edited in Electron' });
  await store.flush();
  const result = await run(executable, [path.join(store.directory, `${meeting.id}.json`)]);
  assert.match(result.stdout, /Swift round trip passed/);
});
