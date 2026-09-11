import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transcriptText, type Meeting } from '../shared/meeting';
export function parseSummary(input: unknown): { markdown: string; actions: Meeting['actions'] } {
  const object = z.record(z.string(), z.unknown()).parse(input);
  if (typeof object.raw_content === 'string' && object.raw_content.trim()) return { markdown: object.raw_content, actions: [] };
  const fields: [string, string][] = [['summary', 'Summary'], ['agenda_items', 'Agenda'], ['decisions', 'Decisions'], ['key_discussions', 'Discussion'],
    ['notes', 'Notes'], ['customer_sentiment', 'Customer sentiment'], ['sentiment_reasoning', 'Sentiment context'], ['deal_stage', 'Deal stage'],
    ['next_steps', 'Next steps'], ['issue_summary', 'Issue'], ['root_cause', 'Root cause'], ['resolution_status', 'Status'], ['resolution_summary', 'Resolution'],
    ['follow_up_actions', 'Follow-up'], ['semantic_flags', 'Context'], ['objections', 'Objections'], ['purchase_signals', 'Purchase signals'], ['key_quotes', 'Quotes']];
  const sections = fields.flatMap(([key, title]) => {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) return [`### ${title}\n\n${value}`];
    if (Array.isArray(value)) {
      const lines = value.flatMap(item => typeof item === 'string' ? [item] : item && typeof item === 'object' ?
        [['phrase', 'interpretation', 'suggested_response'].flatMap(field => typeof item[field] === 'string' ? [item[field]] : []).join('\n')] : []).filter(Boolean);
      if (lines.length) return [`### ${title}\n\n${lines.map(line => `- ${line}`).join('\n')}`];
    }
    return [];
  });
  const actions: Meeting['actions'] = (Array.isArray(object.action_items) ? object.action_items : []).flatMap(item => {
    const result = z.object({ description: z.string().min(1), owner: z.string().nullish(), deadline: z.string().nullish() }).safeParse(item);
    if (!result.success) return [];
    return [{ id: randomUUID().toUpperCase(), description: result.data.description, completed: false,
      ...(result.data.owner ? { owner: result.data.owner } : {}), ...(result.data.deadline ? { deadline: result.data.deadline } : {}) }];
  });
  if (!sections.length && !actions.length) throw new Error('Valsea returned no usable summary. Your original notes are preserved.');
  return { markdown: sections.join('\n\n'), actions };
}
export class ValseaREST {
  constructor(private key: string, private request: typeof fetch = fetch) {}
  async format(meeting: Meeting, signal?: AbortSignal) {
    if (!meeting.notes.trim() && !meeting.segments.length) throw new Error('Add notes or a transcript before generating a summary.');
    const transcript = `Meeting: ${meeting.title}\n\nPersonal notes:\n${meeting.notes}\n\nConversation:\n${transcriptText(meeting)}`;
    if (Buffer.byteLength(transcript) > 1024 * 1024) throw new Error('This meeting is too large to summarize in one request. Export it and select a smaller excerpt.');
    return parseSummary(await this.post('formatting', JSON.stringify({ model: 'valsea-format', transcript, output_type: meeting.template }), signal));
  }
  async transcribe(data: Uint8Array, extension: string, signal?: AbortSignal) {
    if (data.byteLength > 10_000_000 || !['wav', 'mp3', 'm4a', 'flac', 'ogg', 'webm'].includes(extension)) throw new Error('Choose a supported audio file up to 10 MB.');
    const form = new FormData(); form.set('model', 'valsea-transcribe'); form.set('language', 'auto');
    form.set('file', new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }), `recording.${extension}`);
    const object = z.object({ text: z.string().min(1).max(8 * 1024 * 1024) }).safeParse(await this.post('audio/transcriptions', form, signal));
    if (!object.success || !object.data.text.trim()) throw new Error('Valsea returned no transcript. Your source audio is unchanged.');
    return object.data.text;
  }
  private async post(endpoint: string, body: string | FormData, signal?: AbortSignal): Promise<unknown> {
    if (!this.key.trim() || /[\r\n]/.test(this.key)) throw new Error('Add your Valsea API key in Settings.');
    let response: Response;
    const timeout = AbortSignal.timeout(180000);
    try { response = await this.request(`https://api.valsea.ai/v1/${endpoint}`, { method: 'POST', body, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${this.key}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) } }); }
    catch { throw new Error('The Valsea request was cancelled or could not connect. Your saved notes are unchanged.'); }
    if (!response.ok) {
      await response.body?.cancel();
      const errors: Record<number, string> = { 401: 'Valsea rejected this API key. Check Settings.', 403: 'Valsea rejected this API key. Check Settings.',
        402: 'Your Valsea account needs credits.', 429: 'Valsea’s rate limit was reached. Wait before retrying.', 413: 'This file is too large for Valsea.' };
      throw new Error(errors[response.status] ?? `Valsea could not complete this request (HTTP ${response.status}). Your notes are unchanged.`);
    }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Valsea returned an empty response.');
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new Error('Valsea returned an unreadable or oversized response. Your notes are unchanged.'); }
    finally { reader.releaseLock(); }
  }
}
