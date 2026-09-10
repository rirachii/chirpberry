import { PCM16Resampler } from '../shared/pcm';
declare const sampleRate: number;
declare class AudioWorkletProcessor { port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class CaptureProcessor extends AudioWorkletProcessor {
  private resampler = new PCM16Resampler(sampleRate);
  private frame = new Int16Array(1600);
  private count = 0;
  private pending = 0;
  constructor() { super(); this.port.onmessage = () => { this.pending = Math.max(0, this.pending - 1); }; }
  process(inputs: Float32Array[][]) {
    if (!inputs[0]?.length) return true;
    for (const sample of this.resampler.push(inputs[0])) {
      this.frame[this.count++] = sample;
      if (this.count === this.frame.length) {
        if (++this.pending > 20) { this.port.postMessage({ failure: true }); return false; }
        let power = 0; for (const value of this.frame) power += (value / 32768) ** 2;
        const buffer = this.frame.buffer;
        this.port.postMessage({ pcm: buffer, level: Math.min(1, Math.sqrt(power / this.frame.length) * 4) }, [buffer]);
        this.frame = new Int16Array(1600); this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('chirpberry-pcm', CaptureProcessor);
