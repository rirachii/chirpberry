import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredSettings, settingsSchema } from '../src/shared/capture';
import { onboardingUpdateSchema } from '../src/shared/onboarding';

test('first-run progress defaults safely and legacy profiles keep their setup', () => {
  const fresh = settingsSchema.parse({});
  assert.equal(fresh.onboardingStep, 'welcome');
  assert.equal(fresh.disclosureAccepted, false);
  assert.equal(fresh.calendarEnabled, false);
  assert.equal(fresh.meetingDetectionEnabled, false);
  const existing = readStoredSettings({ disclosureAccepted: true, calendarEnabled: true });
  assert.equal(existing.onboardingStep, 'complete');
  assert.equal(existing.disclosureAccepted, true);
  assert.equal(existing.calendarEnabled, true);
  assert.equal(readStoredSettings({ onboardingStep: 'meetings' }).onboardingStep, 'meetings');
  assert.throws(() => readStoredSettings(null));
  assert.throws(() => readStoredSettings({ onboardingStep: 'unknown' }));
});

test('onboarding IPC cannot set unrelated settings or weaken disclosure validation', () => {
  assert.deepEqual(onboardingUpdateSchema.parse({ step: 'ready', disclosureAccepted: false }), { step: 'ready', disclosureAccepted: false });
  for (const input of [{ step: 'unknown' }, { disclosureAccepted: 'yes' }, { calendarEnabled: true }, { apiKey: 'synthetic' }]) {
    assert.equal(onboardingUpdateSchema.safeParse(input).success, false);
  }
});
