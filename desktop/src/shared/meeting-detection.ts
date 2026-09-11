import { z } from 'zod';

export const meetingSources = ['zoom', 'teams', 'chrome', 'edge', 'brave', 'firefox', 'safari', 'arc'] as const;
export const meetingActivitySchema = z.array(z.enum(meetingSources)).max(meetingSources.length);
export type MeetingSource = typeof meetingSources[number];
export const meetingSourceNames: Record<MeetingSource, string> = {
  zoom: 'Zoom', teams: 'Teams', chrome: 'Chrome', edge: 'Edge', brave: 'Brave', firefox: 'Firefox', safari: 'Safari', arc: 'Arc'
};
export type MeetingPrompt = { id: string; source: MeetingSource; createdAt: number };
export type DetectionSnapshot = { enabled: boolean; prompt?: MeetingPrompt; error?: string };
