import { z } from 'zod';
import { uuid } from './meeting';

export const askSchema = z.strictObject({ meetingId: uuid, requestId: uuid,
  mode: z.enum(['ask', 'catch-up', 'questions', 'respond']), question: z.string().trim().max(2000).default('') });
export type AskRequest = z.infer<typeof askSchema>;
export type MeetingSource = { id: string; label: string; text: string; segmentId?: string; timestamp?: number };
export type AssistantAnswer = { requestId: string; meetingId: string; mode: AskRequest['mode']; question: string;
  state: 'thinking' | 'streaming' | 'complete' | 'cancelled' | 'error'; text: string; sources: MeetingSource[];
  contextAt: string; excerpted: boolean; message?: string };
export const quickQuestions = {
  'catch-up': 'Catch me up on the recent discussion. What was decided and what is still open?',
  questions: 'Suggest three useful questions I could ask next, based on this meeting.',
  respond: 'Help me respond to the latest question or issue in this meeting. Draft a short possible response and flag anything I need to confirm.'
};
