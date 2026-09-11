import { DesktopRuntime as Runtime, type RuntimeAdapters } from '../../src/main/runtime';
import { MacAudioInput, NativeBridge } from '../../src/main/native';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OpenAIMeetingService } from '../../src/main/assistant-service';
import { RealtimeSession } from '../../src/main/realtime';
import { clipboard } from 'electron';
// This module is compiled only into test-build/. Production imports the real runtime directly.
const lifecycleDirectory = process.env.CHIRPBERRY_FIXTURE_LIFECYCLE_DIR;
const activityFile = process.env.CHIRPBERRY_FIXTURE_ACTIVITY_FILE;
let audioStarts = 0;
if (activityFile) writeFileSync(`${activityFile}.audio-starts`, '0');
const assistantFixture = process.env.CHIRPBERRY_FIXTURE_ASSISTANT === '1';
const soakURL = process.env.CHIRPBERRY_FIXTURE_SOAK_URL;
if (soakURL) {
  const url = new URL(soakURL);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('The recording soak requires a loopback server.');
}
const recoveryDirectory = process.env.CHIRPBERRY_FIXTURE_RECOVERY_DIR;
const recoveryBridge = recoveryDirectory ? new NativeBridge(process.env.CHIRPBERRY_FIXTURE_NODE_EXECUTABLE!,
  [path.resolve('tests/fixtures/native-helper.mjs'), path.join(recoveryDirectory, 'helper.jsonl'), 'hang-exit'], 150, true) : undefined;
let firstCalendarRequest = true;
if (lifecycleDirectory) {
  const copies: string[] = [];
  const file = path.join(lifecycleDirectory, 'clipboard.json');
  writeFileSync(file, '[]');
  clipboard.writeText = async text => { copies.push(text); writeFileSync(file, JSON.stringify(copies)); };
  clipboard.readText = async () => JSON.stringify(copies);
} else {
  // Fixture acceptance must never replace the user's OS clipboard.
  let text = 'Existing synthetic clipboard';
  clipboard.writeText = async value => { text = value; };
  clipboard.readText = async () => text;
}
const helper = (name: string, mode: string) => new NativeBridge(process.env.CHIRPBERRY_FIXTURE_NODE_EXECUTABLE!,
  [path.resolve('tests/fixtures/native-helper.mjs'), path.join(lifecycleDirectory!, `${name}.jsonl`), mode], 150);
const adapters: RuntimeAdapters = {
  ...(activityFile ? { calendar: async () => [], meetingActivity: async () => {
    const value = JSON.parse(readFileSync(activityFile, 'utf8'));
    if (value.error) throw new Error(value.error); return value;
  }, detectionIntervalMs: 100 } : {}),
  ...(recoveryBridge ? { native: recoveryBridge, calendar: async () => {
    const command = firstCalendarRequest ? 'hang' : 'calendar.upcoming'; firstCalendarRequest = false;
    return recoveryBridge.request(command, {}, command === 'hang' ? 100 : 5000);
  } } : {}),
  ...(assistantFixture ? {
    calendar: async () => { const value = JSON.parse(readFileSync(process.env.CHIRPBERRY_FIXTURE_CALENDAR_FILE!, 'utf8')); if (value.error) throw new Error(value.error); return value; },
    assistantCredentials: { available: () => true, read: async () => 'synthetic-openai-key', save: async (key: unknown) => !!key, status: async () => true },
    assistant: (key: string) => {
      const url = new URL(process.env.CHIRPBERRY_FIXTURE_AI_URL!);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('The assistant fixture requires a loopback server.');
      return new OpenAIMeetingService(key, fetch, url.href);
    }
  } : {}),
  ...(lifecycleDirectory ? { native: helper('runtime', 'hang-exit') } : {}),
  credentials: { available: () => true, read: async () => 'synthetic-key', save: async key => !!key, status: async () => true },
  createAudio: () => lifecycleDirectory ? new MacAudioInput(process.env.CHIRPBERRY_FIXTURE_NODE_EXECUTABLE!, () => helper('capture', process.env.CHIRPBERRY_FIXTURE_HELPER_MODE ?? 'hang-exit')) : ({ start: async (_system, pcm) => { if (activityFile) writeFileSync(`${activityFile}.audio-starts`, String(++audioStarts)); pcm('Microphone', Buffer.alloc(3200), 0.2); }, stop: async () => {} }),
  createStream: options => ({ connect: async () => { await new Promise(resolve => setTimeout(resolve, Number(process.env.CHIRPBERRY_FIXTURE_CONNECT_DELAY_MS ?? 0))); setTimeout(() => options.onEvent({ type: 'transcript.partial', text: 'Synthetic live draft' }), 60);
      if (assistantFixture) setTimeout(() => options.onEvent({ type: 'transcript.final', text: 'We agreed to ship the design on Friday. The budget still needs confirmation.', event_id: 'fixture-live-final', timestampMs: 1000 }), 120);
    },
    sendAudio: () => true, close: () => {}, finish: async () => { await new Promise(resolve => setTimeout(resolve, Number(process.env.CHIRPBERRY_FIXTURE_FINISH_DELAY_MS ?? 0))); options.onEvent({ type: 'transcript.final', text: 'Synthetic final speech.', event_id: 'fixture-final', timestampMs: 100 }); } }),
  service: () => ({ format: async () => ({ markdown: 'Synthetic summary.', actions: [] }), transcribe: async () => 'Synthetic imported speech.' }),
  ...(soakURL ? {
    createAudio: () => {
      let timer: ReturnType<typeof setInterval> | undefined;
      return { start: async (systemAudio, pcm) => {
        timer = setInterval(() => { pcm('Microphone', Buffer.alloc(3200), 0.2); if (systemAudio) pcm('System audio', Buffer.alloc(3200), 0.1); }, 100);
      }, stop: async () => { clearInterval(timer); timer = undefined; } };
    },
    createStream: options => new RealtimeSession({ ...options, endpoint: soakURL })
  } : {})
};
export class DesktopRuntime extends Runtime {
  constructor(...args: ConstructorParameters<typeof Runtime>) {
    super(args[0], args[1], args[2], adapters);
    const gate = process.env.CHIRPBERRY_FIXTURE_STARTUP_GATE;
    if (gate) {
      const configure = this.companion.configure.bind(this.companion);
      this.companion.configure = async settings => {
        writeFileSync(`${gate}.waiting`, '');
        const deadline = Date.now() + 15000;
        while (!existsSync(gate)) {
          if (Date.now() > deadline) throw new Error('Synthetic startup gate was not released.');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        await configure(settings); writeFileSync(`${gate}.completed`, '');
      };
    }
  }
}
