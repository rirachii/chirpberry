import { noteAction, libraryAction } from './ui';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

declare global { var companionLoadGate: { entered: boolean; release(): void } | undefined; }

async function launch() {
  await mkdir('test-results', { recursive: true });
  const root = await mkdtemp(path.resolve('test-results/review-ui-'));
  const application = await electron.launch({ args: [path.resolve('test-build')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'),
    CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1', CHIRPBERRY_FIXTURE_CONNECT_DELAY_MS: '1500', CHIRPBERRY_FIXTURE_FINISH_DELAY_MS: '2000' } });
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeVisible();
  return { application, page, root };
}
async function settings(page: Page, patch: { barVisible?: boolean; disclosureAccepted?: boolean }) {
  return page.evaluate(async patch => {
    const runtime = await window.chirpberry.runtime();
    return window.chirpberry.saveSettings({ ...runtime.settings, ...patch });
  }, patch);
}
async function bar(application: ElectronApplication) {
  await expect.poll(() => application.windows().some(page => page.url().endsWith('/companion.html'))).toBe(true);
  return application.windows().find(page => page.url().endsWith('/companion.html'))!;
}

test('hiding the companion during its load keeps the notebook available', async () => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Synthetic capture adapters are never packaged.');
  const { application, page, root } = await launch();
  try {
    await (await bar(application)).waitForLoadState();
    await settings(page, { barVisible: false });
    await application.evaluate(({ BrowserWindow }) => {
      const loadURL = BrowserWindow.prototype.loadURL;
      let release = () => {};
      const pending = new Promise<void>(resolve => { release = resolve; });
      globalThis.companionLoadGate = { entered: false, release };
      BrowserWindow.prototype.loadURL = async function (url, options) {
        if (!url.endsWith('/companion.html')) return loadURL.call(this, url, options);
        BrowserWindow.prototype.loadURL = loadURL;
        globalThis.companionLoadGate!.entered = true;
        // Hold startup until Settings has destroyed this window, regardless of host speed.
        await pending;
        return loadURL.call(this, url, options);
      };
    });
    const showing = settings(page, { barVisible: true }).then(() => undefined, error => error.message);
    await expect.poll(() => application.evaluate(() => globalThis.companionLoadGate!.entered)).toBe(true);
    await settings(page, { barVisible: false });
    await application.evaluate(() => globalThis.companionLoadGate!.release());
    expect(await showing).toBeUndefined();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeVisible();
    await settings(page, { barVisible: true });
    await (await bar(application)).waitForLoadState();
  } finally {
    await application.evaluate(() => globalThis.companionLoadGate?.release()).catch(() => {});
    await application.close(); await rm(root, { recursive: true, force: true });
  }
});

test('collection navigation retains capture controls with the companion disabled', async () => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Synthetic capture adapters are never packaged.');
  const { application, page, root } = await launch();
  try {
    await settings(page, { barVisible: false, disclosureAccepted: true });
    await page.getByRole('button', { name: 'Record meeting', exact: true }).click();
    await page.getByRole('combobox', { name: 'Filter notes' }).selectOption('pinned');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.chirpberry.runtime()).capture.state)).toBe('idle');
    await page.getByRole('combobox', { name: 'Filter notes' }).selectOption('all');
    await page.getByRole('button', { name: /Untitled meeting.*No notes yet/ }).click();
    await page.getByRole('button', { name: 'Record meeting', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    for (const name of ['Pinned', 'Trash', 'All notes']) {
      await page.getByRole('combobox', { name: 'Filter notes' }).selectOption(name === 'All notes' ? 'all' : name.toLowerCase());
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Go to recording' })).toBeVisible();
    }
    expect(application.windows().filter(window => window.url().endsWith('/companion.html'))).toHaveLength(0);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText(/Saving final speech…/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Filter notes' }).selectOption('trash');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.chirpberry.runtime()).capture.state)).toBe('idle');
    const snapshot = await page.evaluate(() => window.chirpberry.load());
    expect(snapshot.meetings[0].segments).toHaveLength(2);
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});

test('active companion hiding is deferred in main and disabled in live Settings', async () => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Synthetic capture adapters are never packaged.');
  const { application, page, root } = await launch();
  try {
    await settings(page, { disclosureAccepted: true });
    const companion = await bar(application);
    await page.getByRole('button', { name: 'Record meeting', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await settings(page, { barVisible: false });
    expect(companion.isClosed()).toBe(false);
    await expect.poll(() => companion.evaluate(() => window.innerWidth)).toBe(200);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Show the floating bar', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await settings(page, { barVisible: false });
    expect(companion.isClosed()).toBe(false);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await settings(page, { barVisible: false });
    expect(companion.isClosed()).toBe(false);
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await settings(page, { barVisible: false });
    expect(companion.isClosed()).toBe(false);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Show the floating bar', exact: true })).toBeDisabled();
    await page.evaluate(async () => { await window.chirpberry.stopCapture(); });
    await expect(page.getByRole('checkbox', { name: 'Show the floating bar', exact: true })).toBeEnabled();
    await expect.poll(() => companion.isClosed()).toBe(true);
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});
