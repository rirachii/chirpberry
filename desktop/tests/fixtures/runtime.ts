import { DesktopRuntime as Runtime, type RuntimeAdapters } from '../../src/main/runtime';
import { MacAudioInput, NativeBridge } from '../../src/main/native';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { clipboard } from 'electron';
// This module is compiled only into test-build/. Production imports the real runtime directly.
const lifecycleDirectory = process.env.CHIRPBERRY_FIXTURE_LIFECYCLE_DIR;
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
  ...(lifecycleDirectory ? { native: helper('runtime', 'hang-exit') } : {}),
  credentials: { available: () => true, read: async () => 'synthetic-key', save: async key => !!key, status: async () => true },
  createAudio: () => lifecycleDirectory ? new MacAudioInput(process.env.CHIRPBERRY_FIXTURE_NODE_EXECUTABLE!, () => helper('capture', process.env.CHIRPBERRY_FIXTURE_HELPER_MODE ?? 'hang-exit')) : ({ start: async (_system, pcm) => { pcm('Microphone', Buffer.alloc(3200), 0.2); }, stop: async () => {} }),
  createStream: options => ({ connect: async () => { await new Promise(resolve => setTimeout(resolve, Number(process.env.CHIRPBERRY_FIXTURE_CONNECT_DELAY_MS ?? 0))); setTimeout(() => options.onEvent({ type: 'transcript.partial', text: 'Synthetic live draft' }), 60); },
    sendAudio: () => true, close: () => {}, finish: async () => { await new Promise(resolve => setTimeout(resolve, Number(process.env.CHIRPBERRY_FIXTURE_FINISH_DELAY_MS ?? 0))); options.onEvent({ type: 'transcript.final', text: 'Synthetic final speech.', event_id: 'fixture-final', timestampMs: 100 }); } }),
  service: () => ({ format: async () => ({ markdown: 'Synthetic summary.', actions: [] }), transcribe: async () => 'Synthetic imported speech.' })
};
export class DesktopRuntime extends Runtime {
  constructor(...args: ConstructorParameters<typeof Runtime>) { super(args[0], args[1], args[2], adapters); }
}
