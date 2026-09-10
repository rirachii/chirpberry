import test from 'node:test';
import assert from 'node:assert/strict';
import { PCM16Resampler } from '../src/shared/pcm';

test('streaming 44.1/48k downmix keeps sample count and waveform across arbitrary chunk boundaries', () => {
  for (const rate of [44100, 48000, 16000]) {
    const samples = Float32Array.from({ length: rate }, (_, index) => Math.sin(index * 2 * Math.PI * 440 / rate));
    const continuous = new PCM16Resampler(rate).push([samples, samples]);
    const resampler = new PCM16Resampler(rate); const split: number[] = [];
    for (let offset = 0; offset < rate; offset += 137) split.push(...resampler.push([samples.subarray(offset, offset + 137), samples.subarray(offset, offset + 137)]));
    assert.equal(continuous.length, 16000); assert.deepEqual(split, [...continuous]);
    assert(continuous.some(value => value > 30000)); assert(continuous.some(value => value < -30000));
  }
  assert.deepEqual([...new PCM16Resampler(16000).push([new Float32Array([2, -2, NaN, Infinity])])], [32767, -32768, 0, 0]);
});
