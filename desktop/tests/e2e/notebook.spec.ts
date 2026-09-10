import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { newMeeting } from '../../src/shared/meeting';

test('real Electron notebook: edit, restart, import, search, export, trash, keyboard, accessibility', async ({}, info) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-e2e-'));
  const documents = path.join(root, 'documents');
  const launch = () => electron.launch({ executablePath: process.env.CHIRPBERRY_EXECUTABLE,
    args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')],
    env: { ...process.env, CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: documents, CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1', ELECTRON_ENABLE_SECURITY_WARNINGS: 'true' } });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Start with what matters.' })).toBeVisible();
    await page.getByRole('button', { name: 'New meeting', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Meeting title' }).fill('Electron acceptance note');
    await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Keep my original notes.\n讨论 Friday launch.');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Summary stays separate.');
    await expect(page.getByText('Saved on this device')).toBeVisible();
    // Closing immediately after an edit must flush, without waiting for the debounce.
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Latest summary before close.');
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Meeting title' })).toHaveValue('Electron acceptance note');
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('Keep my original notes.\n讨论 Friday launch.');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue('Latest summary before close.');
    await page.getByRole('button', { name: 'Move note to trash', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore note', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    await page.getByRole('button', { name: /Electron acceptance note/ }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: /^All notes/ }).click();
    await page.getByRole('textbox', { name: 'Search notes', exact: true }).fill('讨论');
    await expect(page.getByRole('button', { name: /Electron acceptance note/ })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();

    const invalidSource = path.join(root, 'unsupported.json');
    const invalidContents = '{"version":999}';
    await writeFile(invalidSource, invalidContents);
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, invalidSource);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('This file does not match the supported Chirpberry meeting format. The original file has been preserved.', { exact: true })).toBeVisible();
    expect(await readFile(invalidSource, 'utf8')).toBe(invalidContents);
    await page.screenshot({ path: info.outputPath('unsupported-import-preserved.png') });
    await page.getByRole('button', { name: 'Dismiss message' }).click();

    const fixture = newMeeting(randomUUID());
    fixture.title = 'Synthetic bilingual meeting'; fixture.notes = 'Ask about the Friday handoff.\n\nKeep the first release focused.';
    fixture.segments = [{ id: randomUUID().toUpperCase(), channel: 'Fixture', original: '我们周五交付。谢谢。', translation: 'We deliver on Friday. Thank you.', timestamp: 12, targetLanguage: 'english', speakerScope: 'fixture', utterances: [{ speaker: 0, transcript: '我们周五交付。' }, { speaker: 1, transcript: '谢谢。' }] }];
    const source = path.join(root, 'synthetic-fixture.json');
    const sourceContents = JSON.stringify(fixture);
    await writeFile(source, sourceContents);
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, source);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Meeting title' })).toHaveValue(fixture.title);
    await expect(page.getByText('We deliver on Friday. Thank you.', { exact: true })).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Speaker name at 00:12, utterance 1' }).fill('Maya');
    const destination = path.join(root, 'export.json');
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, destination);
    await page.getByLabel('Export options', { exact: true }).click();
    await page.getByRole('button', { name: 'Export Chirpberry JSON', exact: true }).click();
    await expect(page.getByText('Chirpberry document exported.', { exact: true })).toBeVisible();
    const exported = JSON.parse(await readFile(destination, 'utf8'));
    expect(exported.id).not.toBe(fixture.id);
    expect(exported.speakerNames['Fixture:fixture:0']).toBe('Maya');
    expect(exported.segments[0].translation).toBe('We deliver on Friday. Thank you.');
    expect(await readFile(source, 'utf8')).toBe(sourceContents);
    await writeFile(info.outputPath('exported-bilingual-meeting.json'), JSON.stringify(exported, null, 2));
    await page.getByLabel('Export options', { exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await page.getByRole('tab', { name: 'My notes', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'My notes', exact: true })).toBeFocused();
    // Electron has one renderer here and cannot create the extra page used by axe's default mode.
    const result = await new AxeBuilder({ page }).setLegacyMode().analyze();
    expect(result.violations).toEqual([]);
    const isolation = await page.evaluate(() => ({ node: typeof (window as any).require, process: typeof (window as any).process, api: typeof window.chirpberry.load }));
    expect(isolation).toEqual({ node: 'undefined', process: 'undefined', api: 'function' });
    await page.screenshot({ path: info.outputPath('notebook-desktop.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'))!.setSize(780, 700));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(780);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const compact = await new AxeBuilder({ page }).setLegacyMode().analyze();
    expect(compact.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('notebook-compact-dark.png') });
    await page.getByRole('button', { name: 'Dictate', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('OS integrations are disabled for this diagnostic session.', { exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('idle');
    await page.screenshot({ path: info.outputPath('diagnostic-capture-blocked.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect((await readdir(documents)).filter(name => name.endsWith('.json'))).toHaveLength(2);
    expect(errors).toEqual([]);
  } catch (error) {
    const page = app?.windows().find(window => window.url().endsWith('/index.html'));
    if (page && !page.isClosed()) {
      await page.screenshot({ path: info.outputPath('notebook-failure.png') }).catch(() => {});
      await page.evaluate(() => window.chirpberry.load()).then(snapshot => writeFile(info.outputPath('notebook-failure-state.json'), JSON.stringify(snapshot, null, 2))).catch(() => {});
    }
    throw error;
  } finally {
    if (app) {
      const fallback = setTimeout(() => app?.process().kill('SIGTERM'), 3000);
      try { await app.close(); } finally { clearTimeout(fallback); }
    }
    await rm(root, { recursive: true, force: true });
  }
});
