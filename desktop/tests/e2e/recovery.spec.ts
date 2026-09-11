import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Calendar retry recovers a timed-out helper without restarting the app or recording', async ({}, info) => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Uses a synthetic native helper; no OS permission changes.');
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-recovery-'));
  const application = await electron.launch({ args: [path.resolve('test-build/main.cjs')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'),
    CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1', CHIRPBERRY_FIXTURE_RECOVERY_DIR: root, CHIRPBERRY_FIXTURE_NODE_EXECUTABLE: process.execPath } });
  const events = async (): Promise<{ pid: number; command?: string; event: string }[]> => (await readFile(path.join(root, 'helper.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.getByRole('button', { name: 'Connect Apple Calendar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('The Mac integration timed out.');
    await page.getByRole('button', { name: 'Connect Apple Calendar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your next seven days are clear.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect calendars' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(async () => (await events()).filter(event => event.command === 'shortcuts.configure').length).toBe(2);
    const log = await events(), starts = log.filter(event => event.event === 'started');
    expect(starts).toHaveLength(2); expect(log.filter(event => event.command === 'hang')).toHaveLength(1);
    expect(log.filter(event => event.command === 'calendar.upcoming')).toHaveLength(1);
    expect(log.some(event => event.command === 'audio.start')).toBe(false);
    expect(await page.evaluate(async () => (await window.chirpberry.runtime()).capture.state)).toBe('idle');
    expect(await page.evaluate(async () => (await window.chirpberry.load()).meetings.length)).toBe(0);
    expect(() => process.kill(starts[0].pid, 0)).toThrow();
    await page.screenshot({ path: info.outputPath('calendar-recovered.png') });
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});
