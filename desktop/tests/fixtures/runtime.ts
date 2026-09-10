import { DesktopRuntime as Runtime, type RuntimeAdapters } from '../../src/main/runtime';
// This module is compiled only into test-build/. Production imports the real runtime directly.
const adapters: RuntimeAdapters = {
  credentials: { available: () => true, read: async () => 'synthetic-key', save: async key => !!key, status: async () => true },
  createAudio: () => ({ start: async (_system, pcm) => { pcm('Microphone', Buffer.alloc(3200), 0.2); }, stop: async () => {} }),
  createStream: options => ({ connect: async () => { await new Promise(resolve => setTimeout(resolve, Number(process.env.CHIRPBERRY_FIXTURE_CONNECT_DELAY_MS ?? 0))); setTimeout(() => options.onEvent({ type: 'transcript.partial', text: 'Synthetic live draft' }), 60); },
    sendAudio: () => true, close: () => {}, finish: async () => { await new Promise(resolve => setTimeout(resolve, Number(process.env.CHIRPBERRY_FIXTURE_FINISH_DELAY_MS ?? 0))); options.onEvent({ type: 'transcript.final', text: 'Synthetic final speech.', event_id: 'fixture-final', timestampMs: 100 }); } }),
  service: () => ({ format: async () => ({ markdown: 'Synthetic summary.', actions: [] }), transcribe: async () => 'Synthetic imported speech.' })
};
export class DesktopRuntime extends Runtime {
  constructor(...args: ConstructorParameters<typeof Runtime>) { super(args[0], args[1], args[2], adapters); }
}
