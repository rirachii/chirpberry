import { test, expect, _electron as electron } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('optional call suggestions respect setup, dismissal and explicit recording, without a calendar', async ({}, info) => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Synthetic call metadata and audio live only in the fixture build.');
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-detection-e2e-'));
  const activity = path.join(root, 'activity.json');
  await writeFile(activity, JSON.stringify(['zoom']));
  const options = { args: [path.resolve('test-build/main.cjs')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'),
    CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1', CHIRPBERRY_FIXTURE_ACTIVITY_FILE: activity } };
  let application = await electron.launch(options);
  try {
    const page = await application.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    const toggle = page.getByRole('checkbox', { name: 'Suggest notes when a call starts', exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('region', { name: 'Call suggestion', exact: true })).toHaveCount(0);
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('0');
    await page.screenshot({ path: info.outputPath('apple-calendar-optional.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await toggle.check();
    const suggestion = page.getByRole('region', { name: 'Call suggestion', exact: true });
    await expect(suggestion).toContainText('Possible call in Zoom');
    expect(await page.evaluate(async () => (await window.chirpberry.load()).meetings.length)).toBe(0);
    const firstId = await page.evaluate(async () => (await window.chirpberry.runtime()).detection.prompt!.id);
    const bypass = await page.evaluate(async id => { try { await window.chirpberry.startDetectedMeeting(id); return 'unexpected success'; } catch (error) { return String(error); } }, firstId);
    expect(bypass).toContain('disclosure');
    await suggestion.getByRole('button', { name: 'Set up recording', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Chirpberry Settings', exact: true });
    await expect(settings).toBeVisible();
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('0');
    await settings.getByRole('checkbox', { name: 'I understand and agree to this cloud processing when I start these actions.' }).check();
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(settings.getByText('Settings saved.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await suggestion.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(suggestion).toHaveCount(0);
    // A dismissed token cannot create a note or toggle an existing recording.
    const dismissed = await page.evaluate(async id => { try { await window.chirpberry.startDetectedMeeting(id); return 'unexpected success'; } catch (error) { return String(error); } }, firstId);
    expect(dismissed).toContain('expired');
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('0');
    expect(await page.evaluate(async () => (await window.chirpberry.load()).meetings.length)).toBe(0);
    await toggle.uncheck(); await writeFile(activity, JSON.stringify(['chrome'])); await toggle.check();
    await expect(suggestion).toContainText('Possible call in Chrome');
    await expect(suggestion).not.toContainText('Google Meet');
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Chirpberry')!.setContentSize(780, 740); });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: info.outputPath('call-suggestion-compact-dark.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Continue without a calendar', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Upcoming meetings' })).toHaveCount(0);
    await expect(suggestion).toBeVisible();
    const acceptedId = await page.evaluate(async () => (await window.chirpberry.runtime()).detection.prompt!.id);
    await suggestion.getByRole('button', { name: 'Start notes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(suggestion).toHaveCount(0);
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('1');
    const replay = await page.evaluate(async id => { try { await window.chirpberry.startDetectedMeeting(id); return 'unexpected success'; } catch (error) { return String(error); } }, acceptedId);
    expect(replay).toContain('expired');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Record meeting', exact: true })).toBeVisible();
    const notes = await page.evaluate(async () => (await window.chirpberry.load()).meetings);
    expect(notes).toHaveLength(1); expect(notes[0].segments).toHaveLength(1);
    expect(notes[0].segments[0].original).toBe('Synthetic final speech.');
    await expect(suggestion).toHaveCount(0);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await toggle.uncheck();
    await expect.poll(async () => (await page.evaluate(() => window.chirpberry.runtime())).detection).toEqual({ enabled: false });
    // Independent quick actions must merge inside the serialized settings write queue.
    await page.evaluate(async () => { await Promise.all([window.chirpberry.connectCalendar(), window.chirpberry.setMeetingDetection(true)]); });
    const connected = await page.evaluate(() => window.chirpberry.runtime());
    expect(connected.settings.calendarEnabled).toBe(true); expect(connected.settings.meetingDetectionEnabled).toBe(true);
    await page.evaluate(async () => { await Promise.all([window.chirpberry.disconnectCalendar(), window.chirpberry.setMeetingDetection(false)]); });
    const disconnected = await page.evaluate(() => window.chirpberry.runtime());
    expect(disconnected.settings.calendarEnabled).toBe(false); expect(disconnected.settings.meetingDetectionEnabled).toBe(false);
    expect(disconnected.capture.state).toBe('idle');
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('1');
    expect(errors).toEqual([]);
    await application.close();
    application = await electron.launch(options);
    const restored = await application.firstWindow();
    await restored.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(restored.getByRole('checkbox', { name: 'Suggest notes when a call starts' })).not.toBeChecked();
    const reloaded = await restored.evaluate(async () => (await window.chirpberry.load()).meetings);
    expect(reloaded[0].segments).toEqual(notes[0].segments);
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('0');
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});

test('production Apple Calendar setup can be skipped and unavailable detection cannot be enabled', async ({}, info) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-calendar-production-'));
  const application = await electron.launch({ executablePath: process.env.CHIRPBERRY_EXECUTABLE,
    args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')],
    env: { ...process.env, CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } });
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect Apple Calendar', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Suggest notes when a call starts' })).toBeDisabled();
    const enable = await page.evaluate(async () => { try { await window.chirpberry.setMeetingDetection(true); return 'unexpected success'; } catch (error) { return String(error); } });
    expect(enable).toContain('unavailable');
    const fakePrompt = await page.evaluate(async () => { try { await window.chirpberry.startDetectedMeeting('00000000-0000-4000-8000-000000000000'); return 'unexpected success'; } catch (error) { return String(error); } });
    expect(fakePrompt).toContain('disclosure');
    expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('idle');
    await page.screenshot({ path: info.outputPath('production-apple-calendar.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Continue without a calendar', exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeVisible();
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});
