import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

async function source(entry) {
  return (await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser' })).outputFiles[0].text;
}
async function processor() {
  let Processor;
  const messages = [];
  class Base { port = { postMessage: message => messages.push(message) }; }
  vm.runInNewContext(await source('src/capture/worklet.ts'), {
    AudioWorkletProcessor: Base, sampleRate: 48000, registerProcessor: (_name, type) => { Processor = type; }
  });
  const worklet = new Processor();
  return { worklet, messages, command: data => worklet.port.onmessage({ data }) };
}
test('worklet flush sends the partial tail and waits for every IPC acknowledgement', async () => {
  const { worklet, messages, command } = await processor();
  worklet.process([[new Float32Array(4800).fill(0.25)]]);
  worklet.process([[new Float32Array(480).fill(0.5)]]);
  assert.equal(messages.length, 1);
  command('flush');
  assert.deepEqual(messages.map(message => message.pcm?.byteLength), [3200, 320]);
  assert.ok(new Int16Array(messages[1].pcm).every(sample => sample === 16384));
  command('ack'); assert.equal(messages.length, 2);
  command('ack'); assert.equal(messages[2].flushed, true);
  command('flush'); command('ack');
  worklet.process([[new Float32Array(4800)]]);
  assert.equal(messages.length, 3, 'A finished phase cannot produce duplicate or new frames');
});
test('empty worklet flush completes without sending audio; a stalled consumer fails boundedly', async () => {
  const empty = await processor(); empty.command('flush');
  assert.equal(empty.messages.length, 1); assert.equal(empty.messages[0].flushed, true);
  const full = await processor();
  for (let frame = 0; frame < 21; frame++) full.worklet.process([[new Float32Array(4800)]]);
  full.command('flush');
  assert.equal(full.messages.filter(message => message.pcm).length, 20);
  assert.equal(full.messages.at(-1).failure, true);
  assert.equal(full.messages.some(message => message.flushed), false);
});
test('capture graph stops tracks then forwards final frames before closing its contexts', async () => {
  const events = [], worklets = [];
  let acknowledge;
  const track = { stop: () => events.push('track stopped') };
  class Stream { getTracks() { return [track]; } getAudioTracks() { return [track]; } }
  const connectable = () => ({ connect: () => {}, gain: {} });
  class Context {
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource = connectable;
    createGain = connectable;
    resume = async () => {};
    close = async () => { events.push('context closed'); };
  }
  class Worklet {
    constructor() { worklets.push(this); }
    connect() {}
    port = { postMessage: command => {
      events.push(command);
      if (command === 'flush') this.port.onmessage({ data: { pcm: new ArrayBuffer(320), level: 0.2 } });
      if (command === 'ack') this.port.onmessage({ data: { flushed: true } });
    } };
  }
  const window = { addEventListener() {}, captureHost: {
    failure: () => assert.fail('Intentional Stop must not report device failure'),
    frame: async (_channel, pcm) => { assert.equal(pcm.byteLength, 320); events.push('tail delivered'); await new Promise(resolve => { acknowledge = resolve; }); }
  } };
  vm.runInNewContext(await source('src/capture/index.ts'), { window, navigator: { mediaDevices: { getUserMedia: async () => new Stream() } }, MediaStream: Stream, AudioContext: Context, AudioWorkletNode: Worklet });
  await window.startCapture(false);
  const stop = window.stopCapture(); assert.equal(window.stopCapture(), stop);
  await Promise.resolve();
  assert.deepEqual(events, ['track stopped', 'flush', 'tail delivered']);
  track.onended(); acknowledge(); await stop;
  assert.deepEqual(events, ['track stopped', 'flush', 'tail delivered', 'ack', 'context closed']);
  worklets[0].port.onmessage({ data: { pcm: new ArrayBuffer(2), level: 0 } });
  assert.equal(events.length, 5);
});
