import { noteAction, libraryAction } from './ui';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

async function launch(mode = 'hang-exit') {
  await mkdir('test-results', { recursive: true });
  const root = await mkdtemp(path.resolve('test-results/lifecycle-ui-'));
  const application = await electron.launch({ args: [path.resolve('test-build')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'),
    CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1', CHIRPBERRY_FIXTURE_LIFECYCLE_DIR: root,
    CHIRPBERRY_FIXTURE_NODE_EXECUTABLE: process.execPath, CHIRPBERRY_FIXTURE_HELPER_MODE: mode,
    CHIRPBERRY_FIXTURE_FINISH_DELAY_MS: '1000' } });
  let closed = false;
  const closedApplication = new Promise<void>(resolve => application.once('close', () => { closed = true; resolve(); }));
  const clipboardLog = path.join(root, 'clipboard.json');
  const page = await application.firstWindow();
  await libraryAction(page, 'New scratchpad');
  await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Original notes');
  await page.getByRole('textbox', { name: 'My notes', exact: true }).blur();
  await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('Original notes');
  await page.evaluate(async () => { const runtime = await window.chirpberry.runtime(); await window.chirpberry.saveSettings({ ...runtime.settings, disclosureAccepted: true }); });
  await expect.poll(() => application.windows().some(window => window.url().endsWith('/companion.html'))).toBe(true);
  const companion = application.windows().find(window => window.url().endsWith('/companion.html'))!;
  const events = async (name: string): Promise<{ pid: number; event: string; command?: string }[]> =>
    (await readFile(path.join(root, `${name}.jsonl`), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const requestPID = async (name: string, command: string) => {
    await expect.poll(async () => (await events(name)).some(event => event.command === command)).toBe(true);
    return (await events(name)).find(event => event.command === command)!.pid;
  };
  const closeWindow = async (surface: 'notebook' | 'companion') => application.evaluate(({ BrowserWindow }, surface) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith(surface === 'notebook' ? '/index.html' : '/companion.html'))!;
    window.focus(); window.close();
  }, surface);
  const cleanup = async () => {
    if (!closed) { await closeWindow('notebook'); await closedApplication; }
    const pids = new Set((await Promise.all(['capture', 'runtime'].map(events))).flat().map(event => event.pid));
    const survivors = [...pids].filter(alive);
    for (const pid of survivors) process.kill(pid, 'SIGKILL');
    await rm(root, { recursive: true, force: true });
    expect(survivors).toEqual([]);
  };
  return { application, page, companion, events, requestPID, closeWindow, closedApplication, clipboardLog, root, cleanup };
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

for (const phase of ['connecting', 'recording', 'pausing'] as const) {
  test(`companion renderer termination during ${phase} cancels capture without clipboard delivery`, async () => {
    test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Only the synthetic fixture build may run this test.');
    const fixture = await launch(phase === 'connecting' ? 'hang-start' : 'hang-exit');
    const { application, page, companion, requestPID, root } = fixture;
    try {
      await noteAction(page, 'Dictate to clipboard');
      const pid = await requestPID('capture', 'audio.start');
      if (phase !== 'connecting') await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      if (phase === 'pausing') {
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await expect(page.getByText(/Saving final speech/)).toBeVisible();
      }
      await application.evaluate(({ BrowserWindow }) => new Promise<void>(resolve => {
        const contents = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/companion.html'))!.webContents;
        contents.once('render-process-gone', () => resolve());
        contents.forcefullyCrashRenderer();
      }));
      await expect.poll(() => companion.isClosed()).toBe(true);
      expect(alive(pid)).toBe(false);
      expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('idle');
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe('[]');
      const snapshot = await page.evaluate(() => window.chirpberry.load());
      const meeting = snapshot.meetings[0];
      const saved = JSON.parse(await readFile(path.join(root, 'documents', `${meeting.id}.json`), 'utf8'));
      expect(saved.notes).toBe(phase === 'connecting' ? 'Original notes' : 'Original notes\nSynthetic final speech.');
      expect(saved.segments).toHaveLength(phase === 'connecting' ? 0 : 1);
    } finally { await fixture.cleanup(); }
  });
}

test('closing the companion cancels a pending native start and awaits its child', async () => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Only the synthetic fixture build may run this test.');
  const fixture = await launch('hang-start');
  const { application, page, companion, requestPID, closeWindow } = fixture;
  try {
    await noteAction(page, 'Dictate to clipboard');
    const pid = await requestPID('capture', 'audio.start');
    await closeWindow('companion');
    await expect.poll(() => companion.isClosed()).toBe(true);
    expect(alive(pid)).toBe(false);
    expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('idle');
    expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe('[]');
  } finally { await fixture.cleanup(); }
});

for (const surface of ['companion', 'notebook'] as const) {
  test(`closing the ${surface} upgrades a draining Pause and disables delivery`, async () => {
    test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Only the synthetic fixture build may run this test.');
    const fixture = await launch();
    const { application, page, companion, requestPID, events, closeWindow, closedApplication } = fixture;
    try {
      await noteAction(page, 'Dictate to clipboard');
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      const capturePID = await requestPID('capture', 'audio.start');
      const runtimePID = await requestPID('runtime', 'ping');
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(page.getByText(/Saving final speech/)).toBeVisible();
      await closeWindow(surface);
      if (surface === 'companion') {
        await expect.poll(() => companion.isClosed()).toBe(true);
        expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('idle');
        expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe('[]');
        await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('Original notes\nSynthetic final speech.');
      } else {
        await closedApplication;
        expect(alive(runtimePID)).toBe(false);
        expect(await readFile(fixture.clipboardLog, 'utf8')).toBe('[]');
      }
      expect(alive(capturePID)).toBe(false);
      expect((await events('capture')).filter(event => event.event === 'started')).toHaveLength(1);
    } finally { await fixture.cleanup(); }
  });
}

for (const action of ['bar Stop', 'helper shortcut'] as const) {
  test(`${action} upgrades a pending Pause and delivers once after persistence`, async () => {
    test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Only the synthetic fixture build may run this test.');
    const fixture = await launch();
    const { application, page, companion } = fixture;
    try {
      await noteAction(page, 'Dictate to clipboard');
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(page.getByText(/Saving final speech/)).toBeVisible();
      if (action === 'bar Stop') await companion.getByRole('button', { name: 'Stop recording', exact: true }).click();
      else await page.evaluate(async () => { const runtime = await window.chirpberry.runtime(); await window.chirpberry.saveSettings({ ...runtime.settings, shortcutsEnabled: true }); });
      await expect.poll(() => page.evaluate(async () => (await window.chirpberry.runtime()).capture.state)).toBe('idle');
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(JSON.stringify(['Synthetic final speech.']));
      const snapshot = await page.evaluate(() => window.chirpberry.load());
      expect(snapshot.meetings[0].notes).toBe('Original notes\nSynthetic final speech.');
      expect(snapshot.meetings[0].segments).toHaveLength(1);
    } finally { await fixture.cleanup(); }
  });
}
