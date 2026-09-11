import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValseaREST, parseSummary } from '../src/main/rest';
import { newMeeting } from '../src/shared/meeting';
test('structured summaries preserve provider action ownership and never fabricate empty output', () => {
  const summary = parseSummary({ summary: 'Agreed to follow up.', decisions: ['Ship the draft'], action_items: [{ description: 'Send draft', owner: 'Sam' }] });
  assert.match(summary.markdown, /Ship the draft/); assert.equal(summary.actions[0].owner, 'Sam');
  assert.equal(summary.actions[0].deadline, undefined); assert.equal(summary.actions[0].completed, false);
  assert.throws(() => parseSummary({ usage: { tokens: 500 } }), /no usable/i);
});
test('REST sends credentials in headers, rejects redirects, and hides raw provider errors', async () => {
  const meeting = newMeeting(randomUUID()); meeting.notes = 'Original notes';
  const requests: { url: string; init: RequestInit }[] = [];
  const service = new ValseaREST('fixture-key', async (url, init) => {
    requests.push({ url: String(url), init: init! }); return new Response('fixture-key private diagnostic', { status: 401 });
  });
  await assert.rejects(service.format(meeting), error => error instanceof Error && /API key/.test(error.message) && !error.message.includes('fixture-key'));
  assert.equal(requests[0].url, 'https://api.valsea.ai/v1/formatting');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer fixture-key');
  assert.equal(requests[0].init.redirect, 'error'); assert.equal(meeting.notes, 'Original notes');
});
