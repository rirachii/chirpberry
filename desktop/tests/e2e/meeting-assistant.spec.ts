import { test, expect, _electron as electron } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('calendar to live AI to reviewed sharing, with independent cancellation and preserved notes', async ({}, info) => {
  test.skip(!!process.env.CHIRPBERRY_EXECUTABLE, 'Uses synthetic calendar and audio, with a loopback Responses server.');
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-assistant-e2e-'));
  const calendarFile = path.join(root, 'calendar.json'), requests: any[] = [];
  let cancelled = false;
  const server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data), input = JSON.parse(body.input[0].content);
    requests.push({ body, input, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    send({ type: 'response.output_text.delta', delta: input.mode === 'respond' ? 'A possible response: ' : 'We agreed to ship Friday. ' });
    if (input.question === 'Hold this answer') { res.once('close', () => cancelled = true); return; }
    setTimeout(() => { send({ type: 'response.output_text.delta', delta: input.mode === 'respond' ? '“Let’s confirm the budget before committing.” [T1]' : '[T1]' }); send({ type: 'response.completed' }); res.end(); }, 450);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const start = Date.now() + 120000;
  await writeFile(calendarFile, JSON.stringify([0, 1].map(index => ({ id: `design-series:${index}`, title: 'Design review',
    start: new Date(start + index * 86400000).toISOString(), end: new Date(start + 3600000 + index * 86400000).toISOString(), calendar: 'Synthetic work calendar', location: 'Design room', joinURL: 'https://meet.google.com/example' }))));
  const application = await electron.launch({ args: [path.resolve('test-build/main.cjs')], env: { ...process.env,
    CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1',
    CHIRPBERRY_FIXTURE_ASSISTANT: '1', CHIRPBERRY_FIXTURE_CALENDAR_FILE: calendarFile, CHIRPBERRY_FIXTURE_AI_URL: `http://127.0.0.1:${address.port}/v1/responses` } });
  try {
    const page = await application.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect calendars', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Connect calendars', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open note', exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('upcoming-meetings.png') });
    // Two simultaneous opens of one occurrence must resolve to the same stored note.
    const identities = await page.evaluate(async () => { const event = (await window.chirpberry.calendarSnapshot()).events[0]; return Promise.all([window.chirpberry.prepareEvent(event), window.chirpberry.prepareEvent(event)]).then(values => values.map(value => value.id)); });
    expect(new Set(identities).size).toBe(1);
    await page.getByRole('button', { name: 'Open note', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Design review');
    await expect(page.getByRole('button', { name: 'Record meeting', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('PRIVATE: budget negotiation range. Keep my original thought.');
    await page.getByRole('button', { name: 'Ask meeting', exact: true }).click();
    await page.getByRole('button', { name: 'Set up meeting AI' }).click();
    await page.getByRole('checkbox', { name: 'I understand and agree to this cloud processing when I start these actions.' }).check();
    await page.getByRole('checkbox', { name: 'Allow OpenAI processing when I ask about a meeting.' }).check();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Record meeting', exact: true }).click();
    await page.getByRole('button', { name: 'Show transcript' }).click();
    await expect(page.getByText('We agreed to ship the design on Friday. The budget still needs confirmation.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ask meeting', exact: true }).click();
    await page.getByRole('textbox', { name: 'Ask about this meeting' }).fill('What did we agree?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy answer', exact: true })).toHaveCount(1);
    expect(requests[0].authorization).toBe('Bearer synthetic-openai-key'); expect(requests[0].body.store).toBe(false);
    expect(requests[0].input.sources.some((source: any) => source.text.includes('ship the design on Friday'))).toBe(true);
    await page.getByRole('button', { name: 'View source T1' }).click();
    await expect(page.getByRole('region', { name: 'Source excerpt' })).toContainText('budget still needs confirmation');
    await page.getByRole('button', { name: 'Help me respond', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy answer', exact: true })).toHaveCount(2);
    await expect(page.getByText('Possible response', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('live-meeting-assistant.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Edit response', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your response draft' }).fill('Let’s check the budget together before we commit.');
    await page.getByRole('button', { name: 'Copy draft', exact: true }).click();
    expect(await application.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('Let’s check the budget together before we commit.');
    await page.getByRole('textbox', { name: 'Ask about this meeting' }).fill('Hold this answer');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop answer', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop answer', exact: true }).click();
    await expect(page.getByText('Answer stopped. Recording is unchanged.', { exact: true })).toBeVisible();
    await expect.poll(() => cancelled).toBe(true);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Record meeting', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    await page.getByRole('button', { name: 'Generate summary', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue('Synthetic summary.');
    await page.getByRole('button', { name: 'Share notes', exact: true }).click();
    const sharing = page.getByRole('dialog', { name: 'Share notes', exact: true });
    await expect(sharing.getByLabel('Share preview')).toContainText('Synthetic summary.');
    await expect(sharing.getByLabel('Share preview')).not.toContainText('PRIVATE');
    await sharing.getByRole('checkbox', { name: 'My notes', exact: true }).check();
    await expect(sharing.getByLabel('Share preview')).toContainText('PRIVATE');
    await sharing.getByRole('checkbox', { name: 'My notes', exact: true }).uncheck();
    await expect(sharing.getByLabel('Share preview')).not.toContainText('PRIVATE');
    await page.screenshot({ path: info.outputPath('reviewed-sharing.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await sharing.getByRole('button', { name: 'Copy reviewed notes' }).click();
    const copied = await application.evaluate(async ({ clipboard }) => clipboard.readText());
    expect(copied).toContain('Synthetic summary.'); expect(copied).not.toMatch(/PRIVATE|What did we agree|Possible response|Transcript/);
    const filename = path.join(root, 'shared.md');
    await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, filename);
    await sharing.getByRole('button', { name: 'Export Markdown', exact: true }).click();
    await expect(sharing.getByText('Reviewed notes exported.')).toBeVisible();
    expect(await readFile(filename, 'utf8')).toBe(copied);
    await sharing.getByRole('button', { name: 'Close sharing' }).click();
    await page.getByRole('tab', { name: 'My notes', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('PRIVATE: budget negotiation range. Keep my original thought.');
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Chirpberry')!.setContentSize(780, 740); });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(780);
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await page.screenshot({ path: info.outputPath('assistant-compact-dark.png') });
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect calendars', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect calendars', exact: true })).toBeVisible();
    await writeFile(calendarFile, JSON.stringify({ error: 'Synthetic calendar permission denied.' }));
    await page.getByRole('button', { name: 'Connect calendars', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Synthetic calendar permission denied.');
    expect(errors).toEqual([]);
  } finally { await application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('production meeting tools preserve setup gates and deliver only the reviewed snapshot', async ({}, info) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-tools-production-'));
  const application = await electron.launch({ executablePath: process.env.CHIRPBERRY_EXECUTABLE,
    args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')],
    env: { ...process.env, CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } });
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Production tools acceptance');
    await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Private preparation stays separate.');
    await page.getByRole('button', { name: 'Ask meeting', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Set up meeting AI' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Ask about this meeting' })).toBeDisabled();
    await page.getByRole('button', { name: 'Share notes', exact: true }).click();
    const sharing = page.getByRole('dialog', { name: 'Share notes' });
    await expect(sharing.getByRole('button', { name: 'Copy reviewed notes' })).toBeDisabled();
    await sharing.getByRole('checkbox', { name: 'My notes', exact: true }).check();
    await expect(sharing.getByLabel('Share preview')).toContainText('Private preparation stays separate.');
    const reviewed = await sharing.getByLabel('Share preview').innerText();
    // An edit after review must not silently change the copy being delivered.
    await page.evaluate(async () => { const note = (await window.chirpberry.load()).meetings[0]; await window.chirpberry.update(note.id, { notes: 'Changed after review.' }); });
    await sharing.getByRole('button', { name: 'Copy reviewed notes' }).click();
    expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(reviewed);
    await sharing.getByRole('button', { name: 'Refresh preview' }).click();
    await expect(sharing.getByLabel('Share preview')).toContainText('Changed after review.');
    await page.screenshot({ path: info.outputPath('production-sharing.png') });
    await sharing.getByRole('button', { name: 'Close sharing' }).click();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect calendars' })).toBeDisabled();
    await expect(page.getByText('Calendar connection is unavailable in this build or on this platform. Notes and recording remain available.')).toBeVisible();
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
});
