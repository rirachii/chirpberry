import { z } from 'zod';

export const uuid = z.string().uuid().transform(value => value.toUpperCase());
const date = z.string().refine(value => /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid document date')
  .transform(value => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z'));
const text = z.string().max(8 * 1024 * 1024);
const optionalText = z.string().optional();
const utteranceSchema = z.strictObject({
  speaker: z.number().int().nonnegative().optional(), transcript: text,
  start: z.number().finite().nonnegative().optional(), end: z.number().finite().nonnegative().optional()
});
const segmentSchema = z.strictObject({
  id: uuid, timestamp: z.number().finite().nonnegative(), channel: z.string(), original: text,
  translation: optionalText, sourceLanguage: optionalText, targetLanguage: optionalText,
  utterances: z.array(utteranceSchema), speakerScope: optionalText
});
const actionSchema = z.strictObject({
  id: uuid, description: text, owner: optionalText, deadline: optionalText, completed: z.boolean()
});
export const meetingSchema = z.strictObject({
  schemaVersion: z.literal(1), id: uuid, title: text,
  createdAt: date, updatedAt: date, notebook: text, notes: text, enhancedNotes: text,
  actions: z.array(actionSchema), segments: z.array(segmentSchema), speakerNames: z.record(z.string(), z.string()),
  template: z.enum(['meeting_minutes', 'sales_summary', 'service_log']),
  targetLanguage: z.string(), vocabulary: text, calendarID: optionalText,
  attendees: z.array(z.string()), duration: z.number().finite().nonnegative(),
  isTrashed: z.boolean(), isPinned: z.boolean(), entryKind: optionalText
});
export type Meeting = z.infer<typeof meetingSchema>;
export type Segment = Meeting['segments'][number];
export const patchSchema = meetingSchema.pick({
  title: true, notebook: true, notes: true, enhancedNotes: true, actions: true,
  speakerNames: true, template: true, targetLanguage: true, vocabulary: true,
  isPinned: true, isTrashed: true
}).partial();
export type MeetingPatch = z.infer<typeof patchSchema>;
export const targets = ['english', 'chinese', 'japanese', 'korean', 'vietnamese', 'thai', 'french', 'spanish', 'german', 'russian', 'indonesian', 'malay', 'filipino', 'tamil', 'khmer', 'lao'];

// Swift's ISO8601 decoder expects whole seconds. Keep the version-1 interchange format.
export function timestamp() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
export function newMeeting(id: string, kind: 'meeting' | 'scratchpad' = 'meeting'): Meeting {
  return meetingSchema.parse({
    schemaVersion: 1, id, title: kind === 'scratchpad' ? 'Untitled note' : 'Untitled meeting',
    createdAt: timestamp(), updatedAt: timestamp(), notebook: kind === 'scratchpad' ? 'Scratchpad' : 'Inbox',
    notes: '', enhancedNotes: '', actions: [], segments: [], speakerNames: {},
    template: 'meeting_minutes', targetLanguage: 'english', vocabulary: '', attendees: [],
    duration: 0, isTrashed: false, isPinned: false, ...(kind === 'scratchpad' ? { entryKind: kind } : {})
  });
}
export function decodeMeeting(contents: string): Meeting {
  if (new TextEncoder().encode(contents).byteLength > 32 * 1024 * 1024) throw new Error('Meeting files must be smaller than 32 MB.');
  try { return meetingSchema.parse(JSON.parse(contents)); }
  catch { throw new Error('This file does not match the supported Chirpberry meeting format. The original file has been preserved.'); }
}
export function speakerKey(channel: string, speaker?: number, scope?: string) {
  return speaker === undefined ? channel : `${channel}:${scope ? `${scope}:` : ''}${speaker}`;
}
export function speakerName(meeting: Meeting, segment: Segment, speaker?: number) {
  const key = speakerKey(segment.channel, speaker, segment.speakerScope);
  return (Object.hasOwn(meeting.speakerNames, key) ? meeting.speakerNames[key] : undefined) ??
    (speaker === undefined ? segment.channel : `${segment.channel} · Speaker ${speaker + 1}`);
}
export function timeLabel(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function transcriptText(meeting: Meeting) {
  return meeting.segments.map(segment => {
    const original = segment.utterances.length ? segment.utterances.map(utterance =>
      `${speakerName(meeting, segment, utterance.speaker)}: ${utterance.transcript}`).join('\n') :
      `${speakerName(meeting, segment)}: ${segment.original}`;
    return `[${timeLabel(segment.timestamp)}] ${original}` +
      (segment.translation === undefined ? '' : `\nTranslation (${segment.targetLanguage ?? meeting.targetLanguage}): ${segment.translation}`);
  }).join('\n\n');
}
export function searchableText(meeting: Meeting) {
  return [meeting.title, meeting.notebook, meeting.notes, meeting.enhancedNotes, ...meeting.attendees,
    ...Object.values(meeting.speakerNames), ...meeting.segments.flatMap(segment =>
      [segment.original, segment.translation ?? '', ...segment.utterances.map(utterance => utterance.transcript)])].join('\n');
}
export function markdown(meeting: Meeting) {
  const sections = [`# ${meeting.title}`, `${meeting.createdAt} · ${meeting.notebook}`];
  if (meeting.notes) sections.push(`## My notes\n\n${meeting.notes}`);
  if (meeting.enhancedNotes) sections.push(`## Enhanced notes\n\n${meeting.enhancedNotes}`);
  if (meeting.actions.length) sections.push('## Actions\n\n' + meeting.actions.map(action =>
    `- [${action.completed ? 'x' : ' '}] ${action.description}${action.owner ? ` · ${action.owner}` : ''}${action.deadline ? ` · ${action.deadline}` : ''}`).join('\n'));
  if (meeting.segments.length) sections.push(`## Transcript\n\n${transcriptText(meeting)}`);
  return `${sections.join('\n\n')}\n`;
}
