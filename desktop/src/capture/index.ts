declare global {
  interface Window {
    captureHost: { frame(channel: string, pcm: ArrayBuffer, level: number): Promise<void>; failure(): void };
    startCapture(systemAudio: boolean): Promise<void>;
    stopCapture(): Promise<void>;
  }
}
const streams: MediaStream[] = [], contexts: AudioContext[] = [];
const drains: (() => Promise<void>)[] = [];
let stopped = false, stopping: Promise<void> | undefined;
async function attach(stream: MediaStream, channel: string) {
  if (stopped || stopping) { stream.getTracks().forEach(track => track.stop()); throw new Error('Capture cancelled'); }
  streams.push(stream);
  for (const track of stream.getAudioTracks()) track.onended = () => { if (!stopped && !stopping) window.captureHost.failure(); };
  const context = new AudioContext(); contexts.push(context);
  await context.audioWorklet.addModule('./worklet.js');
  if (stopped || stopping) return;
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const worklet = new AudioWorkletNode(context, 'chirpberry-pcm');
  let resolveDrain: (() => void) | undefined, rejectDrain: ((error: Error) => void) | undefined;
  let failed = false;
  const failure = () => { failed = true; rejectDrain?.(new Error('Audio could not be delivered.')); if (!stopped) window.captureHost.failure(); };
  drains.push(() => new Promise<void>((resolve, reject) => {
    if (failed) { reject(new Error('Audio could not be delivered.')); return; }
    resolveDrain = resolve; rejectDrain = reject; worklet.port.postMessage('flush');
  }));
  worklet.onprocessorerror = failure;
  worklet.port.onmessage = event => {
    if (stopped) return;
    if (event.data.failure) { failure(); return; }
    if (event.data.flushed) { resolveDrain?.(); return; }
    void window.captureHost.frame(channel, event.data.pcm, event.data.level).then(() => worklet.port.postMessage('ack')).catch(failure);
  };
  // A silent output keeps the graph processing without playing microphone audio.
  const silent = context.createGain(); silent.gain.value = 0;
  source.connect(worklet); worklet.connect(silent); silent.connect(context.destination); await context.resume();
}
window.startCapture = async systemAudio => {
  try {
    await attach(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false }), 'Microphone');
    if (stopped || stopping) return;
    if (systemAudio) {
      const system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      streams.push(system);
      if (!system.getAudioTracks().length) throw new Error('System audio unavailable');
      await attach(system, 'System audio');
    }
  } catch { await window.stopCapture().catch(() => {}); throw new Error('Capture could not start. Check microphone permissions and your audio devices.'); }
};
window.stopCapture = () => {
  if (stopping) return stopping;
  stopping = Promise.resolve().then(async () => {
    streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    try { await Promise.all(drains.map(drain => drain())); }
    finally { stopped = true; await Promise.all(contexts.map(context => context.close().catch(() => {}))); }
  });
  return stopping;
};
window.addEventListener('beforeunload', () => { stopped = true; streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); });
export {};
