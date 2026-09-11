import { z } from 'zod';
import { targets, uuid } from './meeting';
import { onboardingStepSchema } from './onboarding';

export const captureOptionsSchema = z.strictObject({
  meetingId: uuid, purpose: z.enum(['meeting', 'dictation']), includeSystemAudio: z.boolean(),
  language: z.string().regex(/^[a-z][a-z-]{1,39}$|^auto$/), targetLanguage: z.string().refine(value => targets.includes(value)).optional(),
  diarize: z.boolean(), vocabulary: z.string().max(4000).default(''), hints: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(20).default([]),
  disclosureAccepted: z.literal(true)
});
export type CaptureOptions = z.infer<typeof captureOptionsSchema>;
export type CaptureState = 'idle' | 'connecting' | 'recording' | 'paused' | 'finishing';
export type CaptureSnapshot = { state: CaptureState; meetingId?: string; purpose?: 'meeting' | 'dictation'; elapsed: number;
  partials: Record<string, string>; levels: Record<string, number>; message?: string };
export const settingsSchema = z.strictObject({
  onboardingStep: onboardingStepSchema.default('welcome'),
  language: z.string().regex(/^[a-z][a-z-]{1,39}$|^auto$/).default('auto'), targetLanguage: z.string().refine(value => targets.includes(value)).default('english'),
  translate: z.boolean().default(true), diarize: z.boolean().default(false), includeSystemAudio: z.boolean().default(false),
  hints: z.string().max(100).default(''), vocabulary: z.string().max(4000).default(''),
  dock: z.enum(['bottom', 'top', 'left', 'right']).default('bottom'), barVisible: z.boolean().default(true),
  shortcutsEnabled: z.boolean().default(false), disclosureAccepted: z.boolean().default(false),
  calendarEnabled: z.boolean().default(false), calendarReminders: z.boolean().default(false),
  meetingDetectionEnabled: z.boolean().default(false),
  assistantDisclosureAccepted: z.boolean().default(false), assistantModel: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/).default('gpt-4.1-mini')
});
export type AppSettings = z.infer<typeof settingsSchema>;
// Existing profiles keep their notebook workflow. New profiles use the schema default.
export function readStoredSettings(input: unknown): AppSettings {
  const settings = settingsSchema.parse(input);
  if (!Object.hasOwn(input as object, 'onboardingStep')) settings.onboardingStep = 'complete';
  return settings;
}
export type Capabilities = { microphone: boolean; systemAudio: boolean; fn: boolean; calendar: boolean; meetingDetection?: boolean; protectedCredentials: boolean; platform: string; shortcut?: string; problem?: string };
