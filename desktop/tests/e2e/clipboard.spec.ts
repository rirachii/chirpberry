import { noteAction, libraryAction } from './ui';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ClipboardGate = { copies: string[]; settle(): void };
declare global { var clipboardGate: ClipboardGate | undefined; }

for (const outcome of ['resolve', 'reject', 'quit'] as const) {
  test(`synthetic clipboard ${outcome}: Stop waits for delivery and keeps final notes`, async ({}, info) => {
    test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Clipboard barriers belong only to the synthetic fixture build.');
    await mkdir('test-results', { recursive: true });
    const root = await mkdtemp(path.resolve('test-results/clipboard-ui-'));
    const documents = path.join(root, 'documents');
    const application = await electron.launch({ args: [path.resolve('test-build')], env: { ...process.env,
      CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: documents,
      CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } });
    let closed = false;
    const closedApplication = new Promise<void>(resolve => application.once('close', () => { closed = true; resolve(); }));
    try {
      const page = await application.firstWindow();
      await libraryAction(page, 'New scratchpad');
      await page.getByRole('textbox', { name: 'Note title' }).fill(`Synthetic clipboard ${outcome}`);
      await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Keep my original notes.');
      await page.getByRole('textbox', { name: 'My notes', exact: true }).blur();
      await page.evaluate(async () => {
        const runtime = await window.chirpberry.runtime();
        await window.chirpberry.saveSettings({ ...runtime.settings, disclosureAccepted: true });
      });
      await application.evaluate(({ clipboard }, outcome) => {
        let settle = () => {};
        const delivered = new Promise<void>((resolve, reject) => {
          settle = () => outcome === 'reject' ? reject(new Error('Synthetic clipboard unavailable')) : resolve();
        });
        // This replaces the fixture clipboard only; the OS clipboard is never read or written.
        let text = 'Existing synthetic clipboard';
        globalThis.clipboardGate = { copies: [], settle };
        clipboard.writeText = async value => {
          globalThis.clipboardGate!.copies.push(value);
          await delivered;
          text = value;
        };
        clipboard.readText = async () => text;
      }, outcome);
      await noteAction(page, 'Dictate to clipboard');
      await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
    await expect(page.getByText('Synthetic live draft', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect.poll(() => application.evaluate(() => globalThis.clipboardGate!.copies)).toEqual(['Synthetic final speech.']);
      await expect(page.getByText(/Saving final speech/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
      await expect(page.getByText('Copied to clipboard. A copy is saved in Scratchpad.', { exact: true })).not.toBeVisible();
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe('Existing synthetic clipboard');
      const meeting = (await page.evaluate(() => window.chirpberry.load())).meetings[0];
      const savedFile = path.join(documents, `${meeting.id}.json`);
      const saved = JSON.parse(await readFile(savedFile, 'utf8'));
      expect(saved.notes).toBe('Keep my original notes.\nSynthetic final speech.');
      expect(saved.segments).toHaveLength(1);
      expect(JSON.stringify(saved)).not.toContain('Synthetic live draft');
      await page.screenshot({ path: info.outputPath('clipboard-pending.png') });
      if (outcome === 'quit') {
        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
          .find(window => window.webContents.getURL().endsWith('/index.html'))!.close());
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(closed).toBe(false);
        expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('finishing');
        await application.evaluate(() => globalThis.clipboardGate!.settle());
        await closedApplication;
      } else {
        await application.evaluate(() => globalThis.clipboardGate!.settle());
        const message = outcome === 'resolve'
          ? 'Copied to clipboard. A copy is saved in Scratchpad.'
          : 'Could not write to the clipboard. Your dictation is saved in Scratchpad.';
        await expect(page.getByText(message, { exact: true })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'My notes', exact: true }))
          .toHaveValue('Keep my original notes.\nSynthetic final speech.');
        expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(outcome === 'resolve'
          ? 'Synthetic final speech.' : 'Existing synthetic clipboard');
        await page.evaluate(() => window.chirpberry.stopCapture());
        expect(await application.evaluate(() => globalThis.clipboardGate!.copies)).toEqual(['Synthetic final speech.']);
        await page.screenshot({ path: info.outputPath(`clipboard-${outcome}.png`) });
        await application.close();
      }
      const persisted = JSON.parse(await readFile(savedFile, 'utf8'));
      expect(persisted.notes).toBe(saved.notes);
      expect(persisted.segments).toEqual(saved.segments);
      await writeFile(info.outputPath('saved-dictation.json'), JSON.stringify(persisted, null, 2));
    } finally {
      if (!closed) {
        await application.evaluate(() => globalThis.clipboardGate?.settle()).catch(() => {});
        await application.close();
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
