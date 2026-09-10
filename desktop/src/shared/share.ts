import { z } from 'zod';
import { transcriptText, type Meeting } from './meeting';
export const shareOptionsSchema = z.strictObject({ summary: z.boolean(), notes: z.boolean(), transcript: z.boolean(), actions: z.boolean() });
export type ShareOptions = z.infer<typeof shareOptionsSchema>;
export type SharePreview = { token: string; meetingId: string; title: string; content: string; createdAt: string };
export function shareContent(meeting: Meeting, options: ShareOptions) {
  const sections: string[] = [];
  if (options.summary && meeting.enhancedNotes.trim()) sections.push(`## Summary\n\n${meeting.enhancedNotes.trim()}`);
  if (options.actions && meeting.actions.length) sections.push(`## Action items\n\n${meeting.actions.map(action =>
    `- [${action.completed ? 'x' : ' '}] ${action.description}${action.owner ? ` — ${action.owner}` : ''}${action.deadline ? ` (${action.deadline})` : ''}`).join('\n')}`);
  if (options.notes && meeting.notes.trim()) sections.push(`## Notes\n\n${meeting.notes.trim()}`);
  if (options.transcript && meeting.segments.length) sections.push(`## Transcript\n\n${transcriptText(meeting)}`);
  return sections.length ? `# ${meeting.title || 'Meeting'}\n\n${sections.join('\n\n')}\n` : '';
}
