import { PCM16Resampler } from '../shared/pcm';
declare const sampleRate: number;
declare class AudioWorkletProcessor { port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class CaptureProcessor extends AudioWorkletProcessor {
  private resampler = new PCM16Resampler(sampleRate);
  private frame = new Int16Array(1600);
  private count = 0;
  private pending = 0;
  private flushing = false;
  private flushed = false;
  private failed = false;
  constructor() {
    super();
    this.port.onmessage = event => {
      if (event.data === 'ack') this.pending = Math.max(0, this.pending - 1);
      else if (event.data === 'flush' && !this.flushing) { this.flushing = true; if (this.count) this.sendFrame(); }
      if (this.flushing && !this.failed && !this.pending && !this.flushed) {
        this.flushed = true; this.port.postMessage({ flushed: true });
      }
    };
  }
  private sendFrame() {
    if (++this.pending > 20) { this.failed = true; this.port.postMessage({ failure: true }); return; }
    const samples = this.frame.slice(0, this.count);
    let power = 0; for (const value of samples) power += (value / 32768) ** 2;
    const buffer = samples.buffer;
    this.port.postMessage({ pcm: buffer, level: Math.min(1, Math.sqrt(power / samples.length) * 4) }, [buffer]);
    this.frame = new Int16Array(1600); this.count = 0;
  }
  process(inputs: Float32Array[][]) {
    if (this.failed) return false;
    if (this.flushing || !inputs[0]?.length) return true;
    for (const sample of this.resampler.push(inputs[0])) {
      this.frame[this.count++] = sample;
      if (this.count === this.frame.length) { this.sendFrame(); if (this.failed) return false; }
    }
    return true;
  }
}
registerProcessor('chirpberry-pcm', CaptureProcessor);
