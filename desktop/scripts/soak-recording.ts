import { _electron as electron, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { newMeeting } from '../src/shared/meeting';

const duration = Number(process.argv[2] ?? 300);
if (!Number.isInteger(duration) || duration < 30 || duration > 1800) throw new Error('Usage: npx tsx scripts/soak-recording.ts [30..1800 seconds]');
const root = await mkdtemp(path.join(os.tmpdir(), 'chirpberry-recording-soak-'));
const profile = path.join(root, 'profile'), documents = path.join(root, 'documents');
const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await once(server, 'listening');
const address = server.address(); assert(address && typeof address === 'object');
let bytes = 0, connections = 0, partials = 0, stoppedStreams = 0;
const expectedFinals: string[] = [], errors: string[] = [];
server.on('connection', (socket, request) => {
  if (request.headers.authorization !== 'Bearer synthetic-key' || request.url !== '/') {
    errors.push('Unexpected synthetic authentication or URL.'); socket.terminate(); return;
  }
  const connection = ++connections; let frames = 0, final = 0;
  const send = (value: unknown) => socket.send(JSON.stringify(value));
  const sendFinal = () => {
    const original = `Synthetic source ${connection}/${++final}: confirm the schedule and next steps.`;
    expectedFinals.push(original);
    const event = { type: 'transcript.final', event_id: `final-${final}`, timestampMs: frames * 100,
      text: `Synthetic translation ${connection}/${final}.`, rawText: original, translated: true,
      sourceLanguage: 'zh', targetLanguage: 'en' };
    send(event); send(event); // A repeated provider event must persist once, including after Resume.
  };
  send({ type: 'session.created' });
  socket.on('message', (data, binary) => {
    try {
    if (binary) {
      const size = (data as Buffer).length; assert.equal(size, 3200); bytes += size; frames++;
      if (frames % 5 === 0) { partials++; send({ type: 'transcript.partial', text: `TRANSIENT_DRAFT_${connection}_${frames}` }); }
      if (frames % 20 === 0) sendFinal();
      return;
    }
    const command = JSON.parse(data.toString());
    if (command.type === 'session.start') send({ type: 'session.ready' });
    if (command.type === 'session.stop') { sendFinal(); stoppedStreams++; send({ type: 'session.stopped' }); }
    } catch { errors.push('The synthetic server received an invalid protocol message.'); socket.terminate(); }
  });
});
let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
const launch = () => electron.launch({ args: [path.resolve('test-build/main.cjs')], env: { ...process.env,
  CHIRPBERRY_PROFILE_DIR: profile, CHIRPBERRY_DOCUMENTS_DIR: documents, CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1',
  CHIRPBERRY_FIXTURE_SOAK_URL: `ws://127.0.0.1:${address.port}` } });
try {
  await mkdir(profile); await mkdir(documents);
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ disclosureAccepted: true, includeSystemAudio: true, barVisible: true }));
  for (let index = 0; index < 250; index++) {
    const note = newMeeting(randomUUID()); note.title = `Synthetic background note ${index + 1}`;
    note.notes = 'Synthetic notebook search content. '.repeat(40);
    await writeFile(path.join(documents, `${note.id}.json`), JSON.stringify(note));
  }
  application = await launch();
  const page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled meeting');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Synthetic recording soak');
  await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Original synthetic notes.');
  await page.getByRole('button', { name: 'Record meeting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const meetingId = (await page.evaluate(() => window.chirpberry.runtime())).capture.meetingId;
  await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
  await delay(3000); await application.evaluate(({ app }) => app.getAppMetrics());
  const started = performance.now(); let resumed = false, edited = false;
  const samples: { elapsed: number; cpuPercent: number; workingSetMiB: number; finals: number }[] = [];
  while (performance.now() - started < duration * 1000) {
    await delay(Math.min(10000, Math.max(1, duration * 1000 - (performance.now() - started))));
    const elapsed = (performance.now() - started) / 1000;
    if (!edited && elapsed >= duration / 4) { await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Edited during synthetic recording.'); edited = true; }
    if (!resumed && elapsed >= duration / 2) {
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
      await expect.poll(() => server.clients.size).toBe(0);
      const pausedBytes = bytes; await delay(1000); assert.equal(bytes, pausedBytes);
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible(); resumed = true;
    }
    const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
    samples.push({ elapsed, cpuPercent: metrics.reduce((sum, process) => sum + process.cpu.percentCPUUsage, 0),
      workingSetMiB: metrics.reduce((sum, process) => sum + process.memory.workingSetSize, 0) / 1024, finals: expectedFinals.length });
    const runtime = await page.evaluate(() => window.chirpberry.runtime()); assert.equal(runtime.capture.state, 'recording');
    process.stderr.write(`Synthetic soak: ${Math.round(elapsed)}s, ${expectedFinals.length} finals, ${Math.round(samples.at(-1)!.workingSetMiB)} MiB summed working set.\n`);
  }
  const stopping = performance.now();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record meeting', exact: true })).toBeVisible();
  const stopMS = performance.now() - stopping;
  await expect.poll(() => server.clients.size).toBe(0);
  const state = await page.evaluate(() => window.chirpberry.load()), note = state.meetings.find(note => note.id === meetingId)!;
  assert(note); assert.equal(note.title, 'Synthetic recording soak'); assert.equal(note.notes, 'Edited during synthetic recording.');
  assert.deepEqual(note.segments.map(segment => segment.original).sort(), [...expectedFinals].sort());
  assert(note.segments.every(segment => segment.translation?.startsWith('Synthetic translation ')));
  assert.equal(new Set(note.segments.map(segment => segment.speakerScope)).size, 2);
  assert.equal(connections, 4); assert.equal(stoppedStreams, 4); assert(bytes > 0 && partials > 0);
  assert.equal((await page.evaluate(() => window.chirpberry.runtime())).capture.state, 'idle');
  await application.close(); application = undefined;
  const saved = await readFile(path.join(documents, `${note.id}.json`), 'utf8');
  assert(!saved.includes('TRANSIENT_DRAFT_')); assert.equal(JSON.parse(saved).segments.length, expectedFinals.length);
  assert((await readdir(documents)).every(name => name.endsWith('.json')));
  application = await launch();
  const reopened = await application.firstWindow(); await reopened.getByRole('textbox', { name: 'Note title' }).waitFor();
  const restored = (await reopened.evaluate(() => window.chirpberry.load())).meetings.find(meeting => meeting.id === note.id)!;
  assert.deepEqual(restored.segments, note.segments); assert.equal(restored.notes, note.notes); assert.deepEqual(errors, []);
  assert.equal((await reopened.evaluate(() => window.chirpberry.runtime())).capture.state, 'idle');
  assert.equal(server.clients.size, 0); assert.equal(connections, 4);
  const mean = (field: 'cpuPercent' | 'workingSetMiB') => samples.reduce((sum, sample) => sum + sample[field], 0) / samples.length;
  process.stdout.write(JSON.stringify({ measuredAt: new Date().toISOString(), platform: os.platform(), cpu: os.cpus()[0].model,
    fixtureBuildSHA256: createHash('sha256').update(await readFile('test-build/main.cjs')).digest('hex'),
    durationSeconds: duration, backgroundNotes: 250, connections, stoppedStreams, audioBytes: bytes, partialEvents: partials,
    persistedFinals: expectedFinals.length, stopMS, meanCPUPercent: mean('cpuPercent'), meanWorkingSetMiB: mean('workingSetMiB'),
    samples, persistedAfterRelaunch: true, originalNotesPreserved: true, duplicateFinalsIgnored: true,
    scope: 'Synthetic Electron build; two generated PCM streams through the production WebSocket client and recording controller, loopback server, real document storage and UI. No device capture, keys, calendar access, or cloud requests. Shared working sets may be counted more than once.' }, null, 2) + '\n');
} finally {
  try { await application?.close(); }
  finally { for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
}
