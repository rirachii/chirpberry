import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const connectedAtLaunch of [false, true]) test(`Calendar connection survives delayed companion startup: previously connected ${connectedAtLaunch}`, async () => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Uses a synthetic calendar and controlled companion startup.');
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-startup-'));
  const gate = path.join(root, 'release-startup'), calendarFile = path.join(root, 'calendar.json'), profile = path.join(root, 'profile');
  await mkdir(profile);
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ calendarEnabled: connectedAtLaunch }));
  await writeFile(calendarFile, JSON.stringify([{ id: 'synthetic-event', title: 'Startup meeting', start: new Date(Date.now() + 60000).toISOString(), end: new Date(Date.now() + 3600000).toISOString() }]));
  const application = await electron.launch({ args: [path.resolve('test-build/main.cjs')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: profile, CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1',
    CHIRPBERRY_FIXTURE_ASSISTANT: '1', CHIRPBERRY_FIXTURE_CALENDAR_FILE: calendarFile, CHIRPBERRY_FIXTURE_STARTUP_GATE: gate } });
  try {
    const page = await application.firstWindow();
    await expect.poll(() => existsSync(`${gate}.waiting`)).toBe(true);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    if (!connectedAtLaunch) await page.getByRole('button', { name: 'Connect calendars', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open note', exact: true })).toHaveCount(1);
    await writeFile(gate, '');
    await expect.poll(() => existsSync(`${gate}.completed`)).toBe(true);
    await expect.poll(async () => (await page.evaluate(() => window.chirpberry.calendarSnapshot())).events.map(event => event.id)).toEqual(['synthetic-event']);
    await page.getByRole('button', { name: 'Open note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Startup meeting');
    expect((await page.evaluate(() => window.chirpberry.runtime())).capture.state).toBe('idle');
  } finally { await writeFile(gate, ''); await application.close(); await rm(root, { recursive: true, force: true }); }
});

for (const trigger of ['early-frame', 'companion-focused']) test(`Search command restores notebook focus: ${trigger}`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-search-focus-'));
  const application = await electron.launch({ executablePath: process.env.CHIRPBERRY_EXECUTABLE,
    args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')], env: { ...process.env,
      CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } });
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(page.getByRole('textbox', { name: 'Search notes' })).not.toBeVisible();
    if (trigger === 'early-frame') {
      // Force the frame callback to run before React commits the newly mounted sidebar.
      await page.evaluate(() => {
        const original = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => { window.requestAnimationFrame = original; callback(performance.now()); return 0; };
      });
    } else {
      await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/companion.html')))).toBe(true);
      await application.evaluate(({ app, BrowserWindow }) => { const bar = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/companion.html'))!; bar.show(); app.focus({ steal: true }); bar.focus(); });
      const focusAvailable = await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/companion.html'))!.isFocused()), { timeout: 1000 }).toBe(true).then(() => true, () => false);
      test.skip(!focusAvailable, 'This desktop session cannot focus the companion; foreground-window acceptance requires an interactive desktop.');
    }
    await application.evaluate(({ Menu, BrowserWindow }) => {
      const notebook = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'))!;
      const item = Menu.getApplicationMenu()!.items.find(item => item.label === 'View')!.submenu!.items.find(item => item.label === 'Search notes')!;
      item.click(item, notebook, { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, triggeredByAccelerator: false });
    });
    await expect(page.getByRole('textbox', { name: 'Search notes' })).toBeFocused();
    if (trigger === 'companion-focused') await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'))!.isFocused())).toBe(true);
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});
