declare global {
  interface Window {
    captureHost: { frame(channel: string, pcm: ArrayBuffer, level: number): Promise<void>; failure(): void };
    startCapture(systemAudio: boolean): Promise<void>;
    stopCapture(): Promise<void>;
  }
}
const streams: MediaStream[] = [], contexts: AudioContext[] = [];
let stopped = false;
async function attach(stream: MediaStream, channel: string) {
  if (stopped) { stream.getTracks().forEach(track => track.stop()); throw new Error('Capture cancelled'); }
  streams.push(stream);
  for (const track of stream.getAudioTracks()) track.onended = () => { if (!stopped) window.captureHost.failure(); };
  const context = new AudioContext(); contexts.push(context);
  await context.audioWorklet.addModule('./worklet.js');
  if (stopped) return;
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const worklet = new AudioWorkletNode(context, 'chirpberry-pcm');
  worklet.onprocessorerror = () => window.captureHost.failure();
  worklet.port.onmessage = event => {
    if (stopped) return;
    if (event.data.failure) { window.captureHost.failure(); return; }
    void window.captureHost.frame(channel, event.data.pcm, event.data.level).then(() => worklet.port.postMessage('ack')).catch(() => window.captureHost.failure());
  };
  // A silent output keeps the graph processing without playing microphone audio.
  const silent = context.createGain(); silent.gain.value = 0;
  source.connect(worklet); worklet.connect(silent); silent.connect(context.destination); await context.resume();
}
window.startCapture = async systemAudio => {
  try {
    await attach(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false }), 'Microphone');
    if (systemAudio) {
      const system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      streams.push(system);
      if (!system.getAudioTracks().length) throw new Error('System audio unavailable');
      await attach(system, 'System audio');
    }
  } catch { await window.stopCapture(); throw new Error('Capture could not start. Check microphone permissions and your audio devices.'); }
};
window.stopCapture = async () => {
  stopped = true; streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
};
window.addEventListener('beforeunload', () => { stopped = true; streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); });
export {};
