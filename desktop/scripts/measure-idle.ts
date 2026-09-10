import { _electron as electron } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { newMeeting } from '../src/shared/meeting';

const executable = process.argv[2], count = Number(process.argv[3] ?? 0);
if (!executable || !Number.isInteger(count) || count < 0 || count > 1000) throw new Error('Usage: npx tsx scripts/measure-idle.ts /path/to/packaged/executable [0..1000 notes]');
const root = await mkdtemp(path.join(os.tmpdir(), 'chirpberry-idle-measurement-'));
const documents = path.join(root, 'documents');
await mkdir(documents);
let bytes = 0;
for (let index = 0; index < count; index++) {
  const meeting = newMeeting(randomUUID());
  meeting.title = `Synthetic planning meeting ${index + 1}`;
  meeting.notes = 'Synthetic private performance fixture. '.repeat(80);
  meeting.segments = Array.from({ length: 100 }, (_, part) => ({ id: randomUUID().toUpperCase(), timestamp: part * 10,
    channel: 'Synthetic', original: `Discussion segment ${part + 1}: review the schedule, budget, and next steps.`, utterances: [] }));
  const content = JSON.stringify(meeting); bytes += Buffer.byteLength(content);
  await writeFile(path.join(documents, `${meeting.id}.json`), content);
}
const started = performance.now();
let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  application = await electron.launch({ executablePath: path.resolve(executable), args: [], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: documents, CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } });
  const page = await application.firstWindow();
  await page.getByRole(count ? 'textbox' : 'heading', { name: count ? 'Note title' : 'Start with what matters.', exact: true }).waitFor();
  const startupMS = performance.now() - started;
  if (count && await page.getByRole('textbox', { name: 'Note title' }).inputValue() === '') throw new Error('The synthetic notebook did not load.');
  // Discard startup activity and the first CPU sample (Electron defines it as 0).
  await delay(3000);
  await application.evaluate(({ app }) => app.getAppMetrics());
  type IdleSample = { processCount: number; cpuPercent: number; workingSetMiB: number; idleWakeupsPerSecond: number };
  const samples: IdleSample[] = [];
  for (let index = 0; index < 10; index++) {
    await delay(1000);
    const processes = await application.evaluate(({ app }) => app.getAppMetrics());
    samples.push({ processCount: processes.length,
      cpuPercent: processes.reduce((sum, process) => sum + process.cpu.percentCPUUsage, 0),
      workingSetMiB: processes.reduce((sum, process) => sum + process.memory.workingSetSize, 0) / 1024,
      idleWakeupsPerSecond: processes.reduce((sum, process) => sum + process.cpu.idleWakeupsPerSecond, 0) });
  }
  const average = (field: keyof IdleSample) => samples.reduce((sum, sample) => sum + sample[field], 0) / samples.length;
  const asar = path.join(await application.evaluate(() => process.resourcesPath), 'app.asar');
  process.stdout.write(JSON.stringify({ measuredAt: new Date().toISOString(), platform: os.platform(), release: os.release(), arch: os.arch(),
    cpuModel: os.cpus()[0].model, logicalCPUs: os.cpus().length, ramGiB: os.totalmem() / 1024 ** 3,
    appAsarSHA256: createHash('sha256').update(await readFile(asar)).digest('hex'), notes: count, fixtureBytes: bytes,
    startupMS, samples, meanCPUPercent: average('cpuPercent'), meanWorkingSetMiB: average('workingSetMiB'),
    meanIdleWakeupsPerSecond: average('idleWakeupsPerSecond'),
    scope: 'One instrumented launch; fresh isolated profile; OS integrations disabled; floating bar enabled. Summed Electron working sets may count shared memory more than once. No live capture, calendars, credentials, or provider calls.' }, null, 2) + '\n');
} finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
