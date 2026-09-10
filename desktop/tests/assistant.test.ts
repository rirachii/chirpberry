import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MeetingAssistant, meetingContext, OpenAIMeetingService } from '../src/main/assistant-service';
import { newMeeting } from '../src/shared/meeting';
import type { AssistantAnswer } from '../src/shared/assistant';

const id = () => randomUUID().toUpperCase();
const input = () => ({ model: 'gpt-4.1-mini', title: 'Meeting', mode: 'ask' as const, question: 'What was decided?', sources: [{ id: 'T1', label: 'Microphone', text: 'Ship Friday.' }], history: [] });
test('Responses stream decodes split UTF-8, sends private bounded context and requires completion', async () => {
  let request: RequestInit | undefined;
  const bytes = new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Café [T1]"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n');
  const fetcher = (async (_url, options) => { request = options; return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } })); }) as typeof fetch;
  let output = '';
  await new OpenAIMeetingService('test-key', fetcher).stream(input(), new AbortController().signal, text => output += text);
  assert.equal(output, 'Café [T1]');
  const body = JSON.parse(request!.body as string);
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.max_output_tokens, 900);
  assert.equal(request!.redirect, 'error'); assert.equal((request!.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.equal(JSON.stringify(body).includes('test-key'), false); assert.equal('tools' in body, false);
});
test('Responses stream rejects incomplete, missing terminal, excessive and provider failures without echoing provider secrets', async () => {
  for (const data of ['data: {"type":"response.incomplete"}\n\n', 'data: {"type":"response.output_text.delta","delta":"unfinished"}\n\n',
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'x'.repeat(16001) })}\n\n`, 'data: invalid-json\n\n']) {
    const client = new OpenAIMeetingService('test-key', (async () => new Response(data)) as typeof fetch);
    await assert.rejects(client.stream(input(), new AbortController().signal, () => {}));
  }
  const client = new OpenAIMeetingService('test-key', (async () => new Response('private-provider-message', { status: 429 })) as typeof fetch);
  await assert.rejects(client.stream(input(), new AbortController().signal, () => {}), error => error instanceof Error && /limit/.test(error.message) && !/private-provider/.test(error.message));
});
test('meeting context is bounded, keeps recent final speech and relevant earlier evidence, and contains no other meeting', () => {
  const meeting = newMeeting(id()); meeting.notes = 'n'.repeat(7000);
  meeting.segments = Array.from({ length: 80 }, (_, index) => ({ id: id(), channel: 'Microphone', timestamp: index, utterances: [], original: index === 2 ? 'The budget is approved.' : `Final speech ${index}.` }));
  const context = meetingContext(meeting, 'What is the budget?');
  assert.ok(context.sources.some(source => source.id === 'T3')); assert.ok(context.sources.some(source => source.id === 'T80'));
  assert.ok(context.sources.reduce((size, source) => size + source.text.length, 0) <= 24000); assert.equal(context.excerpted, true);
});
test('meeting assistant gates disclosure, retains immutable sources, validates citations and does not edit notes', async () => {
  const meeting = newMeeting(id()); meeting.notes = 'The original plan.';
  let accepted = false; const answers: AssistantAnswer[] = [];
  const assistant = new MeetingAssistant({ meeting: () => meeting, configuration: () => ({ accepted, model: 'test-model' }), changed: answer => answers.push(answer),
    service: async () => ({ stream: async (request, _signal, delta) => { assert.equal(request.sources[0].text, 'The original plan.'); meeting.notes = 'Edited while AI was working.'; delta('The plan. [N1] [T999]'); } }) });
  const request = { meetingId: meeting.id, requestId: id(), mode: 'ask', question: 'What is the plan?' };
  await assert.rejects(assistant.ask(request), /processing/); assert.equal(answers.length, 0);
  accepted = true; await assistant.ask(request);
  const answer = assistant.thread(meeting.id)[0]; assert.equal(answer.state, 'complete'); assert.match(answer.text, /source unavailable/);
  assert.equal(answer.sources[0].text, 'The original plan.'); assert.equal(meeting.notes, 'Edited while AI was working.');
  assert.equal(meeting.enhancedNotes, ''); await assert.rejects(assistant.ask(request), /already/);
});
test('cancelling and clearing an answer discards late stream updates without starting another meeting request', async () => {
  const meeting = newMeeting(id()); meeting.notes = 'Plan.'; let release!: () => void;
  const barrier = new Promise<void>(resolve => release = resolve), answers: AssistantAnswer[] = [];
  const assistant = new MeetingAssistant({ meeting: () => meeting, configuration: () => ({ accepted: true, model: 'test-model' }), changed: answer => answers.push(answer),
    service: async () => ({ stream: async (_input, _signal, delta) => { await barrier; delta('late text'); } }) });
  const requestId = id(), pending = assistant.ask({ meetingId: meeting.id, requestId, mode: 'respond' });
  await assert.rejects(assistant.ask({ meetingId: meeting.id, requestId: id(), mode: 'questions' }), /current answer/);
  assistant.clear(meeting.id); release(); await pending;
  assert.deepEqual(assistant.thread(meeting.id), []); assert.ok(answers.every(answer => !answer.text));
  assert.equal(meeting.notes, 'Plan.');
});
