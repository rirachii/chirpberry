import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { RealtimeSession, TranscriptReducer } from '../src/main/realtime';

test('stream authenticates in headers, waits for readiness, and receives the last final before stop completes', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address(); assert(typeof address === 'object' && address);
  const received: unknown[] = [];
  let authorization: string | undefined;
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization;
    assert.equal(request.url, '/');
    socket.send(JSON.stringify({ type: 'session.created' }));
    socket.on('message', (data, binary) => {
      if (binary) { received.push([...data as Buffer]); return; }
      const message = JSON.parse(data.toString()); received.push(message);
      if (message.type === 'session.start') socket.send(JSON.stringify({ type: 'session.ready' }));
      if (message.type === 'session.stop') {
        socket.send(JSON.stringify({ type: 'transcript.final', text: 'Last words.', event_id: 'last' }));
        socket.send(JSON.stringify({ type: 'session.stopped' }));
      }
    });
  });
  const events: string[] = [];
  const stream = new RealtimeSession({ key: 'synthetic-test-key', language: 'auto', diarize: false,
    onEvent: event => events.push(event.type), onFailure: () => assert.fail('Unexpected stream failure'),
    endpoint: `ws://127.0.0.1:${address.port}`, readyTimeoutMs: 500, finishTimeoutMs: 500 });
  try {
    assert.equal(stream.sendAudio(Buffer.from([0, 0])), false);
    await stream.connect();
    assert.equal(authorization, 'Bearer synthetic-test-key');
    assert.equal(stream.sendAudio(Buffer.from([1, 0, 2, 0])), true);
    await stream.finish();
    assert(events.includes('transcript.final'));
    assert.deepEqual(received.slice(-3), [[1, 0, 2, 0], { type: 'audio.commit' }, { type: 'session.stop' }]);
  } finally { stream.close(); for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('partials stay mutable, final translations belong to a whole segment, and identified repeats are ignored', () => {
  const reducer = new TranscriptReducer();
  assert.equal(reducer.apply({ type: 'transcript.partial', text: 'Draft words' }, 'Microphone', 0, 'one'), undefined);
  assert.equal(reducer.partials.Microphone, 'Draft words');
  const event = { type: 'transcript.final', text: 'We agree. Thank you.', rawText: '同意。谢谢。', translated: true,
    event_id: 'segment-1', timestampMs: 2000, utterances: [{ speaker: 0, transcript: '同意。' }, { speaker: 1, transcript: '谢谢。' }] };
  const segment = reducer.apply(event, 'Microphone', 10, 'one')!;
  assert.equal(segment.original, '同意。谢谢。'); assert.equal(segment.translation, 'We agree. Thank you.');
  assert.equal(segment.timestamp, 12); assert.equal(segment.speakerScope, 'one');
  assert.equal(segment.utterances.length, 2); assert.equal(reducer.partials.Microphone, undefined);
  assert.equal(reducer.apply(event, 'Microphone', 10, 'one'), undefined);
  assert(reducer.apply(event, 'System audio', 10, 'one'));
  assert(reducer.apply({ type: 'transcript.final', text: 'Yes.' }, 'Microphone', 0, 'one'));
  assert(reducer.apply({ type: 'transcript.final', text: 'Yes.' }, 'Microphone', 0, 'one'));
});
