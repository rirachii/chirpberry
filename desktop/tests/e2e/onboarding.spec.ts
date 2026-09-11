import { test, expect, _electron as electron } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const disclosure = 'I understand and agree to this cloud processing when I start these actions.';
test('first-run journey resumes, supports notes without services, and reopens from Settings', async ({}, info) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-onboarding-'));
  const options = { executablePath: process.env.CHIRPBERRY_EXECUTABLE, args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } };
  let app = await electron.launch(options);
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole('dialog', { name: 'Welcome to Chirpberry.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome to Chirpberry.' })).toBeFocused();
    await page.screenshot({ path: info.outputPath('welcome-light.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: disclosure })).not.toBeChecked();
    await expect(page.getByRole('heading', { name: 'Give your notes a voice.' })).toBeVisible();
    await app.close(); app = await electron.launch(options); page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Give your notes a voice.' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'))!.setContentSize(780, 600));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: info.outputPath('speech-compact-dark.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect Apple Calendar', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Suggest notes when a call starts', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your first note starts here.' })).toBeVisible();
    await page.getByRole('button', { name: 'Create a note', exact: true }).click();
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Note title' }).fill('My first note');
    await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('No account needed.');
    await app.close(); app = await electron.launch(options); page = await app.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('My first note');
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('No account needed.');
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
    const saved = await page.evaluate(() => window.chirpberry.runtime());
    expect(saved.settings.onboardingStep).toBe('complete');
    expect(saved.settings.disclosureAccepted).toBe(false);
    expect(saved.settings.calendarEnabled).toBe(false);
    expect(saved.settings.meetingDetectionEnabled).toBe(false);
    expect(saved.capture.state).toBe('idle');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Quick start guide', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to Chirpberry.' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('My first note');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('optional setup saves choices, retries Calendar failure, and never starts capture', async ({}, info) => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Synthetic credentials and Calendar are fixture-only.');
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-onboarding-services-'));
  const activity = path.join(root, 'activity.json'), calendar = path.join(root, 'calendar.json');
  await writeFile(activity, JSON.stringify(['zoom']));
  await writeFile(calendar, JSON.stringify({ error: 'Calendar permission was denied. Open System Settings to allow access.' }));
  const app = await electron.launch({ args: [path.resolve('test-build/main.cjs')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1',
    CHIRPBERRY_FIXTURE_ACTIVITY_FILE: activity, CHIRPBERRY_FIXTURE_ASSISTANT: '1', CHIRPBERRY_FIXTURE_CALENDAR_FILE: calendar } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByLabel('Valsea API key', { exact: true }).fill('synthetic-test-key');
    await page.getByRole('button', { name: 'Save API key', exact: true }).click();
    await expect(page.getByLabel('Valsea API key', { exact: true })).toHaveValue('');
    await page.getByRole('checkbox', { name: disclosure }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Connect Apple Calendar', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Calendar permission was denied');
    await writeFile(calendar, '[]');
    await page.getByRole('button', { name: 'Connect Apple Calendar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Apple Calendar connected', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Suggest notes when a call starts', exact: true }).check();
    await expect.poll(async () => (await page.evaluate(() => window.chirpberry.runtime())).settings.meetingDetectionEnabled).toBe(true);
    await page.screenshot({ path: info.outputPath('optional-calendar-and-detection.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Create a note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeVisible();
    const runtime = await page.evaluate(() => window.chirpberry.runtime());
    expect(runtime.settings.disclosureAccepted).toBe(true); expect(runtime.settings.calendarEnabled).toBe(true);
    expect(runtime.capture.state).toBe('idle'); expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('0');
    await page.getByRole('button', { name: 'Record meeting', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const blocked = await page.evaluate(async () => { try { await window.chirpberry.configureOnboarding({ step: 'welcome' }); return ''; } catch (error) { return String(error); } });
    expect(blocked).toContain('Finish recording');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(await readFile(`${activity}.audio-starts`, 'utf8')).toBe('1');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('existing profiles are not forced through onboarding and a skipped tour stays dismissed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-onboarding-legacy-'));
  const profile = path.join(root, 'profile'); await mkdir(profile);
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ calendarEnabled: false, disclosureAccepted: true }));
  const options = { executablePath: process.env.CHIRPBERRY_EXECUTABLE, args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: profile, CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } };
  let app = await electron.launch(options);
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Start with what matters.' })).toBeVisible();
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
    expect((await page.evaluate(() => window.chirpberry.runtime())).settings.disclosureAccepted).toBe(true);
    await page.evaluate(() => window.chirpberry.configureOnboarding({ step: 'welcome' }));
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
    await app.close(); app = await electron.launch(options); page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Start with what matters.' })).toBeVisible();
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
