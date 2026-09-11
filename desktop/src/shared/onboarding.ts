import { z } from 'zod';

export const onboardingStepSchema = z.enum(['welcome', 'speech', 'meetings', 'ready', 'complete']);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;
export const onboardingUpdateSchema = z.strictObject({ step: onboardingStepSchema.optional(), disclosureAccepted: z.boolean().optional() });
