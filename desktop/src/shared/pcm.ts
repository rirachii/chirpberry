/** Continuous area resampling: frame boundaries do not repeat or drop source samples. */
export class PCM16Resampler {
  private weight = 0;
  private sum = 0;
  private readonly step: number;
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 16000 || sampleRate > 192000) throw new Error('Unsupported microphone sample rate.');
    this.step = sampleRate / 16000;
  }
  push(channels: Float32Array[]): Int16Array {
    if (!channels.length) return new Int16Array();
    const output: number[] = [];
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;
      for (const channel of channels) sample += Number.isFinite(channel[index]) ? channel[index] : 0;
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      let remaining = 1;
      while (remaining > 1e-9) {
        const portion = Math.min(remaining, this.step - this.weight);
        this.sum += sample * portion; this.weight += portion; remaining -= portion;
        if (this.weight + 1e-9 >= this.step) {
          const value = this.sum / this.step;
          output.push(Math.round(value * (value < 0 ? 32768 : 32767))); this.sum = 0; this.weight = 0;
        }
      }
    }
    return Int16Array.from(output);
  }
}
